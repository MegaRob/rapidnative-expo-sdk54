import type { FirebaseApp } from "@firebase/app";
import { Platform } from "react-native";

/**
 * Optional Firebase App Check for the **web** build (`expo start --web`).
 * Uses reCAPTCHA v3 when `EXPO_PUBLIC_APPCHECK_RECAPTCHA_SITE_KEY` is set (Firebase Console → App Check → Web → reCAPTCHA).
 *
 * iOS/Android with the Firebase **JS** SDK do not use the same attestation path as native App Check;
 * for enforcement on native, use a dev/production build with the native App Check SDKs (or device check providers).
 */
export function initAppCheckAfterFirebase(app: FirebaseApp): void {
  if (!app?.name) return;

  const siteKey = process.env.EXPO_PUBLIC_APPCHECK_RECAPTCHA_SITE_KEY?.trim() ?? "";
  const debugRaw = process.env.EXPO_PUBLIC_FIREBASE_APPCHECK_DEBUG_TOKEN?.trim();

  if (Platform.OS !== "web") {
    return;
  }

  if (!siteKey) {
    return;
  }

  void import("firebase/app-check")
    .then(({ initializeAppCheck, ReCaptchaV3Provider }) => {
      try {
        if (debugRaw && typeof globalThis !== "undefined") {
          (globalThis as Record<string, unknown>).FIREBASE_APPCHECK_DEBUG_TOKEN =
            debugRaw === "true" ? true : debugRaw;
        }
        initializeAppCheck(app, {
          provider: new ReCaptchaV3Provider(siteKey),
          isTokenAutoRefreshEnabled: true,
        });
      } catch (e) {
        if (__DEV__) {
          console.warn("[App Check] init failed:", e);
        }
      }
    })
    .catch((e) => {
      if (__DEV__) {
        console.warn("[App Check] load failed:", e);
      }
    });
}
