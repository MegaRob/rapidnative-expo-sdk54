import type { FirebaseApp } from "@firebase/app";

/**
 * Firebase App Check for **web** (`expo start --web`): reCAPTCHA v3.
 * Set `EXPO_PUBLIC_APPCHECK_RECAPTCHA_SITE_KEY` (Console → App Check → Web).
 */
export function initAppCheckAfterFirebase(app: FirebaseApp): void {
  if (!app?.name) return;

  const siteKey = process.env.EXPO_PUBLIC_APPCHECK_RECAPTCHA_SITE_KEY?.trim() ?? "";
  const debugRaw = process.env.EXPO_PUBLIC_FIREBASE_APPCHECK_DEBUG_TOKEN?.trim();

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
