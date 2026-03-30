const functions = require("firebase-functions");
const admin = require("firebase-admin");
const { Expo } = require("expo-server-sdk");
const https = require("https");

admin.initializeApp();

const expo = new Expo();

// ─── users/{uid}/private/account (PII) + root merge ────────────────────────────
function usersPrivateAccountRef(db, uid) {
  return db.collection("users").doc(uid).collection("private").doc("account");
}

/** Root user doc merged with private/account (private wins on key overlap). */
async function getMergedUserProfile(db, uid) {
  const rootSnap = await db.collection("users").doc(uid).get();
  const privSnap = await usersPrivateAccountRef(db, uid).get();
  const root = rootSnap.exists ? rootSnap.data() : {};
  const priv = privSnap.exists ? privSnap.data() : {};
    return { ...root, ...priv };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Admin audit log (trails / registrations / payments onUpdate → audit_logs;
// trail onDelete → audit_logs/deletions/trails/{trailId} tombstones)
// ═══════════════════════════════════════════════════════════════════════════════
// Firestore triggers do not expose context.auth — the writer’s UID is unknown here.
// Optional fields on the document enable attribution: lastModifiedByUid, updatedByUid,
// lastModifiedBy, updatedBy, editedByUid (string UIDs). Otherwise adminUid is null.

const AUDIT_IGNORED_FIELDS = new Set([
  "updatedAt",
  "lastHeartbeat",
  "lastHeatbeat",
  "lastActive",
  "lastActiveAt",
  "lastSeen",
  "lastOnlineAt",
  "lastModified",
  "modifiedAt",
  "serverTimestamp",
]);

function serializeAuditValue(val) {
  if (val === null || val === undefined) return val;
  if (val instanceof admin.firestore.Timestamp) {
    return { __type: "timestamp", iso: val.toDate().toISOString() };
  }
  if (val && typeof val === "object" && typeof val.latitude === "number" && typeof val.longitude === "number") {
    return { __type: "geoPoint", latitude: val.latitude, longitude: val.longitude };
  }
  if (Array.isArray(val)) return val.map((v) => serializeAuditValue(v));
  if (val && typeof val === "object") {
    const out = {};
    for (const k of Object.keys(val)) {
      out[k] = serializeAuditValue(val[k]);
    }
    return out;
  }
  return val;
}

function auditValuesEqual(a, b) {
  if (a === b) return true;
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  if (a instanceof admin.firestore.Timestamp && b instanceof admin.firestore.Timestamp) {
    return a.seconds === b.seconds && a.nanoseconds === b.nanoseconds;
  }
  try {
    return JSON.stringify(serializeAuditValue(a)) === JSON.stringify(serializeAuditValue(b));
  } catch {
    return false;
  }
}

function diffForAudit(beforeData, afterData) {
  const b = beforeData && typeof beforeData === "object" ? beforeData : {};
  const a = afterData && typeof afterData === "object" ? afterData : {};
  const keys = new Set([...Object.keys(b), ...Object.keys(a)]);
  const changes = {};
  for (const key of keys) {
    if (AUDIT_IGNORED_FIELDS.has(key)) continue;
    const oldVal = b[key];
    const newVal = a[key];
    if (auditValuesEqual(oldVal, newVal)) continue;
    changes[key] = {
      old: serializeAuditValue(oldVal),
      new: serializeAuditValue(newVal),
    };
  }
  return changes;
}

function pickAuditActorUid(after, before) {
  const candidates = [after, before];
  const fieldNames = ["lastModifiedByUid", "updatedByUid", "lastModifiedBy", "updatedBy", "editedByUid"];
  for (const data of candidates) {
    if (!data || typeof data !== "object") continue;
    for (const fn of fieldNames) {
      const v = data[fn];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
  }
  return null;
}

async function fetchAuditAdminDisplayName(db, uid) {
  if (!uid) return null;
  try {
    const userSnap = await db.collection("users").doc(uid).get();
    if (userSnap.exists) {
      const d = userSnap.data();
      return d.displayName || d.name || d.username || null;
    }
  } catch (e) {
    console.warn("fetchAuditAdminDisplayName:", e.message);
  }
  return null;
}

async function writeAuditLogEntry({ collectionName, docId, change, action }) {
  const db = admin.firestore();
  const before = change.before.exists ? change.before.data() : {};
  const after = change.after.exists ? change.after.data() : {};
  const changes = diffForAudit(before, after);
  if (Object.keys(changes).length === 0) return;

  const adminUid = pickAuditActorUid(after, before);
  const adminName = await fetchAuditAdminDisplayName(db, adminUid);

  await db.collection("audit_logs").add({
    collection: collectionName,
    adminUid,
    adminName,
    action,
    targetId: docId,
    changes,
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
  });
}

function resolvePaymentAuditAction(change) {
  const before = change.before.exists ? change.before.data() : {};
  const after = change.after.exists ? change.after.data() : {};
  if (after.status === "refunded" && before.status !== "refunded") return "REFUND_ISSUED";
  if (after.refundId && !before.refundId) return "REFUND_ISSUED";
  return "UPDATE_PAYMENT";
}

/**
 * Full trail snapshot before delete — stored under audit_logs/deletions/trails/{trailId}
 * for manual restore (Firestore doc limit 1MB).
 */
async function writeTrailDeletionTombstone(trailId, snapshotData) {
  const db = admin.firestore();
  const deletedByUid = pickAuditActorUid(snapshotData, {});
  const deletedByName = await fetchAuditAdminDisplayName(db, deletedByUid);

  const tombstoneRef = db
    .collection("audit_logs")
    .doc("deletions")
    .collection("trails")
    .doc(trailId);

  await tombstoneRef.set({
    kind: "TRAIL_TOMBSTONE",
    collection: "trails",
    trailId,
    action: "DELETE_TRAIL",
    tombstone: snapshotData,
    deletedByUid: deletedByUid || null,
    deletedByName: deletedByName || null,
    deletedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

// ─── Stripe Setup ────────────────────────────────────────────────────────────
// Server-only: set STRIPE_SECRET_KEY via Firebase Secret Manager / env, or legacy:
//   firebase functions:config:set stripe.secret="sk_..."   (or stripe.secret_key)
//   Do NOT put secret keys in the client app or EXPO_PUBLIC_*.
// Local emulator: `functions/.env` with STRIPE_SECRET_KEY= (see functions/.env.example)
//   PLATFORM_FEE_PERCENT=5
function getStripeSecretKey() {
  const fromEnv = (process.env.STRIPE_SECRET_KEY || "").trim();
  if (fromEnv) return fromEnv;
  try {
    const cfg = typeof functions.config === "function" ? functions.config() : {};
    const stripe = cfg && cfg.stripe ? cfg.stripe : {};
    return (stripe.secret || stripe.secret_key || "").trim();
  } catch {
    return "";
  }
}

const stripeSecretKey = getStripeSecretKey();
const PLATFORM_FEE_PERCENT = parseFloat(process.env.PLATFORM_FEE_PERCENT || "5");
const stripe = stripeSecretKey ? require("stripe")(stripeSecretKey) : null;

function generateTempPassword(length = 12) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
  let result = "";
  for (let i = 0; i < length; i += 1) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

exports.approveRaceAndCreateDirector = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Authentication required.");
  }

  const requesterUid = context.auth.uid;
  const requesterEmail = context.auth.token.email || "";
  const requesterSnap = await admin.firestore().collection("users").doc(requesterUid).get();
  const requesterRole = requesterSnap.exists ? requesterSnap.get("role") : null;

  const isPrivileged =
    requesterRole === "admin" ||
    requesterRole === "director" ||
    requesterEmail === "rolsen83@gmail.com";

  if (!isPrivileged) {
    throw new functions.https.HttpsError("permission-denied", "Not authorized.");
  }

  const requestId = String(data?.requestId || "").trim();
  const directorEmail = String(data?.directorEmail || "").trim().toLowerCase();
  const directorName = String(data?.directorName || "").trim();
  const providedPassword = String(data?.tempPassword || "").trim();
  const isVisibleOnApp = data?.isVisibleOnApp === true;

  if (!requestId || !directorEmail) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "requestId and directorEmail are required."
    );
  }

  const requestRef = admin.firestore().collection("raceRequests").doc(requestId);
  const requestSnap = await requestRef.get();
  if (!requestSnap.exists) {
    throw new functions.https.HttpsError("not-found", "Race request not found.");
  }

  const requestData = requestSnap.data() || {};

  let userRecord;
  let tempPassword = "";
  let resetLink = "";

  try {
    userRecord = await admin.auth().getUserByEmail(directorEmail);
  } catch (error) {
    if (error.code === "auth/user-not-found") {
      tempPassword = providedPassword || generateTempPassword();
      userRecord = await admin.auth().createUser({
        email: directorEmail,
        password: tempPassword,
        displayName: directorName || requestData.contactName || "Race Director",
      });
    } else {
      throw new functions.https.HttpsError("internal", "Failed to lookup user.");
    }
  }

  if (!tempPassword) {
    resetLink = await admin.auth().generatePasswordResetLink(directorEmail);
  }

  const now = admin.firestore.FieldValue.serverTimestamp();

  const directorPayload = {
    name: directorName || requestData.contactName || "",
    role: "director",
    updatedAt: now,
    createdAt: now,
  };

  if (tempPassword) {
    directorPayload.mustResetPassword = true;
    directorPayload.tempPasswordIssuedAt = now;
  }

  const db = admin.firestore();
  await db.collection("users").doc(userRecord.uid).set(directorPayload, {
    merge: true,
  });
  await usersPrivateAccountRef(db, userRecord.uid).set(
    { email: directorEmail },
    { merge: true }
  );

  // Normalize distances array — support both new per-distance format and legacy flat fields
  let distancesArray = [];
  if (Array.isArray(requestData.distances) && requestData.distances.length > 0) {
    distancesArray = requestData.distances.map((d) => ({
      raceTitle: d.raceTitle || "",
      label: d.label || "",
      price: parseFloat(d.price) || 0,
      startTime: d.startTime || "",
      elevationGain: d.elevationGain || "",
      cutoffTime: d.cutoffTime || "",
      capacity: parseInt(d.capacity, 10) || 0,
      terrainTechnicality: parseInt(d.terrainTechnicality, 10) || 0,
      gpxRouteLink: d.gpxRouteLink || "",
      // Per-distance guide fields
      aidStations: d.aidStations ? parseInt(d.aidStations, 10) || 0 : 0,
      aidStationDetails: d.aidStationDetails || "",
      mandatoryGear: d.mandatoryGear || "",
      terrainNotes: d.terrainNotes || "",
      pacerPolicy: d.pacerPolicy || "",
      crewAccess: d.crewAccess || "",
      crewParking: d.crewParking || "",
      description: d.description || "",
    }));
  } else {
    // Legacy: build a single-distance entry from flat fields
    const legacyLabels = Array.isArray(requestData.distancesOffered)
      ? requestData.distancesOffered
      : [];
    distancesArray = [{
      label: legacyLabels[0] || requestData.raceName || "Main",
      price: requestData.price ? parseFloat(requestData.price) || 0 : 0,
      startTime: requestData.startTime || "",
      elevationGain: requestData.elevationGain || requestData.elevation || "",
      cutoffTime: requestData.cutoffTime || "",
      capacity: requestData.capacity ? parseInt(requestData.capacity, 10) || 0 : 0,
      terrainTechnicality: requestData.terrainTechnicality ? parseInt(requestData.terrainTechnicality, 10) || 0 : 0,
      gpxRouteLink: requestData.gpxRouteLink || "",
      // Legacy guide fields from event level
      aidStations: requestData.aidStations ? parseInt(requestData.aidStations, 10) || 0 : 0,
      aidStationDetails: requestData.aidStationDetails || "",
      mandatoryGear: requestData.mandatoryGear || "",
      terrainNotes: requestData.terrainNotes || "",
      pacerPolicy: requestData.pacerPolicy || "",
      crewAccess: requestData.crewAccess || "",
      crewParking: requestData.crewParking || "",
      description: requestData.description || "",
    }];
  }

  const primaryDist = distancesArray[0] || {};

  const trailRef = admin.firestore().collection("trails").doc();
  const trailData = {
    name: requestData.raceName || requestData.name || "Unnamed Race",
    slogan: requestData.slogan || "",
    location: requestData.location || "",
    date: requestData.date || "",
    registrationStartDate: requestData.registrationStartDate || "",
    registrationEndDate: requestData.registrationEndDate || "",

    // GPS coordinates from submission form geocoding
    ...(typeof requestData.latitude === "number" && typeof requestData.longitude === "number"
      ? { latitude: requestData.latitude, longitude: requestData.longitude }
      : {}),

    // Per-distance array (new)
    distances: distancesArray,

    // Backward-compat flat fields (from primary distance)
    startTime: primaryDist.startTime || "",
    distancesOffered: distancesArray.map((d) => d.label).filter(Boolean),
    elevationGain: primaryDist.elevationGain || "",
    elevation: primaryDist.elevationGain || "",
    price: primaryDist.price || 0,
    capacity: primaryDist.capacity || 0,
    cutoffTime: primaryDist.cutoffTime || "",
    terrainTechnicality: primaryDist.terrainTechnicality || 0,
    gpxRouteLink: primaryDist.gpxRouteLink || "",

    // Event-level fields
    aidStations: requestData.aidStations ? parseInt(requestData.aidStations, 10) || 0 : 0,
    aidStationDetails: requestData.aidStationDetails || "",
    elevationProfiles: requestData.elevationProfiles || "",
    terrainNotes: requestData.terrainNotes || "",
    description: requestData.description || "",
    image: requestData.image || requestData.imageUrl || requestData.featuredImageUrl || "",
    imageUrl: requestData.imageUrl || requestData.image || requestData.featuredImageUrl || "",
    featuredImageUrl: requestData.featuredImageUrl || requestData.image || requestData.imageUrl || "",
    logoUrl: requestData.logoUrl || "",
    mandatoryGear: requestData.mandatoryGear || "",
    checkInDetails: requestData.checkInDetails || "",
    pacerPolicy: requestData.pacerPolicy || "",
    crewAccess: requestData.crewAccess || "",
    crewParking: requestData.crewParking || "",
    refundTerms: requestData.refundTerms || "",
    utmbIndex: requestData.utmbIndex || "",
    itraPoints: requestData.itraPoints || "",
    westernStatesQualifier: requestData.westernStatesQualifier || "",
    difficulty: requestData.difficulty || "",
    website: requestData.website || "",
    socialMedia: requestData.socialMedia || "",
    contactName: requestData.contactName || "",
    contactEmail: requestData.contactEmail || "",
    contactPhone: requestData.contactPhone || "",
    guideOptIn: requestData.guideOptIn === true,
    directorId: userRecord.uid,
    isVisibleOnApp,
    status: "approved",
    approvedAt: now,
    createdAt: now,
  };

  await trailRef.set(trailData);

  const guideData = {
    trailId: trailRef.id,
    requestId,
    name: trailData.name,
    location: trailData.location,
    date: trailData.date,
    startTime: trailData.startTime,
    imageUrl: trailData.imageUrl,
    logoUrl: trailData.logoUrl,
    distances: trailData.distances || [],
    distancesOffered: trailData.distancesOffered,
    elevationGain: trailData.elevationGain,
    elevationProfiles: trailData.elevationProfiles,
    terrainNotes: trailData.terrainNotes || "",
    aidStations: trailData.aidStations || 0,
    aidStationDetails: trailData.aidStationDetails || "",
    cutoffTime: trailData.cutoffTime || "",
    mandatoryGear: trailData.mandatoryGear || "",
    checkInDetails: trailData.checkInDetails || "",
    pacerPolicy: trailData.pacerPolicy || "",
    crewAccess: trailData.crewAccess || "",
    crewParking: trailData.crewParking || "",
    description: trailData.description || "",
    website: trailData.website || "",
    contactName: trailData.contactName || "",
    contactEmail: trailData.contactEmail || "",
    status: "published",
    isPublished: true,
    createdAt: now,
    updatedAt: now,
  };

  if (requestData.guideOptIn === true) {
    await admin.firestore().collection("raceGuides").doc(trailRef.id).set(guideData);
  }

  await requestRef.set(
    {
      status: "approved",
      approvedAt: now,
      directorId: userRecord.uid,
      directorEmail,
      trailId: trailRef.id,
    },
    { merge: true }
  );

  return {
    uid: userRecord.uid,
    trailId: trailRef.id,
    tempPassword: tempPassword || null,
    resetLink: resetLink || null,
  };
});

exports.generateDirectorResetLink = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Authentication required.");
  }

  const requesterUid = context.auth.uid;
  const requesterEmail = context.auth.token.email || "";
  const requesterSnap = await admin.firestore().collection("users").doc(requesterUid).get();
  const requesterRole = requesterSnap.exists ? requesterSnap.get("role") : null;

  const isPrivileged = requesterRole === "admin" || requesterEmail === "rolsen83@gmail.com";
  if (!isPrivileged) {
    throw new functions.https.HttpsError("permission-denied", "Not authorized.");
  }

  const directorId = String(data?.directorId || "").trim();
  const directorEmail = String(data?.directorEmail || "").trim().toLowerCase();

  let email = directorEmail;
  if (!email && directorId) {
    const db = admin.firestore();
    const merged = await getMergedUserProfile(db, directorId);
    email = String(merged.email || "").trim().toLowerCase();
  }

  if (!email) {
    throw new functions.https.HttpsError("invalid-argument", "Director email is required.");
  }

  const resetLink = await admin.auth().generatePasswordResetLink(email);
  return { resetLink };
});

// ─── Helper: Send Expo push notifications ───────────────────────────────────
async function sendExpoPushNotifications(messages) {
  if (!messages.length) return;

  const chunks = expo.chunkPushNotifications(messages);
  for (const chunk of chunks) {
    try {
      await expo.sendPushNotificationsAsync(chunk);
    } catch (error) {
      console.error("Error sending push notification chunk:", error);
    }
  }
}

// ─── Trigger: New chat message → push notification ──────────────────────────
exports.onNewChatMessage = functions.firestore
  .document("chats/{chatId}/messages/{messageId}")
  .onCreate(async (snap, context) => {
    const { chatId } = context.params;
    const messageData = snap.data();
    const senderId = messageData.userId;
    const text = messageData.text || "";

    if (!senderId) return null;

    // Get the chat document to find the other user
    const chatDoc = await admin.firestore().collection("chats").doc(chatId).get();
    if (!chatDoc.exists) return null;

    const chatData = chatDoc.data();
    // Try userIds array first, then fall back to parsing chatId (format: uid1_uid2)
    let userIds = chatData.userIds || [];
    if (!userIds.length && chatId.includes("_")) {
      userIds = chatId.split("_");
    }
    const recipientId = userIds.find((uid) => uid !== senderId);

    // CRITICAL: Never notify the sender, and ensure we have a valid recipient
    if (!recipientId || recipientId === senderId) {
      console.log("onNewChatMessage: No valid recipient or recipient is sender. Skipping.");
      return null;
    }

    const db = admin.firestore();
    // Sender / recipient: merged root + private/account (expoPushToken lives in private)
    const senderData = await getMergedUserProfile(db, senderId);
    const senderName = senderData.username || senderData.name || "Someone";
    const senderPushToken = senderData.expoPushToken || null;

    const recipientRoot = await db.collection("users").doc(recipientId).get();
    if (!recipientRoot.exists) return null;

    const recipientData = await getMergedUserProfile(db, recipientId);
    const pushToken = recipientData.expoPushToken;
    if (!pushToken || !Expo.isExpoPushToken(pushToken)) return null;

    // CRITICAL: If the sender and recipient have the SAME push token
    // (e.g. same physical device, testing with two accounts), skip notification
    // to avoid the sender receiving their own message notification
    if (senderPushToken && pushToken === senderPushToken) {
      console.log("onNewChatMessage: Recipient push token matches sender (same device). Skipping.");
      return null;
    }

    // Build and send the notification
    const truncatedText = text.length > 100 ? text.substring(0, 100) + "…" : text;

    await sendExpoPushNotifications([
      {
        to: pushToken,
        sound: "default",
        title: senderName,
        body: truncatedText || "Sent you a message",
        data: {
          chatId,
          buddyId: senderId,
          type: "chat_message",
        },
        channelId: "chat",
      },
    ]);

    return null;
  });

// ─── New message → mark recipient has unread (global tab indicator) ─────────
exports.onNewMessageUpdateUnread = functions.firestore
  .document("chats/{chatId}/messages/{messageId}")
  .onCreate(async (snap, context) => {
    const { chatId } = context.params;
    const senderId = snap.data()?.userId;
    if (!senderId) return null;

    const db = admin.firestore();
    const chatDoc = await db.collection("chats").doc(chatId).get();
    if (!chatDoc.exists) return null;

    const chatData = chatDoc.data();
    let userIds = chatData.userIds || [];
    if (!userIds.length && typeof chatId === "string" && chatId.includes("_")) {
      userIds = chatId.split("_");
    }
    const recipientId = userIds.find((uid) => uid !== senderId);
    if (!recipientId || recipientId === senderId) return null;

    const recipientRef = db.collection("users").doc(recipientId);
    const recipientSnap = await recipientRef.get();
    if (!recipientSnap.exists) return null;

    await recipientRef.update({ hasUnreadMessages: true });

    await db
      .collection("chats")
      .doc(chatId)
      .set(
        {
          lastMessageAt: admin.firestore.FieldValue.serverTimestamp(),
          lastMessageSenderId: senderId,
        },
        { merge: true }
      );
    return null;
  });

// ─── Trigger: New chat invite (pending request) → push notification ─────────
exports.onChatInvite = functions.firestore
  .document("chats/{chatId}")
  .onCreate(async (snap, context) => {
    const { chatId } = context.params;
    const chatData = snap.data();

    // Only send notification for pending chat requests
    if (chatData.status !== "pending") return null;

    const requestedBy = chatData.requestedBy;
    const userIds = chatData.userIds || [];
    if (!requestedBy || userIds.length < 2) return null;

    const recipientId = userIds.find((uid) => uid !== requestedBy);
    if (!recipientId) return null;

    const db = admin.firestore();
    const recipientRoot = await db.collection("users").doc(recipientId).get();
    if (!recipientRoot.exists) return null;

    const recipientData = await getMergedUserProfile(db, recipientId);
    const pushToken = recipientData.expoPushToken;
    if (!pushToken || !Expo.isExpoPushToken(pushToken)) return null;

    const senderData = await getMergedUserProfile(db, requestedBy);
    const senderName = senderData.username || senderData.name || "Someone";

    await sendExpoPushNotifications([
      {
        to: pushToken,
        sound: "default",
        title: "New Chat Invite",
        body: `${senderName} wants to chat with you!`,
        data: {
          chatId,
          buddyId: requestedBy,
          type: "chat_invite",
        },
        channelId: "chat",
      },
    ]);

    return null;
  });

// ═══════════════════════════════════════════════════════════════════════════════
// STRIPE PAYMENT FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Create Payment Intent for race registration ─────────────────────────────
exports.createPaymentIntent = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Must be logged in.");
  }
  if (!stripe) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Stripe is not configured. Set STRIPE_SECRET_KEY (secret) or firebase functions:config:set stripe.secret / stripe.secret_key."
    );
  }

  const { trailId, distance, amount } = data;

  if (!trailId || !amount || amount <= 0) {
    throw new functions.https.HttpsError("invalid-argument", "trailId and a positive amount are required.");
  }

  const userId = context.auth.uid;
  const amountInCents = Math.round(amount * 100);

  const trailSnap = await admin.firestore().collection("trails").doc(trailId).get();
  if (!trailSnap.exists) {
    throw new functions.https.HttpsError("not-found", "Race not found.");
  }

  const trailData = trailSnap.data();
  const directorId = trailData.directorId;

  let stripeAccountId = null;
  if (directorId) {
    const directorSnap = await admin.firestore().collection("users").doc(directorId).get();
    if (directorSnap.exists) {
      stripeAccountId = directorSnap.data().stripeAccountId || null;
    }
  }

  const db = admin.firestore();
  const userData = await getMergedUserProfile(db, userId);
  let stripeCustomerId = userData.stripeCustomerId;

  if (!stripeCustomerId) {
    const customer = await stripe.customers.create({
      email: userData.email || context.auth.token.email || "",
      metadata: { firebaseUid: userId },
    });
    stripeCustomerId = customer.id;
    await usersPrivateAccountRef(db, userId).set({ stripeCustomerId: customer.id }, { merge: true });
  }

  const ephemeralKey = await stripe.ephemeralKeys.create(
    { customer: stripeCustomerId },
    { apiVersion: "2024-12-18.acacia" }
  );

  const paymentIntentParams = {
    amount: amountInCents,
    currency: "usd",
    customer: stripeCustomerId,
    metadata: { trailId, userId, distance: distance || "", raceName: trailData.name || "" },
  };

  if (stripeAccountId) {
    const platformFee = Math.round(amountInCents * (PLATFORM_FEE_PERCENT / 100));
    paymentIntentParams.application_fee_amount = platformFee;
    paymentIntentParams.transfer_data = { destination: stripeAccountId };
  }

  const paymentIntent = await stripe.paymentIntents.create(paymentIntentParams);

  await admin.firestore().collection("payments").add({
    userId, trailId, distance: distance || "", raceName: trailData.name || "",
    amountCents: amountInCents,
    platformFeeCents: stripeAccountId ? Math.round(amountInCents * (PLATFORM_FEE_PERCENT / 100)) : amountInCents,
    directorId: directorId || null,
    stripePaymentIntentId: paymentIntent.id,
    status: "pending",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return {
    clientSecret: paymentIntent.client_secret,
    ephemeralKey: ephemeralKey.secret,
    customerId: stripeCustomerId,
    paymentIntentId: paymentIntent.id,
  };
});

// ─── Confirm Payment ─────────────────────────────────────────────────────────
exports.confirmPayment = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Must be logged in.");
  }
  const { paymentIntentId } = data;
  if (!paymentIntentId) {
    throw new functions.https.HttpsError("invalid-argument", "paymentIntentId is required.");
  }
  const q = await admin.firestore().collection("payments").where("stripePaymentIntentId", "==", paymentIntentId).limit(1).get();
  if (!q.empty) {
    await q.docs[0].ref.update({ status: "succeeded", completedAt: admin.firestore.FieldValue.serverTimestamp() });
  }
  return { success: true };
});

// ═══════════════════════════════════════════════════════════════════════════════
// STRIPE CONNECT (Race Directors)
// ═══════════════════════════════════════════════════════════════════════════════

exports.createStripeConnectAccount = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Must be logged in.");
  if (!stripe) throw new functions.https.HttpsError("failed-precondition", "Stripe not configured.");

  const userId = context.auth.uid;
  const userEmail = context.auth.token.email || "";

  const userSnap = await admin.firestore().collection("users").doc(userId).get();
  if (userSnap.exists && userSnap.data().stripeAccountId) {
    throw new functions.https.HttpsError("already-exists", "Stripe account already connected.");
  }

  const account = await stripe.accounts.create({
    type: "express",
    email: userEmail,
    capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
    metadata: { firebaseUid: userId },
  });

  await admin.firestore().collection("users").doc(userId).update({
    stripeAccountId: account.id,
    stripeOnboardingComplete: false,
  });

  return { accountId: account.id };
});

exports.getStripeConnectOnboardingLink = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Must be logged in.");
  if (!stripe) throw new functions.https.HttpsError("failed-precondition", "Stripe not configured.");

  const userId = context.auth.uid;
  const { returnUrl, refreshUrl } = data;

  const userSnap = await admin.firestore().collection("users").doc(userId).get();
  if (!userSnap.exists || !userSnap.data().stripeAccountId) {
    throw new functions.https.HttpsError("not-found", "No Stripe account. Create one first.");
  }

  const accountLink = await stripe.accountLinks.create({
    account: userSnap.data().stripeAccountId,
    refresh_url: refreshUrl || "https://trailmatch-49203553-49000.web.app/stripe-refresh",
    return_url: returnUrl || "https://trailmatch-49203553-49000.web.app/stripe-return",
    type: "account_onboarding",
  });

  return { url: accountLink.url };
});

exports.getStripeDashboardLink = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Must be logged in.");
  if (!stripe) throw new functions.https.HttpsError("failed-precondition", "Stripe not configured.");

  const userId = context.auth.uid;
  const userSnap = await admin.firestore().collection("users").doc(userId).get();
  if (!userSnap.exists || !userSnap.data().stripeAccountId) {
    throw new functions.https.HttpsError("not-found", "No Stripe account found.");
  }

  const loginLink = await stripe.accounts.createLoginLink(userSnap.data().stripeAccountId);
  return { url: loginLink.url };
});

exports.getStripeAccountStatus = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Must be logged in.");
  if (!stripe) throw new functions.https.HttpsError("failed-precondition", "Stripe not configured.");

  const userId = context.auth.uid;
  const userSnap = await admin.firestore().collection("users").doc(userId).get();
  if (!userSnap.exists || !userSnap.data().stripeAccountId) {
    return { connected: false, onboardingComplete: false };
  }

  try {
    const account = await stripe.accounts.retrieve(userSnap.data().stripeAccountId);
    console.log("Stripe account status:", JSON.stringify({
      id: account.id,
      charges_enabled: account.charges_enabled,
      payouts_enabled: account.payouts_enabled,
      details_submitted: account.details_submitted,
      requirements: account.requirements?.currently_due,
    }));
    // details_submitted means the director finished the onboarding form
    // charges_enabled/payouts_enabled may lag behind in test mode
    const complete = account.details_submitted === true;
    if (complete && !userSnap.data().stripeOnboardingComplete) {
      await admin.firestore().collection("users").doc(userId).update({ stripeOnboardingComplete: true });
    }
    return {
      connected: true,
      onboardingComplete: complete,
      chargesEnabled: account.charges_enabled,
      payoutsEnabled: account.payouts_enabled,
      detailsSubmitted: account.details_submitted,
    };
  } catch (err) {
    console.error("Error retrieving Stripe account:", err);
    return { connected: false, onboardingComplete: false };
  }
});

exports.getDirectorEarnings = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Must be logged in.");

  const userId = context.auth.uid;
  const q = await admin.firestore().collection("payments").where("directorId", "==", userId).where("status", "==", "succeeded").get();

  let totalRevenue = 0, totalFees = 0, totalCount = 0;
  const raceBreakdown = {};

  q.forEach((d) => {
    const p = d.data();
    totalRevenue += p.amountCents || 0;
    totalFees += p.platformFeeCents || 0;
    totalCount += 1;
    const rn = p.raceName || "Unknown";
    if (!raceBreakdown[rn]) raceBreakdown[rn] = { revenue: 0, fees: 0, count: 0 };
    raceBreakdown[rn].revenue += p.amountCents || 0;
    raceBreakdown[rn].fees += p.platformFeeCents || 0;
    raceBreakdown[rn].count += 1;
  });

  return { totalRevenueCents: totalRevenue, totalPlatformFeesCents: totalFees, totalNetEarningsCents: totalRevenue - totalFees, totalRegistrations: totalCount, raceBreakdown, platformFeePercent: PLATFORM_FEE_PERCENT };
});

exports.processRefund = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Must be logged in.");
  if (!stripe) throw new functions.https.HttpsError("failed-precondition", "Stripe not configured.");

  const { paymentIntentId, reason } = data;
  if (!paymentIntentId) throw new functions.https.HttpsError("invalid-argument", "paymentIntentId required.");

  const userId = context.auth.uid;
  const userSnap = await admin.firestore().collection("users").doc(userId).get();
  const userRole = userSnap.exists ? userSnap.data().role : null;

  const q = await admin.firestore().collection("payments").where("stripePaymentIntentId", "==", paymentIntentId).limit(1).get();
  if (q.empty) throw new functions.https.HttpsError("not-found", "Payment not found.");

  const paymentDoc = q.docs[0];
  const pd = paymentDoc.data();

  if (pd.userId !== userId && pd.directorId !== userId && userRole !== "admin") {
    throw new functions.https.HttpsError("permission-denied", "Not authorized.");
  }

  const refund = await stripe.refunds.create({ payment_intent: paymentIntentId, reason: reason || "requested_by_customer" });

  await paymentDoc.ref.update({
    status: "refunded", refundId: refund.id,
    refundedAt: admin.firestore.FieldValue.serverTimestamp(),
    refundReason: reason || "requested_by_customer",
  });

  return { success: true, refundId: refund.id };
});

// ─── RunSignup Race Importer ─────────────────────────────────────────────────

// US states with strong trail running communities
const TRAIL_STATES = [
  "UT", "CO", "OR", "CA", "NC", "MT", "WA", "VA", "NY", "PA",
  "VT", "NH", "GA", "TN", "AZ", "NM", "ID", "WY", "ME", "WV",
];

/**
 * Strip HTML tags from a string, preserving paragraph/line breaks
 */
function stripHtml(html) {
  if (!html) return "";
  return html
    // Turn block-level tags into double newlines (paragraph breaks)
    .replace(/<\/?(p|div|h[1-6]|blockquote|section|article|header|footer|main|aside|table|thead|tbody|tr)[^>]*>/gi, "\n\n")
    // Turn line-break tags into single newlines
    .replace(/<br\s*\/?>/gi, "\n")
    // Turn list items into bullet points
    .replace(/<li[^>]*>/gi, "\n• ")
    .replace(/<\/li>/gi, "")
    // Remove remaining HTML tags
    .replace(/<[^>]*>/g, " ")
    // Decode common HTML entities
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#34;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    // Collapse multiple spaces on the same line (but keep newlines)
    .replace(/[^\S\n]+/g, " ")
    // Collapse 3+ newlines into 2
    .replace(/\n{3,}/g, "\n\n")
    // Trim each line
    .split("\n").map((l) => l.trim()).join("\n")
    .trim()
    .slice(0, 2000); // Cap at 2000 chars
}

/**
 * Convert RunSignup date string (MM/DD/YYYY) to YYYY-MM-DD
 */
function formatRSDate(dateStr) {
  if (!dateStr) return "";
  const parts = dateStr.split("/");
  if (parts.length === 3) {
    return `${parts[2]}-${parts[0].padStart(2, "0")}-${parts[1].padStart(2, "0")}`;
  }
  return dateStr;
}

/**
 * Fetch races from RunSignup for a single state + page
 */
/**
 * Make an HTTPS GET request and return parsed JSON (using native Node.js https)
 */
function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          console.error("JSON parse error:", data.slice(0, 200));
          reject(e);
        }
      });
    }).on("error", reject);
  });
}

async function fetchRunSignupRaces(state, page = 1) {
  // RunSignup expects YYYY-MM-DD format
  const now = new Date();
  const startDate = now.toISOString().split("T")[0]; // e.g. "2026-03-04"
  const endDate = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

  const url = `https://runsignup.com/Rest/races?format=json&only_trail_races=T&state=${state}&start_date=${startDate}&end_date=${endDate}&results_per_page=250&page=${page}`;
  console.log(`Fetching: ${url}`);

  try {
    const data = await httpsGet(url);
    const races = (data.races || []).map((r) => r.race);
    console.log(`${state}: API returned ${races.length} races`);
    return races;
  } catch (err) {
    console.error(`Fetch error for ${state}:`, err.message);
    return [];
  }
}

/**
 * Fetch detailed event/distance info for a single race
 */
async function fetchRaceDetails(raceId) {
  const url = `https://runsignup.com/Rest/race/${raceId}?format=json&include_events=T`;
  try {
    const data = await httpsGet(url);
    return data.race || null;
  } catch (err) {
    console.error(`Error fetching race ${raceId} details:`, err.message);
    return null;
  }
}

/**
 * Check if a race is a bike/cycling race based on its name, description, or sport_type.
 * Returns true if the race appears to be a bike race and should be excluded.
 */
function isBikeOrCyclingRace(race) {
  const bikeKeywords = [
    "bike", "biking", "cycling", "cyclist", "bicycle",
    "mtb", "mountain bike", "gravel ride", "gravel grind",
    "pedal", "criterium", "crit race", "velodrome",
    "cyclocross", "cx race", "tour de", "gran fondo",
    "fondo", "century ride", "fat tire",
  ];

  const name = (race.name || race.EventName || "").toLowerCase();
  const description = (race.description || "").toLowerCase();
  const sportType = (race.sport_type || "").toLowerCase();

  // If RunSignup provides a sport_type and it's not running/trail, exclude it
  if (sportType && sportType !== "running" && sportType !== "trail_running" && sportType !== "") {
    // Only exclude if it's explicitly a non-running sport
    if (sportType === "cycling" || sportType === "biking" || sportType === "triathlon" ||
        sportType === "duathlon" || sportType === "mountain_biking") {
      return true;
    }
  }

  // Check name and description for bike keywords
  for (const keyword of bikeKeywords) {
    if (name.includes(keyword) || description.includes(keyword)) {
      return true;
    }
  }

  return false;
}

/**
 * Map a RunSignup race to our Firestore trails schema
 */
function mapRunSignupToTrail(race, details) {
  const events = details?.events || [];
  const city = race.address?.city || "";
  const state = race.address?.state || "";
  const location = city && state ? `${city}, ${state}` : city || state || "Unknown";

  // Build distances array from events — deduplicate by label
  const rawDistances = events
    .filter((e) => e.event_type === "running_race" || !e.volunteer || e.volunteer === "F")
    .map((e) => {
      const currentPeriod = e.registration_periods?.[0];
      const feeStr = currentPeriod?.race_fee || "$0";
      const price = parseFloat(feeStr.replace(/[^0-9.]/g, "")) || 0;

      return {
        raceTitle: e.name || "",
        label: e.distance || e.name || "",
        price: price,
        startTime: e.start_time ? e.start_time.split(" ").pop() || "" : "",
        elevationGain: "",
        cutoffTime: "",
        capacity: e.participant_cap || 0,
        terrainTechnicality: 0,
        gpxRouteLink: "",
      };
    });

  // Filter out junk/non-race distances (volunteer shifts, donations, "ignore", etc.)
  const JUNK_LABELS = new Set([
    "ignore", "volunteer", "donation", "spectator", "crew",
    "virtual", "n/a", "none", "test", "placeholder",
  ]);
  const filteredDistances = rawDistances.filter((d) => {
    const label = (d.label || "").toLowerCase().trim();
    if (!label) return false;
    if (JUNK_LABELS.has(label)) return false;
    // Also filter labels that are clearly not distances (too generic)
    if (label === "other" || label === "misc") return false;
    return true;
  });

  // Deduplicate — RunSignup can have multiple events with the same distance label
  const seenLabels = new Set();
  const distances = filteredDistances.filter((d) => {
    const key = (d.label || "").toLowerCase().trim();
    if (!key || seenLabels.has(key)) return false;
    seenLabels.add(key);
    return true;
  });

  const distancesOffered = distances.map((d) => d.label).filter(Boolean);

  // Use the lowest current price as the headline price
  const prices = distances.map((d) => d.price).filter((p) => p > 0);
  const headlinePrice = prices.length > 0 ? Math.min(...prices) : 0;

  return {
    name: race.name || "Unnamed Race",
    location: location,
    date: formatRSDate(race.next_date),
    description: stripHtml(race.description),
    slogan: "", // RunSignup doesn't have slogans
    image: race.logo_url || "",
    imageUrl: race.logo_url || "",
    featuredImageUrl: race.logo_url || "",
    logoUrl: race.logo_url || "",
    distancesOffered: distancesOffered,
    distances: distances,
    price: headlinePrice,
    elevation: "",
    elevationGain: "",
    startTime: distances[0]?.startTime || "",
    capacity: distances[0]?.capacity || 0,
    website: race.external_race_url || race.url || "",
    // RunSignup-specific fields
    source: "runsignup",
    runsignupRaceId: race.race_id,
    runsignupUrl: race.url || "",
    registrationType: "external", // Opens RunSignup in browser
    isRegistrationOpen: race.is_registration_open === "T",
    // Visibility — show these in the app
    isVisibleOnApp: true,
    // Geo data — extract from RunSignup address when available
    latitude: race.address?.lat ? parseFloat(race.address.lat) : null,
    longitude: race.address?.lng ? parseFloat(race.address.lng) : null,
    // Timestamps
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    lastSyncedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
}

/**
 * Scheduled Cloud Function: Syncs RunSignup trail races daily at 2am CT
 * Runs through all target states, imports new races, updates existing ones.
 */
exports.syncRunSignupRaces = functions
  .runWith({ timeoutSeconds: 540, memory: "512MB" }) // 9 min timeout, extra memory
  .pubsub.schedule("0 2 * * *") // Every day at 2:00 AM
  .timeZone("America/Chicago")
  .onRun(async (context) => {
    console.log("Starting daily RunSignup race sync...");

    const db = admin.firestore();
    let totalImported = 0;
    let totalSkipped = 0;

    // Load all existing runsignup race IDs once
    const existingSnap = await db
      .collection("trails")
      .where("source", "==", "runsignup")
      .select("runsignupRaceId")
      .get();
    const existingRaceIds = new Set();
    existingSnap.forEach((doc) => {
      const rid = doc.data().runsignupRaceId;
      if (rid !== undefined) existingRaceIds.add(rid);
    });
    console.log(`Found ${existingRaceIds.size} existing RunSignup races in Firestore`);

    for (const state of TRAIL_STATES) {
      try {
        const races = await fetchRunSignupRaces(state);
        console.log(`${state}: Found ${races.length} trail races`);

        // Filter out bike/cycling races
        const runningRaces = races.filter((r) => !isBikeOrCyclingRace(r));
        const bikeFiltered = races.length - runningRaces.length;
        if (bikeFiltered > 0) {
          console.log(`${state}: Filtered out ${bikeFiltered} bike/cycling races`);
        }

        const newRaces = runningRaces.filter((r) => !existingRaceIds.has(r.race_id));
        totalSkipped += (runningRaces.length - newRaces.length);

        if (newRaces.length === 0) {
          console.log(`${state}: No new races to import`);
          continue;
        }

        // Batch write new races
        const BATCH_SIZE = 400;
        for (let i = 0; i < newRaces.length; i += BATCH_SIZE) {
          const batch = db.batch();
          const chunk = newRaces.slice(i, i + BATCH_SIZE);
          for (const race of chunk) {
            const trailData = mapRunSignupToTrail(race, null);
            batch.set(db.collection("trails").doc(), trailData);
          }
          await batch.commit();
          totalImported += chunk.length;
        }

        console.log(`${state}: Imported ${newRaces.length} new races`);
      } catch (stateErr) {
        console.error(`Error processing state ${state}:`, stateErr.message);
      }
    }

    console.log(`Daily sync complete: ${totalImported} imported, ${totalSkipped} already existed`);
    return null;
  });

/**
 * Callable function: Manually trigger a RunSignup sync (for admin use)
 * Syncs ONE state at a time. The admin portal calls this per state in a loop.
 * Pass { state: "CO" } to sync a single state — or omit for all states (not recommended).
 */
exports.manualRunSignupSync = functions
  .runWith({ timeoutSeconds: 540, memory: "512MB" })
  .https.onCall(async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError("unauthenticated", "Must be logged in.");
    }

    // Check if admin (by role or email)
    const userSnap = await admin.firestore().collection("users").doc(context.auth.uid).get();
    const isAdmin = (userSnap.exists && userSnap.data().role === "admin") ||
      context.auth.token.email === "rolsen83@gmail.com" ||
      context.auth.token.email === "steff.gardner@mac.com";
    if (!isAdmin) {
      throw new functions.https.HttpsError("permission-denied", "Admin access required.");
    }

    // Determine which states to sync
    const targetStates = data?.state
      ? [data.state]                         // Single state
      : (data?.states || TRAIL_STATES);      // Array or all

    const db = admin.firestore();
    let totalImported = 0;
    let totalUpdated = 0;
    let totalSkipped = 0;

    for (const state of targetStates) {
      try {
        const races = await fetchRunSignupRaces(state);
        console.log(`Manual sync — ${state}: ${races.length} races from API`);

        if (races.length === 0) continue;

        // Filter out bike/cycling races
        const runningRaces = races.filter((r) => !isBikeOrCyclingRace(r));
        const bikeFiltered = races.length - runningRaces.length;
        if (bikeFiltered > 0) {
          console.log(`${state}: Filtered out ${bikeFiltered} bike/cycling races`);
        }

        if (runningRaces.length === 0) continue;

        // Build a set of existing runsignupRaceIds to avoid querying one by one
        const existingSnap = await db
          .collection("trails")
          .where("source", "==", "runsignup")
          .where("location", ">=", "")  // just to narrow
          .get();

        const existingRaceIds = new Set();
        existingSnap.forEach((doc) => {
          const rid = doc.data().runsignupRaceId;
          if (rid !== undefined) existingRaceIds.add(rid);
        });

        // Filter to only truly new races
        const newRaces = runningRaces.filter((r) => !existingRaceIds.has(r.race_id));
        totalSkipped += (runningRaces.length - newRaces.length);
        console.log(`${state}: ${newRaces.length} new, ${runningRaces.length - newRaces.length} already exist`);

        // Batch-write new races (max 500 per batch)
        const BATCH_SIZE = 400;
        for (let i = 0; i < newRaces.length; i += BATCH_SIZE) {
          const batch = db.batch();
          const chunk = newRaces.slice(i, i + BATCH_SIZE);

          for (const race of chunk) {
            // Map from list data only (no detail fetch = fast)
            const trailData = mapRunSignupToTrail(race, null);
            const newRef = db.collection("trails").doc();
            batch.set(newRef, trailData);
          }

          await batch.commit();
          totalImported += chunk.length;
          console.log(`${state}: Batch wrote ${chunk.length} races`);
        }
      } catch (stateErr) {
        console.error(`Error syncing ${state}:`, stateErr.message);
      }
    }

    console.log(`Manual sync done: ${totalImported} imported, ${totalUpdated} updated, ${totalSkipped} skipped`);
    return { success: true, imported: totalImported, updated: totalUpdated, skipped: totalSkipped };
  });

// ─── UltraSignup Race Importer ──────────────────────────────────────────────

/**
 * Fetch races from UltraSignup's event search endpoint.
 * Returns an array of unique events (deduplicated by EventId).
 */
async function fetchUltraSignupRaces() {
  const url = "https://ultrasignup.com/service/events.svc/closestevents?open=1&past=0&lat=0&lng=0&mi=50000&mo=12";
  let events;
  try {
    events = await httpsGet(url);
  } catch (e) {
    console.error("Failed to fetch UltraSignup events:", e.message);
    return [];
  }
  if (!Array.isArray(events)) {
    console.error("UltraSignup response is not an array:", typeof events);
    return [];
  }

  // UltraSignup returns duplicate rows per distance — deduplicate by EventId,
  // merging all distances into a single entry.
  const eventMap = new Map();
  for (const ev of events) {
    if (ev.Cancelled || ev.VirtualEvent) continue;
    const id = ev.EventId;
    if (eventMap.has(id)) {
      const existing = eventMap.get(id);
      // Merge distances
      if (ev.Distances && !existing._allDistances.includes(ev.Distances)) {
        existing._allDistances.push(ev.Distances);
      }
    } else {
      eventMap.set(id, { ...ev, _allDistances: ev.Distances ? [ev.Distances] : [] });
    }
  }
  return Array.from(eventMap.values());
}

/**
 * Map an UltraSignup event to our Firestore trails schema.
 */
function mapUltraSignupToTrail(event) {
  const city = event.City || "";
  const state = event.State || "";
  const location = city && state ? `${city}, ${state}` : city || state || "Unknown";

  // Parse distances into our format
  const allDistStrings = event._allDistances || [];
  const distances = allDistStrings.map((distStr) => ({
    raceTitle: distStr,
    label: distStr,
    price: 0,
    startTime: "",
    elevationGain: "",
    cutoffTime: "",
    capacity: 0,
    terrainTechnicality: 0,
    gpxRouteLink: "",
  }));
  const distancesOffered = allDistStrings;

  // Parse date (MM/DD/YYYY format)
  let formattedDate = "";
  if (event.EventDate) {
    const cleaned = event.EventDate.replace(/\\/g, "");
    const parts = cleaned.split("/");
    if (parts.length === 3) {
      formattedDate = `${parts[2]}-${parts[0].padStart(2, "0")}-${parts[1].padStart(2, "0")}`;
    }
  }

  // Build image URL from UltraSignup's image service
  let imageUrl = "";
  if (event.EventImages && event.EventImages.length > 0 && event.EventImages[0].ImageId) {
    imageUrl = `https://ultrasignup.com/service/events.svc/image/${event.EventImages[0].ImageId}`;
  } else if (event.BannerId) {
    imageUrl = `https://ultrasignup.com/service/events.svc/image/${event.BannerId}`;
  }

  // Build registration URL
  const ultrasignupUrl = event.EventDateId
    ? `https://ultrasignup.com/register.aspx?did=${event.EventDateId}`
    : `https://ultrasignup.com/register.aspx?eid=${event.EventId}`;

  return {
    name: event.EventName || "Unnamed Race",
    location: location,
    date: formattedDate,
    description: "", // UltraSignup search doesn't return descriptions
    slogan: "",
    image: imageUrl,
    imageUrl: imageUrl,
    featuredImageUrl: imageUrl,
    logoUrl: imageUrl,
    distancesOffered: distancesOffered,
    distances: distances,
    price: 0,
    elevation: "",
    elevationGain: "",
    startTime: "",
    capacity: 0,
    website: event.EventWebsite || "",
    // UltraSignup-specific fields
    source: "ultrasignup",
    ultrasignupEventId: event.EventId,
    ultrasignupDateId: event.EventDateId || null,
    ultrasignupUrl: ultrasignupUrl,
    registrationType: "external",
    isRegistrationOpen: true,
    isVisibleOnApp: true,
    // Geo data — UltraSignup provides coordinates!
    latitude: event.Latitude ? parseFloat(event.Latitude) : null,
    longitude: event.Longitude ? parseFloat(event.Longitude) : null,
    // Timestamps
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    lastSyncedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
}

/**
 * Scheduled Cloud Function: Syncs UltraSignup races daily at 3am CT
 */
exports.syncUltraSignupRaces = functions
  .runWith({ timeoutSeconds: 540, memory: "512MB" })
  .pubsub.schedule("0 3 * * *")
  .timeZone("America/Chicago")
  .onRun(async () => {
    console.log("Starting daily UltraSignup race sync...");

    const db = admin.firestore();
    const events = await fetchUltraSignupRaces();
    console.log(`UltraSignup: ${events.length} unique events from API`);

    if (events.length === 0) return null;

    // Get existing UltraSignup event IDs
    const existingSnap = await db
      .collection("trails")
      .where("source", "==", "ultrasignup")
      .select("ultrasignupEventId")
      .get();
    const existingIds = new Set();
    existingSnap.forEach((doc) => {
      const eid = doc.data().ultrasignupEventId;
      if (eid !== undefined) existingIds.add(eid);
    });
    console.log(`Found ${existingIds.size} existing UltraSignup races in Firestore`);

    const newEvents = events.filter((e) => !existingIds.has(e.EventId));
    console.log(`${newEvents.length} new races to import`);

    let totalImported = 0;
    const BATCH_SIZE = 400;
    for (let i = 0; i < newEvents.length; i += BATCH_SIZE) {
      const batch = db.batch();
      const chunk = newEvents.slice(i, i + BATCH_SIZE);
      for (const event of chunk) {
        const trailData = mapUltraSignupToTrail(event);
        batch.set(db.collection("trails").doc(), trailData);
      }
      await batch.commit();
      totalImported += chunk.length;
    }

    console.log(`UltraSignup sync complete: ${totalImported} imported, ${existingIds.size} already existed`);
    return null;
  });

/**
 * Callable function: Manually trigger an UltraSignup sync (for admin use)
 */
exports.manualUltraSignupSync = functions
  .runWith({ timeoutSeconds: 540, memory: "512MB" })
  .https.onCall(async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError("unauthenticated", "Must be logged in.");
    }

    const userSnap = await admin.firestore().collection("users").doc(context.auth.uid).get();
    const isAdmin = (userSnap.exists && userSnap.data().role === "admin") ||
      context.auth.token.email === "rolsen83@gmail.com" ||
      context.auth.token.email === "steff.gardner@mac.com";
    if (!isAdmin) {
      throw new functions.https.HttpsError("permission-denied", "Admin access required.");
    }

    const db = admin.firestore();
    const events = await fetchUltraSignupRaces();
    console.log(`UltraSignup manual sync: ${events.length} unique events from API`);

    if (events.length === 0) {
      return { success: true, imported: 0, skipped: 0 };
    }

    // Get existing UltraSignup event IDs
    const existingSnap = await db
      .collection("trails")
      .where("source", "==", "ultrasignup")
      .select("ultrasignupEventId")
      .get();
    const existingIds = new Set();
    existingSnap.forEach((doc) => {
      const eid = doc.data().ultrasignupEventId;
      if (eid !== undefined) existingIds.add(eid);
    });

    const newEvents = events.filter((e) => !existingIds.has(e.EventId));
    const skipped = events.length - newEvents.length;
    console.log(`${newEvents.length} new, ${skipped} already exist`);

    let totalImported = 0;
    const BATCH_SIZE = 400;
    for (let i = 0; i < newEvents.length; i += BATCH_SIZE) {
      const batch = db.batch();
      const chunk = newEvents.slice(i, i + BATCH_SIZE);
      for (const event of chunk) {
        const trailData = mapUltraSignupToTrail(event);
        batch.set(db.collection("trails").doc(), trailData);
      }
      await batch.commit();
      totalImported += chunk.length;
      console.log(`Batch wrote ${chunk.length} UltraSignup races`);
    }

    console.log(`UltraSignup manual sync done: ${totalImported} imported, ${skipped} skipped`);
    return { success: true, imported: totalImported, skipped: skipped };
  });

// ─── Bike Race Cleanup ──────────────────────────────────────────────────────

/**
 * Callable function: Remove bike/cycling races that were already imported into Firestore.
 * Scans all RunSignup and UltraSignup races and deletes any that match bike keywords.
 */
exports.cleanupBikeRaces = functions
  .runWith({ timeoutSeconds: 540, memory: "512MB" })
  .https.onCall(async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError("unauthenticated", "Must be logged in.");
    }

    const userSnap = await admin.firestore().collection("users").doc(context.auth.uid).get();
    const isAdmin = (userSnap.exists && userSnap.data().role === "admin") ||
      context.auth.token.email === "rolsen83@gmail.com" ||
      context.auth.token.email === "steff.gardner@mac.com";
    if (!isAdmin) {
      throw new functions.https.HttpsError("permission-denied", "Admin access required.");
    }

    const db = admin.firestore();
    const bikeKeywords = [
      "bike", "biking", "cycling", "cyclist", "bicycle",
      "mtb", "mountain bike", "gravel ride", "gravel grind",
      "pedal", "criterium", "crit race", "velodrome",
      "cyclocross", "cx race", "tour de", "gran fondo",
      "fondo", "century ride", "fat tire",
    ];

    // Query all external races
    const snap = await db.collection("trails")
      .where("source", "in", ["runsignup", "ultrasignup"])
      .get();

    const toDelete = [];
    snap.forEach((doc) => {
      const d = doc.data();
      const name = (d.name || "").toLowerCase();
      const description = (d.description || "").toLowerCase();

      for (const keyword of bikeKeywords) {
        if (name.includes(keyword) || description.includes(keyword)) {
          toDelete.push(doc.ref);
          break;
        }
      }
    });

    console.log(`Found ${toDelete.length} bike/cycling races to remove out of ${snap.size} total`);

    // Delete in batches
    const BATCH_SIZE = 400;
    let totalDeleted = 0;
    for (let i = 0; i < toDelete.length; i += BATCH_SIZE) {
      const batch = db.batch();
      const chunk = toDelete.slice(i, i + BATCH_SIZE);
      for (const ref of chunk) {
        batch.delete(ref);
      }
      await batch.commit();
      totalDeleted += chunk.length;
      console.log(`Deleted batch of ${chunk.length} bike races`);
    }

    console.log(`Cleanup complete: ${totalDeleted} bike/cycling races removed`);
    return { success: true, deleted: totalDeleted, scanned: snap.size };
  });

// ─── Geocoding (OpenStreetMap Nominatim — free, no key) ─────────────────────

/**
 * Geocode a city/location string → { lat, lon } using Nominatim
 */
function geocodeLocation(locationStr) {
  const q = encodeURIComponent(locationStr);
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${q}`;

  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "User-Agent": "TheCollective/1.0" } }, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try {
          const results = JSON.parse(data);
          if (results.length > 0) {
            resolve({
              lat: parseFloat(results[0].lat),
              lon: parseFloat(results[0].lon),
            });
          } else {
            resolve(null);
          }
        } catch (e) {
          reject(e);
        }
      });
    }).on("error", reject);
  });
}

/**
 * Callable function: Geocode trails that are missing coordinates
 * Processes up to ~400 unique locations per call (≈7 min at 1 req/sec).
 * Call repeatedly until remaining === 0.
 */
exports.geocodeTrails = functions
  .runWith({ timeoutSeconds: 540, memory: "512MB" })
  .https.onCall(async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError("unauthenticated", "Must be logged in.");
    }
    const userSnap = await admin.firestore().collection("users").doc(context.auth.uid).get();
    const isAdminUser = (userSnap.exists && userSnap.data().role === "admin") ||
      context.auth.token.email === "rolsen83@gmail.com" ||
      context.auth.token.email === "steff.gardner@mac.com";
    if (!isAdminUser) {
      throw new functions.https.HttpsError("permission-denied", "Admin access required.");
    }

    const db = admin.firestore();
    const startTime = Date.now();
    const MAX_RUNTIME_MS = 480000; // 8 minutes safety margin (out of 9 min timeout)

    // Get all trails missing coordinates
    const snap = await db.collection("trails").get();
    const missingDocs = snap.docs.filter((doc) => {
      const d = doc.data();
      return !Number.isFinite(d.latitude) || !Number.isFinite(d.longitude);
    });

    console.log(`Found ${missingDocs.length} trails missing coordinates`);

    // Group docs by location string to avoid duplicate geocode calls
    const locationGroups = {};
    for (const doc of missingDocs) {
      const loc = (doc.data().location || "").trim();
      if (!loc || loc === "Unknown" || loc === "Unknown Location") continue;
      if (!locationGroups[loc]) locationGroups[loc] = [];
      locationGroups[loc].push(doc.ref);
    }

    const uniqueLocations = Object.keys(locationGroups);
    console.log(`${uniqueLocations.length} unique locations to geocode`);

    let geocoded = 0;
    let failed = 0;
    let updated = 0;
    let skippedTimeout = 0;

    for (const loc of uniqueLocations) {
      // Safety: stop before we hit the Cloud Function timeout
      if (Date.now() - startTime > MAX_RUNTIME_MS) {
        skippedTimeout = uniqueLocations.length - geocoded - failed;
        console.log(`Stopping early — ${skippedTimeout} locations remaining (timeout safety)`);
        break;
      }

      try {
        const coords = await geocodeLocation(loc);
        if (coords) {
          // Batch update all docs with this location
          const refs = locationGroups[loc];
          const BATCH_SIZE = 400;
          for (let i = 0; i < refs.length; i += BATCH_SIZE) {
            const batch = db.batch();
            const chunk = refs.slice(i, i + BATCH_SIZE);
            for (const ref of chunk) {
              batch.update(ref, {
                latitude: coords.lat,
                longitude: coords.lon,
              });
            }
            await batch.commit();
            updated += chunk.length;
          }
          geocoded++;
        } else {
          failed++;
          console.log(`No results for: "${loc}"`);
        }
      } catch (err) {
        failed++;
        console.error(`Geocode error for "${loc}":`, err.message);
      }

      // Nominatim rate limit: 1 request per second
      await new Promise((resolve) => setTimeout(resolve, 1100));
    }

    const remaining = uniqueLocations.length - geocoded - failed;
    console.log(`Geocoding batch done: ${geocoded} resolved, ${updated} trails updated, ${failed} failed, ${remaining} remaining`);
    return { success: true, geocoded, updated, failed, remaining, totalLocations: uniqueLocations.length };
  });

// ═══════════════════════════════════════════════════════════════════════════════
// ENGAGEMENT PUSH NOTIFICATIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Helper: Parse various date formats into a JavaScript Date object.
 * Handles Firestore Timestamps, ISO strings ("2026-03-15"), and natural strings ("March 15, 2026").
 */
function parseRaceDate(dateValue) {
  if (!dateValue) return null;
  // Firestore Timestamp object (has _seconds or toDate)
  if (dateValue._seconds) return new Date(dateValue._seconds * 1000);
  if (typeof dateValue.toDate === "function") return dateValue.toDate();
  // String dates
  if (typeof dateValue === "string") {
    const trimmed = dateValue.trim();
    if (!trimmed) return null;
    const parsed = new Date(trimmed);
    if (!isNaN(parsed.getTime())) return parsed;
  }
  return null;
}

/**
 * Helper: Check if two dates fall on the same calendar day.
 */
function isSameDay(d1, d2) {
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  );
}

/**
 * Helper: Calculate distance between two lat/lon pairs in miles (Haversine formula).
 */
function haversineDistance(lat1, lon1, lat2, lon2) {
  const toRad = (v) => (v * Math.PI) / 180;
  const R = 3959; // Earth radius in miles
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── 1. Race Reminders: Daily at 9:00 AM CT ─────────────────────────────────
// Notifies users when their saved/registered races are coming up.
// Sends at 14 days, 7 days, 3 days, and 1 day before the race.
exports.sendRaceReminders = functions
  .runWith({ timeoutSeconds: 300, memory: "256MB" })
  .pubsub.schedule("0 9 * * *") // 9:00 AM every day
  .timeZone("America/Chicago")
  .onRun(async () => {
    const db = admin.firestore();
    const now = new Date();
    now.setHours(0, 0, 0, 0); // Normalize to start of day

    const thresholds = [
      { days: 14, emoji: "📅", message: "is in 2 weeks" },
      { days: 7,  emoji: "🏃", message: "is in 1 week" },
      { days: 3,  emoji: "⏰", message: "is in 3 days" },
      { days: 1,  emoji: "🔥", message: "is TOMORROW" },
    ];

    // 1. Build a map of trailId → Set<userId> from matches + registrations
    const [matchesSnap, regsSnap] = await Promise.all([
      db.collection("matches").get(),
      db.collection("registrations").get(),
    ]);

    const trailUserMap = new Map(); // trailId → Set<userId>
    matchesSnap.forEach((doc) => {
      const { trailId, userId } = doc.data();
      if (!trailId || !userId) return;
      if (!trailUserMap.has(trailId)) trailUserMap.set(trailId, new Set());
      trailUserMap.get(trailId).add(userId);
    });
    regsSnap.forEach((doc) => {
      const { trailId, userId } = doc.data();
      if (!trailId || !userId) return;
      if (!trailUserMap.has(trailId)) trailUserMap.set(trailId, new Set());
      trailUserMap.get(trailId).add(userId);
    });

    if (trailUserMap.size === 0) {
      console.log("Race reminders: No saved/registered races found.");
      return null;
    }

    // 2. Fetch only the trails that users have saved (not all trails)
    const trailIds = Array.from(trailUserMap.keys());
    const trailDataMap = new Map(); // trailId → { name, date }
    const BATCH = 30;
    for (let i = 0; i < trailIds.length; i += BATCH) {
      const chunk = trailIds.slice(i, i + BATCH);
      const promises = chunk.map((id) => db.collection("trails").doc(id).get());
      const docs = await Promise.all(promises);
      docs.forEach((doc) => {
        if (doc.exists) {
          const d = doc.data();
          trailDataMap.set(doc.id, { name: d.name || "Unnamed Race", date: d.date });
        }
      });
    }

    // 3. For each threshold, find matching trails and send notifications
    let totalSent = 0;

    // Pre-fetch all user push tokens in one pass
    const allUserIds = new Set();
    trailUserMap.forEach((userIds) => userIds.forEach((uid) => allUserIds.add(uid)));

    const userTokenMap = new Map(); // userId → { token, name }
    const userIdArr = Array.from(allUserIds);
    for (let i = 0; i < userIdArr.length; i += BATCH) {
      const chunk = userIdArr.slice(i, i + BATCH);
      const mergedList = await Promise.all(chunk.map((uid) => getMergedUserProfile(db, uid)));
      chunk.forEach((uid, idx) => {
        const d = mergedList[idx];
        const token = d.expoPushToken;
        if (token && Expo.isExpoPushToken(token)) {
          userTokenMap.set(uid, { token, name: d.username || d.name || "Runner" });
        }
      });
    }

    for (const threshold of thresholds) {
      const targetDate = new Date(now);
      targetDate.setDate(targetDate.getDate() + threshold.days);

      const messages = [];

      trailDataMap.forEach((trail, trailId) => {
        const raceDate = parseRaceDate(trail.date);
        if (!raceDate || !isSameDay(raceDate, targetDate)) return;

        const userIds = trailUserMap.get(trailId);
        if (!userIds) return;

        userIds.forEach((userId) => {
          const userData = userTokenMap.get(userId);
          if (!userData) return;

          messages.push({
            to: userData.token,
            sound: "default",
            title: `${threshold.emoji} ${trail.name}`,
            body: `Your race ${threshold.message}! Get ready!`,
            data: { trailId, type: "race_reminder" },
            channelId: "race_reminders",
          });
        });
      });

      if (messages.length > 0) {
        await sendExpoPushNotifications(messages);
        totalSent += messages.length;
        console.log(`Race reminders (${threshold.days}d): Sent ${messages.length} notifications`);
      }
    }

    console.log(`Race reminders done: ${totalSent} total notifications sent`);
    return null;
  });

// ─── 2. Weekly Digest: Every Monday at 10:00 AM CT ──────────────────────────
// Notifies users about new races added near their location in the past week.
exports.sendWeeklyDigest = functions
  .runWith({ timeoutSeconds: 300, memory: "256MB" })
  .pubsub.schedule("0 10 * * 1") // 10:00 AM every Monday
  .timeZone("America/Chicago")
  .onRun(async () => {
    const db = admin.firestore();
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    const oneWeekAgoTimestamp = admin.firestore.Timestamp.fromDate(oneWeekAgo);

    // 1. Get all trails added in the last 7 days
    const newTrailsSnap = await db
      .collection("trails")
      .where("createdAt", ">=", oneWeekAgoTimestamp)
      .get();

    if (newTrailsSnap.empty) {
      console.log("Weekly digest: No new races this week.");
      return null;
    }

    const newTrails = [];
    newTrailsSnap.forEach((doc) => {
      const d = doc.data();
      if (d.isVisibleOnApp === false) return;
      newTrails.push({
        id: doc.id,
        name: d.name,
        lat: typeof d.latitude === "number" ? d.latitude : null,
        lon: typeof d.longitude === "number" ? d.longitude : null,
      });
    });

    console.log(`Weekly digest: ${newTrails.length} new races this week`);

    // 2. Get all users with push tokens and location (token may live in private/account)
    const usersSnap = await db.collection("users").get();
    const messages = [];

    for (const doc of usersSnap.docs) {
      const d = await getMergedUserProfile(db, doc.id);
      const token = d.expoPushToken;
      if (!token || !Expo.isExpoPushToken(token)) return;

      const userLat = typeof d.latitude === "number" ? d.latitude : null;
      const userLon = typeof d.longitude === "number" ? d.longitude : null;

      if (userLat === null || userLon === null) {
        // User has no location — still send a generic digest
        if (newTrails.length > 0) {
          messages.push({
            to: token,
            sound: "default",
            title: "🏔️ New Trail Races This Week",
            body: `${newTrails.length} new trail race${newTrails.length === 1 ? "" : "s"} just added! Swipe to discover.`,
            data: { type: "weekly_digest" },
            channelId: "race_reminders",
          });
        }
        continue;
      }

      // Count new races within 150 miles of this user
      const nearbyRaces = newTrails.filter((trail) => {
        if (trail.lat === null || trail.lon === null) return false;
        return haversineDistance(userLat, userLon, trail.lat, trail.lon) <= 150;
      });

      if (nearbyRaces.length > 0) {
        // Personalized "near you" digest
        const locationName = d.locationName || d.location || "";
        const nearText = locationName ? ` near ${locationName}` : " near you";
        messages.push({
          to: token,
          sound: "default",
          title: `🔥 ${nearbyRaces.length} New Race${nearbyRaces.length === 1 ? "" : "s"}${nearText}`,
          body: nearbyRaces.length === 1
            ? `${nearbyRaces[0].name} was just added! Check it out.`
            : `Including ${nearbyRaces[0].name} and ${nearbyRaces.length - 1} more. Swipe to explore!`,
          data: { type: "weekly_digest" },
          channelId: "race_reminders",
        });
      } else if (newTrails.length > 0) {
        // No nearby races but there are new ones elsewhere
        messages.push({
          to: token,
          sound: "default",
          title: "🏔️ New Trail Races This Week",
          body: `${newTrails.length} new race${newTrails.length === 1 ? "" : "s"} added across the US. Swipe to discover!`,
          data: { type: "weekly_digest" },
          channelId: "race_reminders",
        });
      }
    }

    if (messages.length > 0) {
      await sendExpoPushNotifications(messages);
    }

    console.log(`Weekly digest done: Sent ${messages.length} notifications`);
    return null;
  });

// ─── 3. Social Proof: Notify when someone saves a race you also saved ───────
// When a user saves a race, other users who saved the same race get a notification.
exports.onNewRaceMatch = functions.firestore
  .document("matches/{matchId}")
  .onCreate(async (snap, context) => {
    const matchData = snap.data();
    const { trailId, userId: saverId } = matchData;

    if (!trailId || !saverId) return null;

    const db = admin.firestore();

    // Get the race name
    const trailDoc = await db.collection("trails").doc(trailId).get();
    if (!trailDoc.exists) return null;
    const trailName = trailDoc.data().name || "a trail race";

    // Get the saver's name
    const saverDoc = await db.collection("users").doc(saverId).get();
    const saverName = saverDoc.exists
      ? saverDoc.data().username || saverDoc.data().name || "Someone"
      : "Someone";

    // Find other users who also saved this race
    const otherMatchesSnap = await db
      .collection("matches")
      .where("trailId", "==", trailId)
      .get();

    const otherUserIds = new Set();
    otherMatchesSnap.forEach((doc) => {
      const uid = doc.data().userId;
      if (uid && uid !== saverId) otherUserIds.add(uid);
    });

    if (otherUserIds.size === 0) return null;

    // Build and send notifications
    const messages = [];
    const BATCH = 30;
    const otherUserArr = Array.from(otherUserIds);

    for (let i = 0; i < otherUserArr.length; i += BATCH) {
      const chunk = otherUserArr.slice(i, i + BATCH);
      const mergedList = await Promise.all(chunk.map((uid) => getMergedUserProfile(db, uid)));

      chunk.forEach((uid, idx) => {
        const d = mergedList[idx];
        const token = d.expoPushToken;
        if (!token || !Expo.isExpoPushToken(token)) return;

        const totalGoing = otherUserIds.size + 1; // Include the new saver
        messages.push({
          to: token,
          sound: "default",
          title: `👥 ${trailName}`,
          body: totalGoing <= 2
            ? `${saverName} is also going! Say hi 👋`
            : `${saverName} and ${totalGoing - 1} others are going! Connect with them.`,
          data: { trailId, type: "new_race_match" },
          channelId: "social",
        });
      });
    }

    if (messages.length > 0) {
      await sendExpoPushNotifications(messages);
      console.log(`Social proof: Sent ${messages.length} notifications for ${trailName}`);
    }

    return null;
  });

// ═══════════════════════════════════════════════════════════════════════════════
// DEEP LINKING / SHARE PAGE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * HTTP function: Serves a dynamic share page for a race.
 * URL: /race/RACE_ID
 *
 * - Returns HTML with dynamic Open Graph meta tags for rich social previews
 *   (iMessage, WhatsApp, Twitter, Facebook all show race image + title + description)
 * - Shows a beautiful race preview with "Open in App" and "Download" buttons
 * - "Open in App" tries the app’s custom URL scheme first, then falls back to app stores
 */
exports.shareRacePage = functions.https.onRequest(async (req, res) => {
  // Extract race ID from URL path: /race/RACE_ID
  const pathParts = req.path.split("/").filter(Boolean);
  // pathParts might be ["race", "RACE_ID"] or just ["RACE_ID"] depending on hosting rewrite
  const raceId = pathParts.length >= 2 ? pathParts[pathParts.length - 1] : pathParts[0];

  if (!raceId) {
    res.status(404).send("Race not found");
    return;
  }

  try {
    const db = admin.firestore();
    const trailDoc = await db.collection("trails").doc(raceId).get();

    if (!trailDoc.exists) {
      res.status(404).send("Race not found");
      return;
    }

    const race = trailDoc.data();
    const name = race.name || "Trail Race";
    const location = race.location || "";
    const date = race.date || "";
    const description = (race.description || "").substring(0, 200);
    const imageUrl = race.featuredImageUrl || race.imageUrl || race.image || race.logoUrl || "";
    const distances = race.distancesOffered || [];
    const distanceText = distances.length > 0 ? distances.slice(0, 3).join(" · ") : "";
    const price = race.price || "";
    const elevation = race.elevation || "";

    // Build the deep link URL
    const appSchemeUrl = `trailmatch://race-details?id=${raceId}`;
    const webUrl = `https://trailmatch-49203553-49000.web.app/race/${raceId}`;

    // Sanitize values for HTML attribute safety
    const esc = (str) => (str || "").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/&(?!amp;|quot;|lt;|gt;)/g, "&amp;");

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(name)} | The Collective</title>

  <!-- Open Graph (Facebook, iMessage, WhatsApp) -->
  <meta property="og:title" content="${esc(name)}">
  <meta property="og:description" content="${esc(location)}${date ? " · " + esc(date) : ""}${distanceText ? " · " + esc(distanceText) : ""}">
  <meta property="og:image" content="${esc(imageUrl)}">
  <meta property="og:url" content="${esc(webUrl)}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="The Collective">

  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${esc(name)}">
  <meta name="twitter:description" content="${esc(location)}${date ? " · " + esc(date) : ""}">
  <meta name="twitter:image" content="${esc(imageUrl)}">

  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0F1318;
      color: white;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
    }
    .hero {
      width: 100%;
      max-width: 480px;
      position: relative;
    }
    .hero-img {
      width: 100%;
      height: 280px;
      object-fit: cover;
      border-radius: 0 0 24px 24px;
    }
    .hero-gradient {
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      height: 160px;
      background: linear-gradient(transparent, rgba(15,19,24,0.95));
      border-radius: 0 0 24px 24px;
      display: flex;
      align-items: flex-end;
      padding: 20px;
    }
    .hero-text h1 {
      font-size: 26px;
      font-weight: 800;
      line-height: 1.2;
      margin-bottom: 4px;
    }
    .hero-text p {
      font-size: 14px;
      color: #a0aec0;
    }
    .card {
      width: 100%;
      max-width: 480px;
      padding: 0 20px;
      margin-top: 16px;
    }
    .info-grid {
      background: #1E2530;
      border-radius: 16px;
      padding: 20px;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
    }
    .info-item label {
      font-size: 11px;
      color: #718096;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .info-item p {
      font-size: 15px;
      font-weight: 600;
      margin-top: 4px;
      color: #e2e8f0;
    }
    .info-item.highlight p {
      color: #68d391;
    }
    .desc {
      background: #1E2530;
      border-radius: 16px;
      padding: 20px;
      margin-top: 12px;
      font-size: 14px;
      color: #a0aec0;
      line-height: 1.6;
    }
    .buttons {
      width: 100%;
      max-width: 480px;
      padding: 20px;
      margin-top: 8px;
    }
    .btn-open {
      display: block;
      width: 100%;
      padding: 16px;
      background: linear-gradient(135deg, #48bb78, #38a169);
      color: white;
      font-size: 18px;
      font-weight: 700;
      text-align: center;
      border: none;
      border-radius: 16px;
      cursor: pointer;
      text-decoration: none;
      margin-bottom: 12px;
      transition: transform 0.1s;
    }
    .btn-open:active { transform: scale(0.98); }
    .btn-download {
      display: block;
      width: 100%;
      padding: 14px;
      background: transparent;
      color: #68d391;
      font-size: 16px;
      font-weight: 600;
      text-align: center;
      border: 2px solid #68d391;
      border-radius: 16px;
      cursor: pointer;
      text-decoration: none;
      transition: background 0.2s;
    }
    .btn-download:hover { background: rgba(104,211,145,0.1); }
    .logo-bar {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 24px 0 32px;
      opacity: 0.6;
    }
    .logo-bar span {
      font-size: 14px;
      font-weight: 600;
      color: #68d391;
    }
    @media (max-width: 480px) {
      .hero-img { height: 220px; }
      .hero-text h1 { font-size: 22px; }
    }
  </style>
</head>
<body>
  <div class="hero">
    ${imageUrl ? `<img class="hero-img" src="${esc(imageUrl)}" alt="${esc(name)}" onerror="this.style.display='none'">` : `<div style="width:100%;height:280px;background:linear-gradient(135deg,#1a365d,#2d3748);border-radius:0 0 24px 24px"></div>`}
    <div class="hero-gradient">
      <div class="hero-text">
        <h1>${esc(name)}</h1>
        <p>${esc(location)}</p>
      </div>
    </div>
  </div>

  <div class="card">
    <div class="info-grid">
      ${date ? `<div class="info-item"><label>📅 Date</label><p>${esc(date)}</p></div>` : ""}
      ${location ? `<div class="info-item"><label>📍 Location</label><p>${esc(location)}</p></div>` : ""}
      ${distanceText ? `<div class="info-item highlight"><label>🏃 Distances</label><p>${esc(distanceText)}</p></div>` : ""}
      ${elevation ? `<div class="info-item"><label>⛰️ Elevation</label><p>${esc(elevation)}</p></div>` : ""}
      ${price ? `<div class="info-item"><label>💰 Price</label><p>${esc(String(price))}</p></div>` : ""}
    </div>
    ${description ? `<div class="desc">${esc(description)}${description.length >= 200 ? "…" : ""}</div>` : ""}
  </div>

  <div class="buttons">
    <a class="btn-open" id="openBtn" href="${esc(appSchemeUrl)}">
      Open in The Collective
    </a>
    <a class="btn-download" href="https://apps.apple.com/app/trailmatch" id="downloadBtn">
      Download The Collective — Free
    </a>
  </div>

  <div class="logo-bar">
    <span>🏔️ The Collective</span>
  </div>

  <script>
    // Try to open the app; if it fails, redirect to app store
    var openBtn = document.getElementById('openBtn');
    openBtn.addEventListener('click', function(e) {
      e.preventDefault();
      var appUrl = '${appSchemeUrl}';
      var startTime = Date.now();

      // Try opening the app
      window.location.href = appUrl;

      // If the app didn't open within 1.5 seconds, go to app store
      setTimeout(function() {
        if (Date.now() - startTime < 2000) {
          // Detect platform
          var ua = navigator.userAgent.toLowerCase();
          if (/iphone|ipad|ipod/.test(ua)) {
            window.location.href = 'https://apps.apple.com/app/trailmatch';
          } else {
            window.location.href = 'https://play.google.com/store/apps/details?id=com.beartoe.myapp';
          }
        }
      }, 1500);
    });

    // Detect platform for download button
    var ua = navigator.userAgent.toLowerCase();
    var dlBtn = document.getElementById('downloadBtn');
    if (/iphone|ipad|ipod/.test(ua)) {
      dlBtn.href = 'https://apps.apple.com/app/trailmatch';
      dlBtn.textContent = 'Download on App Store — Free';
    } else if (/android/.test(ua)) {
      dlBtn.href = 'https://play.google.com/store/apps/details?id=com.beartoe.myapp';
      dlBtn.textContent = 'Get on Google Play — Free';
    }
  </script>
</body>
</html>`;

    res.set("Cache-Control", "public, max-age=300, s-maxage=600");
    res.status(200).send(html);
  } catch (error) {
    console.error("Share page error:", error);
    res.status(500).send("Something went wrong");
  }
});

// ─── Auto-Fetch Race Results from RunSignup ──────────────────────────────────
// This function checks completed_races with no finishTime and looks up results
// from the RunSignup API, matching by the runner's first/last name.

/**
 * Fetch race results from RunSignup for a specific race and event.
 * Returns an array of individual results.
 */
async function fetchRunSignupResults(raceId, eventId, page = 1) {
  const url = `https://runsignup.com/Rest/race/${raceId}/results/get-results?format=json&event_id=${eventId}&page=${page}&results_per_page=500`;
  try {
    const data = await httpsGet(url);
    return data;
  } catch (err) {
    console.error(`Error fetching results for race ${raceId}, event ${eventId}:`, err.message);
    return null;
  }
}

/**
 * Fetch the list of result sets for a race (to get event IDs with posted results)
 */
async function fetchRunSignupResultSets(raceId) {
  const url = `https://runsignup.com/Rest/race/${raceId}/results/get-result-sets?format=json`;
  try {
    const data = await httpsGet(url);
    return data;
  } catch (err) {
    console.error(`Error fetching result sets for race ${raceId}:`, err.message);
    return null;
  }
}

/**
 * Normalize a name for fuzzy comparison — lowercase, remove punctuation, extra spaces
 */
function normalizeName(name) {
  return (name || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Scheduled Cloud Function: Runs daily at 6 AM UTC.
 * Finds completed_races with no finishTime where the race date has passed,
 * looks up results on RunSignup, and updates the finishTime/rank if found.
 */
exports.fetchRaceResults = functions
  .runWith({ timeoutSeconds: 540, memory: "512MB" })
  .pubsub.schedule("every day 06:00")
  .timeZone("America/New_York")
  .onRun(async () => {
    const db = admin.firestore();

    // 1. Get all completed_races where finishTime is null or empty
    const pendingSnapshot = await db
      .collection("completed_races")
      .where("finishTime", "==", null)
      .get();

    if (pendingSnapshot.empty) {
      console.log("No pending results to fetch.");
      return null;
    }

    console.log(`Found ${pendingSnapshot.size} completed races with pending results.`);

    // 2. Group by trailId to batch lookups
    const trailGroups = {};
    pendingSnapshot.forEach((docSnap) => {
      const data = docSnap.data();
      const trailId = data.trailId;
      if (!trailGroups[trailId]) {
        trailGroups[trailId] = [];
      }
      trailGroups[trailId].push({ docId: docSnap.id, ...data });
    });

    let totalUpdated = 0;
    let totalChecked = 0;

    // 3. For each trail, check if it's a RunSignup race and fetch results
    for (const [trailId, completedEntries] of Object.entries(trailGroups)) {
      try {
        const trailDoc = await db.collection("trails").doc(trailId).get();
        if (!trailDoc.exists) {
          console.log(`Trail ${trailId} not found in Firestore, skipping.`);
          continue;
        }

        const trailData = trailDoc.data();

        // Only handle RunSignup races for now
        if (trailData.source !== "runsignup" || !trailData.runsignupRaceId) {
          console.log(`Trail ${trailId} is not a RunSignup race (source: ${trailData.source}), skipping.`);
          continue;
        }

        const rsRaceId = trailData.runsignupRaceId;
        const raceName = trailData.name || "Unknown";
        console.log(`Checking results for "${raceName}" (RunSignup ID: ${rsRaceId})`);

        // 4. Fetch result sets to find which events have posted results
        const resultSetsData = await fetchRunSignupResultSets(rsRaceId);
        if (!resultSetsData || !resultSetsData.result_sets || resultSetsData.result_sets.length === 0) {
          console.log(`  No result sets posted yet for "${raceName}".`);
          continue;
        }

        // Collect all individual results across all events
        const allResults = [];
        for (const resultSet of resultSetsData.result_sets) {
          const eventId = resultSet.event_id;
          if (!eventId) continue;

          let page = 1;
          let hasMore = true;
          while (hasMore) {
            const resultsData = await fetchRunSignupResults(rsRaceId, eventId, page);
            if (!resultsData) break;

            // RunSignup returns results in different possible structures
            const results =
              resultsData.individual_results_sets?.[0]?.results ||
              resultsData.results ||
              [];

            if (results.length === 0) {
              hasMore = false;
            } else {
              allResults.push(...results);
              // If we got a full page, there might be more
              hasMore = results.length >= 500;
              page++;
            }
          }
        }

        if (allResults.length === 0) {
          console.log(`  No individual results found for "${raceName}".`);
          continue;
        }

        console.log(`  Found ${allResults.length} total results for "${raceName}".`);

        // 5. For each pending completed_race entry, look up the user and match
        for (const entry of completedEntries) {
          totalChecked++;
          try {
            const userDoc = await db.collection("users").doc(entry.userId).get();
            if (!userDoc.exists) {
              console.log(`  User ${entry.userId} not found, skipping.`);
              continue;
            }

            const userData = userDoc.data();
            const userFirst = normalizeName(userData.firstName);
            const userLast = normalizeName(userData.lastName);

            if (!userFirst || !userLast) {
              console.log(`  User ${entry.userId} missing name, skipping.`);
              continue;
            }

            // Find matching result by first + last name
            const match = allResults.find((r) => {
              const rFirst = normalizeName(r.first_name || r.user?.first_name);
              const rLast = normalizeName(r.last_name || r.user?.last_name);
              return rFirst === userFirst && rLast === userLast;
            });

            if (match) {
              // Extract finish time and placement
              const finishTime = match.clock_time || match.chip_time || match.finish_time || "";
              const overallPlace = match.place || match.overall_place || "";
              const genderPlace = match.gender_place || "";
              const ageGroupPlace = match.age_group_place || "";
              const pace = match.pace || "";

              // Build a rank string
              let rankStr = "";
              if (overallPlace) {
                rankStr = `${overallPlace} overall`;
                if (genderPlace) rankStr += ` / ${genderPlace} gender`;
                if (ageGroupPlace) rankStr += ` / ${ageGroupPlace} AG`;
              }

              console.log(`  ✅ Match found for ${userData.firstName} ${userData.lastName}: ${finishTime} (${rankStr})`);

              await db.collection("completed_races").doc(entry.docId).update({
                finishTime: finishTime,
                rank: rankStr || null,
                pace: pace || null,
                resultsSource: "runsignup",
                resultsUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
              });
              totalUpdated++;
            } else {
              console.log(`  ❌ No match for ${userData.firstName} ${userData.lastName} in "${raceName}" results.`);
            }
          } catch (userErr) {
            console.error(`  Error processing user ${entry.userId}:`, userErr.message);
          }
        }
      } catch (trailErr) {
        console.error(`Error processing trail ${trailId}:`, trailErr.message);
      }
    }

    console.log(`Results fetch complete: ${totalUpdated} updated out of ${totalChecked} checked.`);
    return null;
  });

/**
 * Callable: Manually trigger results fetch for all pending completed races
 * (or for a specific trailId if provided).
 */
exports.manualFetchResults = functions
  .runWith({ timeoutSeconds: 540, memory: "512MB" })
  .https.onCall(async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError("unauthenticated", "Must be signed in.");
    }

    const db = admin.firestore();
    const specificTrailId = data?.trailId || null;

    // Build query — all pending, or just for one race
    let pendingQuery = db.collection("completed_races").where("finishTime", "==", null);
    const pendingSnapshot = await pendingQuery.get();

    if (pendingSnapshot.empty) {
      return { success: true, message: "No pending results to fetch.", updated: 0, checked: 0 };
    }

    // Group by trailId
    const trailGroups = {};
    pendingSnapshot.forEach((docSnap) => {
      const docData = docSnap.data();
      const trailId = docData.trailId;
      if (specificTrailId && trailId !== specificTrailId) return;
      if (!trailGroups[trailId]) {
        trailGroups[trailId] = [];
      }
      trailGroups[trailId].push({ docId: docSnap.id, ...docData });
    });

    let totalUpdated = 0;
    let totalChecked = 0;

    for (const [trailId, completedEntries] of Object.entries(trailGroups)) {
      try {
        const trailDoc = await db.collection("trails").doc(trailId).get();
        if (!trailDoc.exists) continue;

        const trailData = trailDoc.data();
        if (trailData.source !== "runsignup" || !trailData.runsignupRaceId) continue;

        const rsRaceId = trailData.runsignupRaceId;

        // Fetch result sets
        const resultSetsData = await fetchRunSignupResultSets(rsRaceId);
        if (!resultSetsData || !resultSetsData.result_sets || resultSetsData.result_sets.length === 0) continue;

        // Collect all results
        const allResults = [];
        for (const resultSet of resultSetsData.result_sets) {
          const eventId = resultSet.event_id;
          if (!eventId) continue;

          let page = 1;
          let hasMore = true;
          while (hasMore) {
            const resultsData = await fetchRunSignupResults(rsRaceId, eventId, page);
            if (!resultsData) break;

            const results =
              resultsData.individual_results_sets?.[0]?.results ||
              resultsData.results ||
              [];

            if (results.length === 0) {
              hasMore = false;
            } else {
              allResults.push(...results);
              hasMore = results.length >= 500;
              page++;
            }
          }
        }

        if (allResults.length === 0) continue;

        // Match users
        for (const entry of completedEntries) {
          totalChecked++;
          try {
            const userDoc = await db.collection("users").doc(entry.userId).get();
            if (!userDoc.exists) continue;

            const userData = userDoc.data();
            const userFirst = normalizeName(userData.firstName);
            const userLast = normalizeName(userData.lastName);
            if (!userFirst || !userLast) continue;

            const match = allResults.find((r) => {
              const rFirst = normalizeName(r.first_name || r.user?.first_name);
              const rLast = normalizeName(r.last_name || r.user?.last_name);
              return rFirst === userFirst && rLast === userLast;
            });

            if (match) {
              const finishTime = match.clock_time || match.chip_time || match.finish_time || "";
              const overallPlace = match.place || match.overall_place || "";
              const genderPlace = match.gender_place || "";
              const ageGroupPlace = match.age_group_place || "";
              const pace = match.pace || "";

              let rankStr = "";
              if (overallPlace) {
                rankStr = `${overallPlace} overall`;
                if (genderPlace) rankStr += ` / ${genderPlace} gender`;
                if (ageGroupPlace) rankStr += ` / ${ageGroupPlace} AG`;
              }

              await db.collection("completed_races").doc(entry.docId).update({
                finishTime: finishTime,
                rank: rankStr || null,
                pace: pace || null,
                resultsSource: "runsignup",
                resultsUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
              });
              totalUpdated++;
            }
          } catch (userErr) {
            console.error(`Error processing user ${entry.userId}:`, userErr.message);
          }
        }
      } catch (trailErr) {
        console.error(`Error processing trail ${trailId}:`, trailErr.message);
      }
    }

    return {
      success: true,
      message: `Results fetch complete: ${totalUpdated} updated out of ${totalChecked} checked.`,
      updated: totalUpdated,
      checked: totalChecked,
    };
  });

// ─── Custom Auth claims: admin roles ───────────────────────────────────────────
// Callers with token.admin === true can promote/demote others.
// First admin: use bootstrapInitialAdmin (one-time, secret + Firestore gate) or scripts/setInitialAdmin.js

function getBootstrapSecret() {
  return String(process.env.INITIAL_ADMIN_BOOTSTRAP_SECRET || "").trim();
}

/**
 * Set or revoke Firebase Auth custom claim { admin: true } for another user.
 * Security: only existing admins (custom claim) may call.
 */
exports.setAdminRole = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Authentication required.");
  }

  if (context.auth.token.admin !== true) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Only users with the admin custom claim can change admin roles."
    );
  }

  const targetUid = String(data?.uid || data?.targetUid || "").trim();
  if (!targetUid) {
    throw new functions.https.HttpsError("invalid-argument", "uid (target user) is required.");
  }

  const makeAdmin = data?.makeAdmin !== false;

  try {
    const userRecord = await admin.auth().getUser(targetUid);
    const existing = { ...(userRecord.customClaims || {}) };

    if (makeAdmin) {
      existing.admin = true;
    } else {
      delete existing.admin;
    }

    await admin.auth().setCustomUserClaims(targetUid, existing);

    return { success: true, uid: targetUid, admin: makeAdmin };
  } catch (e) {
    if (e.code === "auth/user-not-found") {
      throw new functions.https.HttpsError("not-found", "User not found.");
    }
    console.error("setAdminRole:", e);
    throw new functions.https.HttpsError("internal", "Failed to update custom claims.");
  }
});

/**
 * Set or revoke Firebase Auth custom claim { isDirector: true } and sync `role` on users/{uid}.
 * Security: only callers with custom claim admin === true.
 * Claims are merged with existing (e.g. admin is preserved).
 */
exports.setDirectorRole = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Authentication required.");
  }

  if (context.auth.token.admin !== true) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Only users with the admin custom claim can change director roles."
    );
  }

  const targetUid = String(data?.targetUid || data?.uid || "").trim();
  if (!targetUid) {
    throw new functions.https.HttpsError("invalid-argument", "targetUid is required.");
  }

  if (typeof data?.isDirector !== "boolean") {
    throw new functions.https.HttpsError("invalid-argument", "isDirector (boolean) is required.");
  }

  const isDirector = data.isDirector;

  try {
    const userRecord = await admin.auth().getUser(targetUid);
    const existing = { ...(userRecord.customClaims || {}) };

    if (isDirector) {
      existing.isDirector = true;
    } else {
      delete existing.isDirector;
    }

    await admin.auth().setCustomUserClaims(targetUid, existing);

    const userRef = admin.firestore().collection("users").doc(targetUid);
    if (isDirector) {
      await userRef.set({ role: "director" }, { merge: true });
    } else {
      const snap = await userRef.get();
      const currentRole = snap.exists ? snap.data().role : null;
      if (currentRole === "director") {
        await userRef.set({ role: "user" }, { merge: true });
      }
    }

    return { success: true, uid: targetUid, isDirector };
  } catch (e) {
    if (e.code === "auth/user-not-found") {
      throw new functions.https.HttpsError("not-found", "User not found.");
    }
    console.error("setDirectorRole:", e);
    throw new functions.https.HttpsError("internal", "Failed to update director role.");
  }
});

/**
 * One-time bootstrap: grants admin to the *caller* if INITIAL_ADMIN_BOOTSTRAP_SECRET matches
 * and system/adminBootstrap is not yet completed. No existing admin claim required.
 * Remove or rotate the secret after first use; prefer scripts/setInitialAdmin.js for local ops.
 */
exports.bootstrapInitialAdmin = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Authentication required.");
  }

  const bootstrapSecret = getBootstrapSecret();
  if (!bootstrapSecret) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Bootstrap is disabled. Set INITIAL_ADMIN_BOOTSTRAP_SECRET on the function environment, or use scripts/setInitialAdmin.js."
    );
  }

  const providedSecret = String(data?.secret || "").trim();
  if (providedSecret !== bootstrapSecret) {
    throw new functions.https.HttpsError("permission-denied", "Invalid secret.");
  }

  const bootstrapRef = admin.firestore().doc("system/adminBootstrap");
  const snap = await bootstrapRef.get();
  if (snap.exists && snap.data()?.completed === true) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Initial admin has already been bootstrapped. Use setAdminRole or the Admin SDK script."
    );
  }

  const uid = context.auth.uid;

  try {
    const userRecord = await admin.auth().getUser(uid);
    const existing = { ...(userRecord.customClaims || {}) };
    existing.admin = true;
    await admin.auth().setCustomUserClaims(uid, existing);

    await bootstrapRef.set(
      {
        completed: true,
        completedAt: admin.firestore.FieldValue.serverTimestamp(),
        completedByUid: uid,
      },
      { merge: true }
    );

    return { success: true, uid, admin: true, bootstrapped: true };
  } catch (e) {
    console.error("bootstrapInitialAdmin:", e);
    throw new functions.https.HttpsError("internal", "Failed to set initial admin claims.");
  }
});

// ─── auditAdminActions: global audit log (onUpdate) ────────────────────────────
// Three triggers; deploy all. Firestore triggers do not provide context.auth — see helpers above.

exports.auditAdminActionsTrails = functions.firestore
  .document("trails/{trailId}")
  .onUpdate(async (change, context) => {
    try {
      await writeAuditLogEntry({
        collectionName: "trails",
        docId: context.params.trailId,
        change,
        action: "UPDATE_TRAIL",
      });
    } catch (e) {
      console.error("auditAdminActionsTrails:", e);
    }
  });

exports.auditAdminActionsTrailsOnDelete = functions.firestore
  .document("trails/{trailId}")
  .onDelete(async (snap, context) => {
    const trailId = context.params.trailId;
    const snapshotData = snap.data();
    if (!snapshotData || typeof snapshotData !== "object") {
      return;
    }
    try {
      await writeTrailDeletionTombstone(trailId, snapshotData);
    } catch (e) {
      console.error("auditAdminActionsTrailsOnDelete:", e);
    }
  });

exports.auditAdminActionsRegistrations = functions.firestore
  .document("registrations/{registrationId}")
  .onUpdate(async (change, context) => {
    try {
      await writeAuditLogEntry({
        collectionName: "registrations",
        docId: context.params.registrationId,
        change,
        action: "UPDATE_REGISTRATION",
      });
    } catch (e) {
      console.error("auditAdminActionsRegistrations:", e);
    }
  });

exports.auditAdminActionsPayments = functions.firestore
  .document("payments/{paymentId}")
  .onUpdate(async (change, context) => {
    try {
      await writeAuditLogEntry({
        collectionName: "payments",
        docId: context.params.paymentId,
        change,
        action: resolvePaymentAuditAction(change),
      });
    } catch (e) {
      console.error("auditAdminActionsPayments:", e);
    }
  });

/**
 * Restore a deleted trail: writes tombstone payload to trails/{trailId}, then logs RESTORED_TRAIL.
 * Callable only by admins. Pass `tombstone` from the client or omit to load from audit_logs/deletions/trails/{trailId}.
 */
exports.restoreDeletedTrail = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Authentication required.");
  }
  if (context.auth.token.admin !== true) {
    throw new functions.https.HttpsError("permission-denied", "Only admins can restore trails.");
  }

  const trailId = String(data?.trailId || "").trim();
  if (!trailId) {
    throw new functions.https.HttpsError("invalid-argument", "trailId is required.");
  }

  const db = admin.firestore();
  let snapshot = data?.tombstone;

  if (!snapshot || typeof snapshot !== "object") {
    const tombSnap = await db
      .collection("audit_logs")
      .doc("deletions")
      .collection("trails")
      .doc(trailId)
      .get();
    if (!tombSnap.exists) {
      throw new functions.https.HttpsError(
        "not-found",
        "No tombstone found for this trail. It may have been removed or never deleted through the audit system."
      );
    }
    snapshot = tombSnap.data().tombstone;
  }

  if (!snapshot || typeof snapshot !== "object") {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Tombstone data is missing or invalid."
    );
  }

  const adminUid = context.auth.uid;
  let adminName = null;
  try {
    adminName = await fetchAuditAdminDisplayName(db, adminUid);
  } catch (e) {
    console.warn("restoreDeletedTrail: adminName", e?.message || e);
  }

  try {
    await db.collection("trails").doc(trailId).set(snapshot);

    await db.collection("audit_logs").add({
      collection: "trails",
      adminUid,
      adminName: adminName || null,
      action: "RESTORED_TRAIL",
      targetId: trailId,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });

    return { success: true, trailId };
  } catch (e) {
    console.error("restoreDeletedTrail:", e);
    throw new functions.https.HttpsError("internal", "Failed to restore trail or write audit log.");
  }
});

