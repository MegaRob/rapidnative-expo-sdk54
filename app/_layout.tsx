import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider,
} from "@react-navigation/native";
import * as Linking from "expo-linking";
import { Stack, useRouter, useSegments } from "expo-router";
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

// Keep the native splash visible until we explicitly dismiss it
SplashScreen.preventAutoHideAsync().catch(() => {
  // Already hidden or not available — safe to ignore
});
// import { enableScreens } from "react-native-screens";  // ← DISABLED: may conflict with Expo Router
import { GluestackUIProvider } from "@/components/ui/gluestack-ui-provider";
import "@/global.css";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { auth, db } from "@/src/firebaseConfig";
import {
  registerForPushNotificationsAsync,
  savePushTokenToFirestore,
} from "@/utils/pushNotifications";
import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";
import Constants from "expo-constants";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  ScrollView,
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

export default function RootLayout() {
  // ── Absolute first action: force-dismiss the native splash so Android never deadlocks ──
  SplashScreen.hideAsync().catch(() => {});

  const colorScheme = useColorScheme();
  const router = useRouter();
  const segments = useSegments();
  const [authChecked, setAuthChecked] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [showBetaModal, setShowBetaModal] = useState(false);
  const [betaChecked, setBetaChecked] = useState(false);
  const [betaSaving, setBetaSaving] = useState(false);
  const [splashMinElapsed, setSplashMinElapsed] = useState(false);
  const notificationListener = useRef<{ remove: () => void } | undefined>(undefined);
  const responseListener = useRef<{ remove: () => void } | undefined>(undefined);
  const APP_ID = "1:1048323489461:web:e3c514fcf0d7748ef848fc";

  // Splash minimum duration
  useEffect(() => {
    const timer = setTimeout(() => setSplashMinElapsed(true), 500);
    return () => clearTimeout(timer);
  }, []);

  // Nuclear fallback — force gate open after 2s no matter what
  useEffect(() => {
    const fallback = setTimeout(() => {
      console.warn('[RootLayout] 2s nuclear fallback — forcing gate open');
      setAuthChecked(true);
      setSplashMinElapsed(true);
    }, 2000);
    return () => clearTimeout(fallback);
  }, []);

  const appReady = authChecked && splashMinElapsed;

  // ── Dismiss the native splash screen the INSTANT auth resolves (or user is null).
  //    Do NOT wait for appReady or any downstream data — splash must vanish immediately
  //    so Android doesn't deadlock after the location-permission dialog returns.
  useEffect(() => {
    if (authChecked) {
      SplashScreen.hideAsync().catch(() => {
        // Already hidden — safe to ignore
      });
    }
  }, [authChecked]);

  // ── Safety timeout: force-dismiss native splash after 3s no matter what ──
  useEffect(() => {
    const safetyTimer = setTimeout(() => {
      SplashScreen.hideAsync().catch(() => {});
    }, 3000);
    return () => clearTimeout(safetyTimer);
  }, []);

  // Refs for stable auth listener
  const routerRef = useRef(router);
  routerRef.current = router;
  const segmentsRef = useRef(segments);
  segmentsRef.current = segments;

  // Auth listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      try {
        console.log('[RootLayout] onAuthStateChanged fired', { uid: user?.uid ?? null });
        setCurrentUserId(user?.uid ?? null);
        setAuthChecked(true);

        const seg = segmentsRef.current;
        const nav = routerRef.current;

        if (!user) {
          // ── No user session — always redirect to login.
          //    Guard against redirecting if already on login/signup/registration screens.
          const onAuthScreen = seg[0] === "login" || seg[0] === "signup" || seg[0] === "registration-confirmation";
          if (!onAuthScreen) {
            nav.replace("/login");
          }
          return;
        }

        // ── Authenticated user — check onboarding, then send to home if on login
        (async () => {
          try {
            const userDoc = await getDoc(doc(db, "users", user.uid));
            const needsOnboarding =
              userDoc.exists() && userDoc.data()?.onboardingComplete === false;
            if (needsOnboarding) {
              routerRef.current.replace("/onboarding");
            } else if (seg[0] === "login" || seg[0] === "signup") {
              routerRef.current.replace("/");
            }
          } catch (e) {
            console.warn('[RootLayout] Onboarding check failed:', e);
            if (seg[0] === "login" || seg[0] === "signup") {
              routerRef.current.replace("/");
            }
          }
        })();
      } catch (e) {
        console.error('[RootLayout] Auth listener crashed:', e);
        setAuthChecked(true);
      }
    });
    return () => unsubscribe();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Push notifications
  useEffect(() => {
    if (!currentUserId) return;

    registerForPushNotificationsAsync().then((token) => {
      if (token) savePushTokenToFirestore(token);
    });

    if (Notifications) {
      responseListener.current = Notifications.addNotificationResponseReceivedListener(
        (response) => {
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
  }, [currentUserId, router]);

  // Deep links
  useEffect(() => {
    if (!currentUserId) return;
    const handleDeepLink = (url: string) => {
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
  }, [currentUserId, router]);

  // Beta modal
  useEffect(() => {
    if (!currentUserId) {
      setShowBetaModal(false);
      setBetaChecked(false);
      return;
    }
    const userRef = doc(db, "artifacts", APP_ID, "users", currentUserId);
    const unsubscribe = onSnapshot(userRef, (snap) => {
      const agreed = snap.data()?.betaAgreed === true;
      setShowBetaModal(!agreed);
      if (agreed) setBetaChecked(false);
    });
    return () => unsubscribe();
  }, [APP_ID, currentUserId]);

  const handleBetaAgree = async () => {
    if (!currentUserId || betaSaving) return;
    setBetaSaving(true);
    try {
      const userRef = doc(db, "artifacts", APP_ID, "users", currentUserId);
      await setDoc(userRef, { betaAgreed: true, betaAgreedAt: serverTimestamp() }, { merge: true });
    } finally {
      setBetaSaving(false);
    }
  };

  const STRIPE_PUBLISHABLE_KEY = "pk_test_51T6yYLPSSNYdXAll0E6iEsq9OI01LzgHHS77wQn8g7yr5naj7IwU1jxz3YRuHhMqhR2YFzWsoc1mDqW6ntaVxlBD00V0tvJ2op";

  return (
    <GestureHandlerRootView style={{ flex: 1, height: '100%', width: '100%', backgroundColor: '#1A1F25' }}>
    <SafeAreaProvider style={{ flex: 1, backgroundColor: '#1A1F25' }}>
    <View style={{ flex: 1 }}>
    <BottomSheetModalProvider>
    <StripeProvider
      publishableKey={STRIPE_PUBLISHABLE_KEY}
      merchantIdentifier="merchant.com.beartoe.trailmatch"
    >
    <KeyboardProvider statusBarTranslucent navigationBarTranslucent>
    <GluestackUIProvider mode="dark">
      <ThemeProvider value={colorScheme === "dark" ? AppDarkTheme : DefaultTheme}>
        {!appReady ? (
          <View style={{ flex: 1, backgroundColor: '#1A1F25', justifyContent: 'center', alignItems: 'center' }}>
            <ActivityIndicator size="large" color="#8BC34A" />
          </View>
        ) : (
          <>
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
            </View>
            <StatusBar style="light" backgroundColor="#1A1F25" />
            <Modal
              transparent
              animationType="fade"
              visible={appReady && !!currentUserId && showBetaModal}
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
                      App is "As-Is". Developer is not responsible for bugs or data issues.
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
          </>
        )}
      </ThemeProvider>
    </GluestackUIProvider>
    </KeyboardProvider>
    </StripeProvider>
    </BottomSheetModalProvider>
    </View>
    </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
