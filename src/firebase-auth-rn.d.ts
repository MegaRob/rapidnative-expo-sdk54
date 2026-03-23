/**
 * @firebase/auth resolves to the React Native entry at runtime (Metro `react-native` export).
 * The main `auth-public.d.ts` omits `getReactNativePersistence`; it exists on `index.rn.d.ts`.
 */
export {};

declare module "@firebase/auth" {
  import type { Persistence } from "firebase/auth";

  export function getReactNativePersistence(
    storage: import("@react-native-async-storage/async-storage").default
  ): Persistence;
}
