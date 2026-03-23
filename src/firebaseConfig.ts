import { initializeApp, getApps, FirebaseApp } from "firebase/app";
import { getAuth } from "firebase/auth";
// Metro resolves `@firebase/auth` to the RN build (AsyncStorage persistence). Types use `index.rn.d.ts` when the bundler condition applies.
import { initializeAuth, getReactNativePersistence } from "@firebase/auth";
import { getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Firebase web config — all values must come from EXPO_PUBLIC_* env vars (see root `.env.example`).
 * Do not hardcode GCP project IDs or domains here; copy values from Firebase Console → Project settings.
 * Restrict the API key (Android: `com.robertolsen.thecollective`, release SHA-256).
 */
const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY ?? "",
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN ?? "",
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ?? "",
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET ?? "",
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? "",
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID ?? "",
};

const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey &&
    firebaseConfig.projectId &&
    firebaseConfig.authDomain &&
    firebaseConfig.storageBucket &&
    firebaseConfig.messagingSenderId &&
    firebaseConfig.appId
);

// Initialize Firebase - use existing app if already initialized
let app: FirebaseApp | undefined;
let auth: ReturnType<typeof getAuth> | undefined;
let db: ReturnType<typeof getFirestore> | undefined;
let storage: ReturnType<typeof getStorage> | undefined;

function setDummyFirebaseExports() {
  app = {} as FirebaseApp;
  auth = {} as ReturnType<typeof getAuth>;
  db = {} as ReturnType<typeof getFirestore>;
  storage = {} as ReturnType<typeof getStorage>;
}

try {
  const existingApps = getApps();
  if (existingApps.length > 0) {
    app = existingApps[0];
    auth = getAuth(app);
    db = getFirestore(app);
    storage = getStorage(app);
  } else if (!isFirebaseConfigured) {
    if (__DEV__) {
      console.error(
        "[Firebase] Missing EXPO_PUBLIC_FIREBASE_* in `.env`. Copy `.env.example` to `.env` and paste values from Firebase Console → Project settings → Your apps."
      );
    }
    setDummyFirebaseExports();
  } else {
    app = initializeApp(firebaseConfig);

    auth = initializeAuth(app, {
      persistence: getReactNativePersistence(AsyncStorage),
    });

    db = initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
    storage = getStorage(app);
  }
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (__DEV__) {
    console.error("Firebase initialization failed:", message);
  }
  setDummyFirebaseExports();
}

// Export
export { auth, db, storage, app };
