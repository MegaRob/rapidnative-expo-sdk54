#!/usr/bin/env node
/**
 * Migrate sensitive fields from users/{uid} root → users/{uid}/private/account
 * and remove them from the root document (for Firestore security rules).
 *
 * Sensitive fields: email, stripeCustomerId, stripeCustomerID, expoPushToken,
 * phoneNumber, address
 *
 * Prerequisites:
 *   - Run from repo with firebase-admin installed (functions/)
 *   - Application Default Credentials: `firebase login` + `gcloud auth application-default login`
 *     OR GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccount.json
 *
 * Usage (from functions/ directory):
 *   node scripts/migratePrivateData.js --dry-run    # preview only
 *   node scripts/migratePrivateData.js             # apply
 *
 * Or: DRY_RUN=1 node scripts/migratePrivateData.js
 *
 * Requires Firestore read/write on `users` (Editor or Cloud Datastore User role).
 */
let admin;
try {
  admin = require("firebase-admin");
} catch {
  console.error("Install firebase-admin in functions/: npm install");
  process.exit(1);
}

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

const SENSITIVE_KEYS = [
  "email",
  "stripeCustomerId",
  "stripeCustomerID",
  "expoPushToken",
  "phoneNumber",
  "address",
];

function extractSensitiveFields(data) {
  const out = {};
  for (const key of SENSITIVE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(data, key) && data[key] !== undefined) {
      out[key] = data[key];
    }
  }
  return out;
}

function isDryRun() {
  return (
    process.argv.includes("--dry-run") ||
    process.argv.includes("-n") ||
    process.env.DRY_RUN === "1" ||
    process.env.DRY_RUN === "true"
  );
}

async function main() {
  const dryRun = isDryRun();
  console.log(dryRun ? "[DRY RUN] No writes will be performed.\n" : "[LIVE] Writing to Firestore.\n");

  const snap = await db.collection("users").get();
  let wouldMigrate = 0;
  let skipped = 0;
  let migrated = 0;
  let errors = 0;

  for (const docSnap of snap.docs) {
    const uid = docSnap.id;
    const data = docSnap.data() || {};
    const sensitive = extractSensitiveFields(data);

    if (Object.keys(sensitive).length === 0) {
      skipped += 1;
      continue;
    }

    wouldMigrate += 1;

    if (dryRun) {
      console.log(
        `[DRY RUN] ${uid}\n  copy to users/${uid}/private/account: ${Object.keys(sensitive).join(", ")}\n  remove from root: ${Object.keys(sensitive).join(", ")}\n`
      );
      continue;
    }

    try {
      const batch = db.batch();
      const privateRef = db.collection("users").doc(uid).collection("private").doc("account");

      batch.set(privateRef, sensitive, { merge: true });

      const rootDeletes = {};
      for (const key of Object.keys(sensitive)) {
        rootDeletes[key] = admin.firestore.FieldValue.delete();
      }
      batch.update(docSnap.ref, rootDeletes);

      await batch.commit();
      migrated += 1;
      console.log(`OK ${uid}: moved ${Object.keys(sensitive).join(", ")}`);
    } catch (err) {
      errors += 1;
      console.error(`ERROR ${uid}:`, err.message || err);
    }
  }

  console.log("\n--- Summary ---");
  console.log(`Total user docs scanned: ${snap.size}`);
  console.log(`Docs with no sensitive fields (skipped): ${skipped}`);
  if (dryRun) {
    console.log(`Docs that would be migrated: ${wouldMigrate}`);
  } else {
    console.log(`Docs migrated: ${migrated}`);
    if (errors > 0) console.log(`Errors: ${errors}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
