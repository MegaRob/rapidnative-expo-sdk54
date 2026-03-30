/**
 * Firebase bootstrap for React Native (Expo).
 *
 * Do NOT import `firebase/firestore` or `firebase/storage` at the top of this file. Loading those
 * bundles pulls `@firebase/app` / Firestore registration through Metro before `@firebase/auth` has
 * finished `registerAuth()`, which causes: "Component auth has not been registered yet".
 * Firestore and Storage are required only after `initializeAuth` succeeds.
 */
/* Side-effect + named `@firebase/auth` imports must stay separate (registerAuth ordering). */
/* eslint-disable import/no-duplicates */
import "@firebase/auth";

import type { FirebaseApp } from "@firebase/app";
import type { Firestore } from "@firebase/firestore";
import type { FirebaseStorage } from "@firebase/storage";
import { getApp, getApps, initializeApp } from "@firebase/app";
import {
  createUserWithEmailAndPassword,
  deleteUser,
  getAuth,
  getReactNativePersistence,
  initializeAuth,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
} from "@firebase/auth";
/* eslint-enable import/no-duplicates */
import ReactNativeAsyncStorage from "@react-native-async-storage/async-storage";

import { initAppCheckAfterFirebase } from "./initAppCheck";

/** From Firebase Console → Project settings → Your apps (Web). */
const firebaseConfig = {
  apiKey: "AIzaSyAcKYEhZyUgwUV58uWEVbI4Gwkn65miHt4",
  authDomain: "trailmatch-49203553-49000.firebaseapp.com",
  projectId: "trailmatch-49203553-49000",
  storageBucket: "trailmatch-49203553-49000.firebasestorage.app",
  messagingSenderId: "1048323489461",
  appId: "1:1048323489461:web:e3c514fcf0d7748ef848fc",
};

export const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey &&
    firebaseConfig.projectId &&
    firebaseConfig.authDomain &&
    firebaseConfig.storageBucket &&
    firebaseConfig.messagingSenderId &&
    firebaseConfig.appId
);

/** False when keys are missing, init threw, or we fell back to dummy exports — do not call Auth/Firestore APIs. */
export let isFirebaseReady = false;

type AuthInstance = ReturnType<typeof getAuth>;

let app: FirebaseApp;
let auth: AuthInstance;
let db: Firestore;
let storage: FirebaseStorage;

/** RN must use `initializeAuth` + AsyncStorage persistence; `getAuth` alone throws until Auth is registered. */
function initAuthForApp(firebaseApp: FirebaseApp): AuthInstance {
  try {
    return initializeAuth(firebaseApp, {
      persistence: getReactNativePersistence(ReactNativeAsyncStorage),
    });
  } catch (e: unknown) {
    const code =
      e && typeof e === "object" && "code" in e
        ? String((e as { code: unknown }).code)
        : "";
    if (code === "auth/already-initialized") {
      return getAuth(firebaseApp);
    }
    throw e;
  }
}

function setDummyFirebaseExports() {
  isFirebaseReady = false;
  app = {} as FirebaseApp;
  auth = {} as AuthInstance;
  db = {} as Firestore;
  storage = {} as FirebaseStorage;
}

setDummyFirebaseExports();

function wireFirestoreAndStorage(firebaseApp: FirebaseApp) {
  // Defer Firestore/Storage until after Auth init (see file header). Sync `require` keeps load order.
  const { getFirestore } = require("@firebase/firestore") as typeof import("@firebase/firestore"); // eslint-disable-line @typescript-eslint/no-require-imports
  const { getStorage } = require("@firebase/storage") as typeof import("@firebase/storage"); // eslint-disable-line @typescript-eslint/no-require-imports
  db = getFirestore(firebaseApp);
  storage = getStorage(firebaseApp);
}

try {
  if (!isFirebaseConfigured) {
    if (__DEV__) {
      console.warn(
        "[Firebase] Paste your web app keys into firebaseConfig in src/firebaseConfig.ts."
      );
    }
    setDummyFirebaseExports();
  } else if (getApps().length > 0) {
    app = getApp();
    auth = initAuthForApp(app);
    wireFirestoreAndStorage(app);
    isFirebaseReady = true;
    initAppCheckAfterFirebase(app);
  } else {
    app = initializeApp(firebaseConfig);
    auth = initAuthForApp(app);
    wireFirestoreAndStorage(app);
    isFirebaseReady = true;
    initAppCheckAfterFirebase(app);
  }
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (__DEV__) {
    console.error("Firebase initialization failed:", message);
  }
  setDummyFirebaseExports();
}

export {
  app,
  auth,
  db,
  storage,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
  updateProfile,
  deleteUser,
};
