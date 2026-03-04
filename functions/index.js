const functions = require("firebase-functions");
const admin = require("firebase-admin");
const { Expo } = require("expo-server-sdk");
const https = require("https");

admin.initializeApp();

const expo = new Expo();

// ─── Stripe Setup ────────────────────────────────────────────────────────────
// Configure via functions/.env file:
//   STRIPE_SECRET_KEY=sk_live_...
//   PLATFORM_FEE_PERCENT=5
const stripeSecretKey = process.env.STRIPE_SECRET_KEY || "";
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
    email: directorEmail,
    name: directorName || requestData.contactName || "",
    role: "director",
    updatedAt: now,
    createdAt: now,
  };

  if (tempPassword) {
    directorPayload.mustResetPassword = true;
    directorPayload.tempPasswordIssuedAt = now;
  }

  await admin.firestore().collection("users").doc(userRecord.uid).set(directorPayload, {
    merge: true,
  });

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
    const directorSnap = await admin.firestore().collection("users").doc(directorId).get();
    if (directorSnap.exists) {
      email = String(directorSnap.get("email") || "").trim().toLowerCase();
    }
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
    const userIds = chatData.userIds || [];
    const recipientId = userIds.find((uid) => uid !== senderId);
    if (!recipientId) return null;

    // Get recipient's push token
    const recipientDoc = await admin.firestore().collection("users").doc(recipientId).get();
    if (!recipientDoc.exists) return null;

    const recipientData = recipientDoc.data();
    const pushToken = recipientData.expoPushToken;
    if (!pushToken || !Expo.isExpoPushToken(pushToken)) return null;

    // Get sender's name for the notification
    const senderDoc = await admin.firestore().collection("users").doc(senderId).get();
    const senderData = senderDoc.exists ? senderDoc.data() : {};
    const senderName = senderData.username || senderData.name || "Someone";

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

    // Get recipient's push token
    const recipientDoc = await admin.firestore().collection("users").doc(recipientId).get();
    if (!recipientDoc.exists) return null;

    const recipientData = recipientDoc.data();
    const pushToken = recipientData.expoPushToken;
    if (!pushToken || !Expo.isExpoPushToken(pushToken)) return null;

    // Get sender's name
    const senderDoc = await admin.firestore().collection("users").doc(requestedBy).get();
    const senderData = senderDoc.exists ? senderDoc.data() : {};
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
    throw new functions.https.HttpsError("failed-precondition", "Stripe is not configured. Set stripe.secret_key in Firebase Functions config.");
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

  const userSnap = await admin.firestore().collection("users").doc(userId).get();
  const userData = userSnap.exists ? userSnap.data() : {};
  let stripeCustomerId = userData.stripeCustomerId;

  if (!stripeCustomerId) {
    const customer = await stripe.customers.create({
      email: userData.email || context.auth.token.email || "",
      metadata: { firebaseUid: userId },
    });
    stripeCustomerId = customer.id;
    await admin.firestore().collection("users").doc(userId).update({ stripeCustomerId: customer.id });
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
 * Strip HTML tags from a string and clean up whitespace
 */
function stripHtml(html) {
  if (!html) return "";
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#34;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
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
 * Map a RunSignup race to our Firestore trails schema
 */
function mapRunSignupToTrail(race, details) {
  const events = details?.events || [];
  const city = race.address?.city || "";
  const state = race.address?.state || "";
  const location = city && state ? `${city}, ${state}` : city || state || "Unknown";

  // Build distances array from events
  const distances = events
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
    // Geo data — will be enriched later or from city lookup
    latitude: null,
    longitude: null,
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

        const newRaces = races.filter((r) => !existingRaceIds.has(r.race_id));
        totalSkipped += (races.length - newRaces.length);

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
      context.auth.token.email === "rolsen83@gmail.com";
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
        const newRaces = races.filter((r) => !existingRaceIds.has(r.race_id));
        totalSkipped += (races.length - newRaces.length);
        console.log(`${state}: ${newRaces.length} new, ${races.length - newRaces.length} already exist`);

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

// ─── Geocoding (OpenStreetMap Nominatim — free, no key) ─────────────────────

/**
 * Geocode a city/location string → { lat, lon } using Nominatim
 */
function geocodeLocation(locationStr) {
  const q = encodeURIComponent(locationStr);
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${q}`;

  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "User-Agent": "TrailMatch/1.0" } }, (res) => {
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
 * Callable function: Geocode all trails that are missing coordinates
 * Groups by unique location to minimize API calls, respects 1 req/sec rate limit
 */
exports.geocodeTrails = functions
  .runWith({ timeoutSeconds: 540, memory: "512MB" })
  .https.onCall(async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError("unauthenticated", "Must be logged in.");
    }
    const userSnap = await admin.firestore().collection("users").doc(context.auth.uid).get();
    const isAdminUser = (userSnap.exists && userSnap.data().role === "admin") ||
      context.auth.token.email === "rolsen83@gmail.com";
    if (!isAdminUser) {
      throw new functions.https.HttpsError("permission-denied", "Admin access required.");
    }

    const db = admin.firestore();

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
      if (!loc || loc === "Unknown") continue;
      if (!locationGroups[loc]) locationGroups[loc] = [];
      locationGroups[loc].push(doc.ref);
    }

    const uniqueLocations = Object.keys(locationGroups);
    console.log(`${uniqueLocations.length} unique locations to geocode`);

    let geocoded = 0;
    let failed = 0;
    let updated = 0;

    for (const loc of uniqueLocations) {
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

    console.log(`Geocoding done: ${geocoded} locations resolved, ${updated} trails updated, ${failed} failed`);
    return { success: true, geocoded, updated, failed, totalLocations: uniqueLocations.length };
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
      const promises = chunk.map((uid) => db.collection("users").doc(uid).get());
      const docs = await Promise.all(promises);
      docs.forEach((doc) => {
        if (doc.exists) {
          const d = doc.data();
          const token = d.expoPushToken;
          if (token && Expo.isExpoPushToken(token)) {
            userTokenMap.set(doc.id, { token, name: d.username || d.name || "Runner" });
          }
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

    // 2. Get all users with push tokens and location
    const usersSnap = await db.collection("users").get();
    const messages = [];

    usersSnap.forEach((doc) => {
      const d = doc.data();
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
        return;
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
    });

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
      const promises = chunk.map((uid) => db.collection("users").doc(uid).get());
      const docs = await Promise.all(promises);

      docs.forEach((doc) => {
        if (!doc.exists) return;
        const d = doc.data();
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
 * - "Open in App" tries the trailmatch:// URL scheme first, then falls back to app stores
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
  <title>${esc(name)} | TrailMatch</title>

  <!-- Open Graph (Facebook, iMessage, WhatsApp) -->
  <meta property="og:title" content="${esc(name)}">
  <meta property="og:description" content="${esc(location)}${date ? " · " + esc(date) : ""}${distanceText ? " · " + esc(distanceText) : ""}">
  <meta property="og:image" content="${esc(imageUrl)}">
  <meta property="og:url" content="${esc(webUrl)}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="TrailMatch">

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
      Open in TrailMatch
    </a>
    <a class="btn-download" href="https://apps.apple.com/app/trailmatch" id="downloadBtn">
      Download TrailMatch — Free
    </a>
  </div>

  <div class="logo-bar">
    <span>🏔️ TrailMatch</span>
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

