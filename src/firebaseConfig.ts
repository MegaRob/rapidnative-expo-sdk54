import { initializeApp, getApps, FirebaseApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from "firebase/firestore";
import { getStorage } from "firebase/storage";

// Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyAcKYEhZyUgwUV58uWEVbI4Gwkn65miHt4",
  authDomain: "trailmatch-49203553-49000.firebaseapp.com",
  projectId: "trailmatch-49203553-49000",
  storageBucket: "trailmatch-49203553-49000.firebasestorage.app",
  messagingSenderId: "1048323489461",
  appId: "1:1048323489461:web:e3c514fcf0d7748ef848fc"
};

// Initialize Firebase - use existing app if already initialized
let app: FirebaseApp | undefined;
let auth: ReturnType<typeof getAuth> | undefined;
let db: ReturnType<typeof getFirestore> | undefined;
let storage: ReturnType<typeof getStorage> | undefined;

try {
  // Check if Firebase is already initialized
  const existingApps = getApps();
  if (existingApps.length > 0) {
    app = existingApps[0];
    auth = getAuth(app);
    db = getFirestore(app);
  } else {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
  }
  storage = getStorage(app);
} catch (error: any) {
  console.error('Firebase initialization failed:', error?.message);
  // Initialize with dummy values to prevent crashes
  // Components will need to check for these
  app = {} as FirebaseApp;
  auth = {} as ReturnType<typeof getAuth>;
  db = {} as ReturnType<typeof getFirestore>;
  storage = {} as ReturnType<typeof getStorage>;
}

// Export
export { auth, db, storage, app };
