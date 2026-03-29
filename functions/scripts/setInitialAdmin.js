#!/usr/bin/env node
/**
 * One-time: grant Firebase Auth custom claim { admin: true } using the Admin SDK.
 *
 * Prerequisites:
 *   - Firebase CLI logged in (`firebase login`) OR
 *   - GOOGLE_APPLICATION_CREDENTIALS pointing to a service account JSON with
 *     "Firebase Authentication Admin" (or Editor on the project).
 *
 * Usage (from project root or functions/):
 *   node firebase/functions/scripts/setInitialAdmin.js <TARGET_UID>
 *
 * Or from functions/:
 *   node scripts/setInitialAdmin.js <TARGET_UID>
 *
 * Get UID: Firebase Console → Authentication → Users → User UID.
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

const uid = process.argv[2];
if (!uid) {
  console.error("Usage: node scripts/setInitialAdmin.js <TARGET_UID>");
  process.exit(1);
}

if (!/^[a-zA-Z0-9]{20,128}$/.test(uid)) {
  console.warn("Warning: UID format looks unusual; continuing anyway.");
}

admin
  .auth()
  .getUser(uid)
  .then((user) => {
    const next = { ...(user.customClaims || {}), admin: true };
    return admin.auth().setCustomUserClaims(uid, next);
  })
  .then(() => {
    console.log("OK: admin claim set for", uid);
    console.log("User must sign out and sign in again (or wait for token refresh) to see new claims.");
    process.exit(0);
  })
  .catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
