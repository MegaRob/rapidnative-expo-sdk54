import "@/src/firebaseAuthEarly";
import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider,
} from "@react-navigation/native";
import * as Linking from "expo-linking";
import { Stack, useNavigationContainerRef, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import "react-native-reanimated";

// Custom dark theme — override the near-black default (#010101) with our dark-slate
// so Android's navigation container background matches the app during transitions.
const AppDarkTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: '#1A1F25',
    card: '#1A1F25',
  },
};

// Keep the native splash visible until we explicitly dismiss it (see dismissNativeSplash below).
SplashScreen.preventAutoHideAsync().catch(() => {});
// import { enableScreens } from "react-native-screens";  // ← DISABLED: may conflict with Expo Router
import { GluestackUIProvider } from "@/components/ui/gluestack-ui-provider";
import "@/global.css";
import { useColorScheme } from "@/hooks/use-color-scheme";
import {
  auth,
  db,
  isFirebaseConfigured,
  isFirebaseReady,
  onAuthStateChanged,
} from "@/src/firebaseConfig";
import {
  registerForPushNotificationsAsync,
  savePushTokenToFirestore,
} from "@/utils/pushNotifications";
import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";
import Constants from "expo-constants";
import { doc, getDoc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

// enableScreens(true);  // ← DISABLED

// Only import Stripe in non-Expo-Go environments (it's a native module not available in Expo Go)
let StripeProvider: any = ({ children }: { children: React.ReactNode }) => children;
const isExpoGo = Constants.appOwnership === "expo";
if (!isExpoGo) {
  try {
    StripeProvider = require("@stripe/stripe-react-native").StripeProvider;
  } catch {
    // Stripe native module not available — use passthrough wrapper
  }
}

/** Wraps children with Stripe only when `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` is set — never secret keys. */
function StripeRootProvider({ children }: { children: React.ReactNode }) {
  const pk = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY?.trim() ?? "";
  if (!pk) {
    if (__DEV__) {
      console.warn(
        "[Stripe] EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY is unset — payments disabled. Add it to root `.env` (publishable key only)."
      );
    }
    return <>{children}</>;
  }
  return (
    <StripeProvider publishableKey={pk} merchantIdentifier="merchant.com.beartoe.trailmatch">
      {children}
    </StripeProvider>
  );
}

// expo-notifications remote push was removed from Expo Go in SDK 53.
// Lazy-require so the app still runs in Expo Go (notifications just become no-ops).
let Notifications: typeof import("expo-notifications") | null = null;
if (!isExpoGo) {
  try {
    Notifications = require("expo-notifications");
  } catch {
    // Native module unavailable — notifications disabled
  }
}

export const unstable_settings = {
  initialRouteName: "(tabs)",
};

type PendingAuthNav = "login" | "onboarding" | "home" | null;

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const router = useRouter();
  const segments = useSegments();
  const navigationRef = useNavigationContainerRef();
  /** Root `NavigationContainer` is mounted and safe for `router.replace` / `router.navigate`. */
  const [isNavReady, setIsNavReady] = useState(false);
  /** True after first `onAuthStateChanged` emit (Firebase) or stub path (no config). */
  const [authChecked, setAuthChecked] = useState(false);
  const [pendingNav, setPendingNav] = useState<PendingAuthNav>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [showBetaModal, setShowBetaModal] = useState(false);
  const [betaChecked, setBetaChecked] = useState(false);
  const [betaSaving, setBetaSaving] = useState(false);
  const notificationListener = useRef<{ remove: () => void } | undefined>(undefined);
  const responseListener = useRef<{ remove: () => void } | undefined>(undefined);
  const isNavReadyRef = useRef(false);
  /** Only one hide; iOS / dev-client throws if hide runs with no VC or twice. */
  const splashDismissedRef = useRef(false);
  const APP_ID = "1:1048323489461:web:e3c514fcf0d7748ef848fc";

  const dismissNativeSplash = useCallback(() => {
    if (splashDismissedRef.current) return;
    splashDismissedRef.current = true;
    void (async () => {
      try {
        await new Promise<void>((r) => requestAnimationFrame(() => r()));
        await SplashScreen.hideAsync();
      } catch {
        // iOS: "No native splash screen registered…"; Expo Go / reload / background resume
      }
    })();
  }, []);

  // Track `navigationRef.isReady()` — required before any imperative navigation.
  useEffect(() => {
    const sync = () => {
      const ready = navigationRef.isReady();
      isNavReadyRef.current = ready;
      setIsNavReady(ready);
    };
    sync();
    const raf = requestAnimationFrame(sync);
    const unsub = navigationRef.addListener("state", sync);
    return () => {
      cancelAnimationFrame(raf);
      unsub();
    };
  }, [navigationRef]);

  const showBootstrapOverlay = !authChecked || !isNavReady;
  /** Auth + navigation container ready — safe for deferred redirects only. */
  const canNavigate = authChecked && isNavReady;

  // Hide native splash once auth + nav are ready, or after a safety timeout (single dismiss).
  useEffect(() => {
    if (authChecked && isNavReady) {
      dismissNativeSplash();
    }
  }, [authChecked, isNavReady, dismissNativeSplash]);

  useEffect(() => {
    const safetyTimer = setTimeout(() => dismissNativeSplash(), 3000);
    return () => clearTimeout(safetyTimer);
  }, [dismissNativeSplash]);

  // Refs for stable auth listener
  const routerRef = useRef(router);
  routerRef.current = router;
  const segmentsRef = useRef(segments);
  segmentsRef.current = segments;

  // No Firebase or init failed: resolve "logged out" without calling Auth APIs (stubs are not real Auth).
  useEffect(() => {
    if (!isFirebaseConfigured || !isFirebaseReady) {
      setCurrentUserId(null);
      setAuthChecked(true);
    }
  }, []);

  // Firebase Auth — wait for initial auth state before enqueueing redirects.
  useEffect(() => {
    if (!isFirebaseConfigured || !isFirebaseReady) return;

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      try {
        console.log('[RootLayout] onAuthStateChanged fired', { uid: user?.uid ?? null });
        setCurrentUserId(user?.uid ?? null);
        setAuthChecked(true);

        if (!user) {
          setPendingNav("login");
          return;
        }

        (async () => {
          try {
            const userDoc = await getDoc(doc(db, "users", user.uid));
            const needsOnboarding =
              userDoc.exists() && userDoc.data()?.onboardingComplete === false;
            if (needsOnboarding) {
              setPendingNav("onboarding");
              return;
            }
            const seg = segmentsRef.current;
            if (seg[0] === "login" || seg[0] === "signup") {
              setPendingNav("home");
            } else {
              setPendingNav(null);
            }
          } catch (e) {
            console.warn('[RootLayout] Onboarding check failed:', e);
            const seg = segmentsRef.current;
            if (seg[0] === "login" || seg[0] === "signup") {
              setPendingNav("home");
            } else {
              setPendingNav(null);
            }
          }
        })();
      } catch (e) {
        console.error('[RootLayout] Auth listener crashed:', e);
        setAuthChecked(true);
        setPendingNav("login");
      }
    });
    return () => unsubscribe();
  }, []);

  // Deferred navigation — only after `onAuthStateChanged` has run and `navigationRef.isReady()`.
  useEffect(() => {
    if (!canNavigate || !authChecked) return;
    if (!navigationRef.isReady()) return;

    const onAuthScreen =
      segments[0] === "login" ||
      segments[0] === "signup" ||
      segments[0] === "registration-confirmation";

    if (!isFirebaseConfigured || !isFirebaseReady) {
      if (!onAuthScreen) {
        router.replace("/login");
      }
      return;
    }

    if (pendingNav === null) return;

    const action = pendingNav;
    setPendingNav(null);

    if (action === "login") {
      if (!onAuthScreen) router.replace("/login");
      return;
    }
    if (action === "onboarding") {
      router.replace("/onboarding");
      return;
    }
    if (action === "home" && (segments[0] === "login" || segments[0] === "signup")) {
      router.replace("/");
    }
  }, [
    canNavigate,
    authChecked,
    isFirebaseConfigured,
    isFirebaseReady,
    pendingNav,
    segments,
    router,
    navigationRef,
  ]);

  // Push notifications
  useEffect(() => {
    if (!currentUserId) return;

    registerForPushNotificationsAsync().then((token) => {
      if (token) savePushTokenToFirestore(token);
    });

    if (Notifications) {
      responseListener.current = Notifications.addNotificationResponseReceivedListener(
        (response) => {
          if (!isNavReadyRef.current || !navigationRef.isReady()) return;
          const data = response.notification.request.content.data;
          const notifType = data?.type as string;
          if (notifType === "chat_message" || notifType === "chat_invite") {
            if (data?.chatId && data?.buddyId) {
              router.push({ pathname: "/chat", params: { chatId: data.chatId as string, buddyId: data.buddyId as string } });
            }
          } else if (notifType === "race_reminder" || notifType === "new_race_match") {
            if (data?.trailId) {
              router.push({ pathname: "/race-details", params: { id: data.trailId as string } });
            }
          } else if (notifType === "weekly_digest") {
            router.push("/(tabs)");
          } else if (data?.chatId && data?.buddyId) {
            router.push({ pathname: "/chat", params: { chatId: data.chatId as string, buddyId: data.buddyId as string } });
          }
        }
      );
    }

    return () => {
      notificationListener.current?.remove();
      responseListener.current?.remove();
    };
  }, [currentUserId, router, navigationRef]);

  // Deep links
  useEffect(() => {
    if (!currentUserId) return;
    const handleDeepLink = (url: string) => {
      if (!isNavReadyRef.current || !navigationRef.isReady()) return;
      try {
        const parsed = new URL(url);
        const pathParts = parsed.pathname.split("/").filter(Boolean);
        if (pathParts[0] === "race" && pathParts[1]) {
          router.push({ pathname: "/race-details", params: { id: pathParts[1] } });
        }
      } catch {
        // handled by expo-router
      }
    };
    const sub = Linking.addEventListener("url", ({ url }) => handleDeepLink(url));
    Linking.getInitialURL().then((url) => { if (url) handleDeepLink(url); });
    return () => sub.remove();
  }, [currentUserId, router, navigationRef]);

  // Beta modal
  useEffect(() => {
    if (!currentUserId) {
      setShowBetaModal(false);
      setBetaChecked(false);
      return;
    }
    if (!isFirebaseConfigured || !isFirebaseReady) return;
    const userRef = doc(db, "artifacts", APP_ID, "users", currentUserId);
    const unsubscribe = onSnapshot(userRef, (snap) => {
      const agreed = snap.data()?.betaAgreed === true;
      setShowBetaModal(!agreed);
      if (agreed) setBetaChecked(false);
    });
    return () => unsubscribe();
  }, [APP_ID, currentUserId, isFirebaseConfigured, isFirebaseReady]);

  const handleBetaAgree = async () => {
    if (!currentUserId || betaSaving || !isFirebaseConfigured || !isFirebaseReady) return;
    setBetaSaving(true);
    try {
      const userRef = doc(db, "artifacts", APP_ID, "users", currentUserId);
      await setDoc(userRef, { betaAgreed: true, betaAgreedAt: serverTimestamp() }, { merge: true });
    } finally {
      setBetaSaving(false);
    }
  };

  return (
    <GestureHandlerRootView style={{ flex: 1, height: '100%', width: '100%', backgroundColor: '#1A1F25' }}>
    <SafeAreaProvider style={{ flex: 1, backgroundColor: '#1A1F25' }}>
    <View style={{ flex: 1 }}>
    <BottomSheetModalProvider>
    <StripeRootProvider>
    <KeyboardProvider statusBarTranslucent navigationBarTranslucent>
    <GluestackUIProvider mode="dark">
      <ThemeProvider value={colorScheme === "dark" ? AppDarkTheme : DefaultTheme}>
        <Fragment>
        <View style={{ flex: 1, height: '100%', width: '100%' }}>
          <Stack
            screenOptions={{
              headerShown: false,
              animation: 'fade_from_bottom',
              animationDuration: 200,
              contentStyle: { backgroundColor: '#1A1F25' },
            }}
          >
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="login" />
            <Stack.Screen name="onboarding" options={{ gestureEnabled: false }} />
            <Stack.Screen name="signup" />
            <Stack.Screen name="registration-confirmation" />
            <Stack.Screen name="search" options={{ animation: 'fade' }} />
            <Stack.Screen
              name="modal"
              options={{ presentation: "modal", headerShown: true, title: "Modal" }}
            />
          </Stack>
          {showBootstrapOverlay ? (
            <View
              pointerEvents="auto"
              style={{
                ...StyleSheet.absoluteFillObject,
                backgroundColor: '#1A1F25',
                justifyContent: 'center',
                alignItems: 'center',
                zIndex: 999,
              }}
            >
              <ActivityIndicator size="large" color="#8BC34A" />
            </View>
          ) : null}
        </View>
        <StatusBar style="light" backgroundColor="#1A1F25" />
        <Modal
          transparent
          animationType="fade"
          visible={!showBootstrapOverlay && !!currentUserId && showBetaModal}
          onRequestClose={() => {}}
        >
              <View
                className="flex-1 bg-slate-950/90 items-center justify-center px-5"
                style={{ backdropFilter: "blur(20px)" }}
              >
                <View className="w-full max-w-xl bg-slate-900/80 border border-emerald-500/20 rounded-3xl p-6">
                  <Text className="text-emerald-400 text-2xl font-bold mb-4 text-center">
                    The Collective Beta Tester Agreement
                  </Text>
                  <ScrollView
                    className="mb-4"
                    style={{ maxHeight: 320 }}
                    showsVerticalScrollIndicator={false}
                  >
                    <Text className="text-slate-200 mb-3">
                      Parties: Robert T. Olsen (Developer) and You (Tester).
                    </Text>
                    <Text className="text-emerald-300 font-semibold mb-1">
                      1. Confidentiality
                    </Text>
                    <Text className="text-slate-200 mb-3">
                      Strictly no screenshots, screen recordings, or social media posts.
                      Keep matching logic and UI private.
                    </Text>
                    <Text className="text-emerald-300 font-semibold mb-1">
                      2. Ownership
                    </Text>
                    <Text className="text-slate-200 mb-3">
                      All feedback and suggestions become the property of Robert T. Olsen.
                    </Text>
                    <Text className="text-emerald-300 font-semibold mb-1">
                      3. Status
                    </Text>
                    <Text className="text-slate-200 mb-3">
                      You are a volunteer; no ownership or future shares are granted.
                    </Text>
                    <Text className="text-emerald-300 font-semibold mb-1">
                      4. Liability
                    </Text>
                    <Text className="text-slate-200 mb-3">
                      {`App is "As-Is". Developer is not responsible for bugs or data issues.`}
                    </Text>
                    <Text className="text-emerald-300 font-semibold mb-1">
                      5. Termination
                    </Text>
                    <Text className="text-slate-200 mb-2">
                      Access can be revoked at any time.
                    </Text>
                  </ScrollView>

                  <TouchableOpacity
                    onPress={() => setBetaChecked((prev) => !prev)}
                    activeOpacity={0.8}
                    className="flex-row items-center mb-4"
                  >
                    <View
                      className={`h-5 w-5 rounded border ${
                        betaChecked ? "bg-emerald-500 border-emerald-500" : "border-slate-500"
                      } items-center justify-center mr-3`}
                    >
                      {betaChecked && <View className="h-2 w-2 rounded bg-slate-950" />}
                    </View>
                    <Text className="text-slate-200 flex-1">
                      I have read and agree to the Beta Tester Agreement.
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={handleBetaAgree}
                    disabled={!betaChecked || betaSaving}
                    activeOpacity={0.8}
                    className={`py-3 rounded-2xl items-center ${
                      betaChecked && !betaSaving
                        ? "bg-emerald-500"
                        : "bg-slate-700"
                    }`}
                  >
                    <Text className="text-white text-base font-bold">
                      {betaSaving ? "Saving..." : "Start Testing"}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            </Modal>
        </Fragment>
      </ThemeProvider>
    </GluestackUIProvider>
    </KeyboardProvider>
    </StripeRootProvider>
    </BottomSheetModalProvider>
    </View>
    </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
