/**
 * Side-effect import: loads React Native Auth (`registerAuth`) before any route
 * or firebaseConfig runs. Fixes "Component auth has not been registered yet"
 * when Metro resolves the wrong @firebase/auth build or load order is odd.
 */
import "firebase/auth";
