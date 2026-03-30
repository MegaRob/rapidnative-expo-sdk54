import type { FirebaseApp } from "@firebase/app";
import { CustomProvider, initializeAppCheck as initJsAppCheck } from "firebase/app-check";
import { getApp as rnGetApp } from "@react-native-firebase/app";
import {
  getToken as rnGetToken,
  initializeAppCheck as rnInitializeAppCheck,
} from "@react-native-firebase/app-check";

// Barrel `.d.ts` exposes this as type-only; runtime export is in `dist/module/modular.js`.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ReactNativeFirebaseAppCheckProvider } = require("@react-native-firebase/app-check/dist/module/modular");

function jwtExpireTimeMillis(token: string): number {
  try {
    const parts = token.split(".");
    const payload = parts[1];
    if (!payload) return Date.now() + 3_600_000;
    const decoded = JSON.parse(atob(payload)) as { exp?: number };
    if (typeof decoded.exp === "number") return decoded.exp * 1000;
  } catch {
    /* ignore */
  }
  return Date.now() + 3_600_000;
}

/**
 * Firebase App Check on **iOS/Android** (development build or release; not Expo Go).
 * Native attestation via `@react-native-firebase/app-check`, bridged to the **JavaScript** Firebase
 * `app` used by Firestore/Auth so tokens attach to JS SDK requests.
 *
 * Requires `google-services.json` / `GoogleService-Info.plist` paths in `app.json` (see `.env.example`).
 */
export function initAppCheckAfterFirebase(jsApp: FirebaseApp): void {
  if (!jsApp?.name) return;

  const siteKey = process.env.EXPO_PUBLIC_APPCHECK_RECAPTCHA_SITE_KEY?.trim() ?? "";
  const debugToken = process.env.EXPO_PUBLIC_FIREBASE_APPCHECK_DEBUG_TOKEN?.trim();

  void (async () => {
    try {
      const rnfbProvider = new ReactNativeFirebaseAppCheckProvider();
      rnfbProvider.configure({
        android: {
          provider: __DEV__ ? "debug" : "playIntegrity",
          debugToken:
            debugToken && debugToken.length > 0 && debugToken !== "true" ? debugToken : undefined,
        },
        apple: {
          provider: __DEV__ ? "debug" : "appAttestWithDeviceCheckFallback",
          debugToken:
            debugToken && debugToken.length > 0 && debugToken !== "true" ? debugToken : undefined,
        },
        web: {
          provider: "reCaptchaV3",
          siteKey: siteKey || "unused-on-native",
        },
      });

      const rnAppCheck = await rnInitializeAppCheck(rnGetApp(), {
        provider: rnfbProvider,
        isTokenAutoRefreshEnabled: true,
      });

      await initJsAppCheck(jsApp, {
        provider: new CustomProvider({
          getToken: async () => {
            const { token } = await rnGetToken(rnAppCheck, false);
            return {
              token,
              expireTimeMillis: jwtExpireTimeMillis(token),
            };
          },
        }),
        isTokenAutoRefreshEnabled: true,
      });

      if (__DEV__) {
        console.log("[App Check] Native attestation bridged to JS Firebase app.");
      }
    } catch (e) {
      if (__DEV__) {
        console.warn(
          "[App Check] Native init skipped or failed (Expo Go, missing google-services, or prebuild).",
          e
        );
      }
    }
  })();
}
