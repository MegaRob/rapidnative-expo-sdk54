import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider,
} from "@react-navigation/native";
import { Stack, useRouter, useSegments } from "expo-router";
import * as Notifications from "expo-notifications";
import { StatusBar } from "expo-status-bar";
import "react-native-reanimated";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { StripeProvider } from "@stripe/stripe-react-native";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { GluestackUIProvider } from "@/components/ui/gluestack-ui-provider";
import "@/global.css";
import { onAuthStateChanged } from "firebase/auth";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { doc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { auth, db } from "@/src/firebaseConfig";
import {
  registerForPushNotificationsAsync,
  savePushTokenToFirestore,
} from "@/utils/pushNotifications";

export const unstable_settings = {
  anchor: "(tabs)",
};

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const router = useRouter();
  const segments = useSegments();
  const [authChecked, setAuthChecked] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [showBetaModal, setShowBetaModal] = useState(false);
  const [betaChecked, setBetaChecked] = useState(false);
  const [betaSaving, setBetaSaving] = useState(false);
  const notificationListener = useRef<Notifications.Subscription>();
  const responseListener = useRef<Notifications.Subscription>();
  const APP_ID = "1:1048323489461:web:e3c514fcf0d7748ef848fc";

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      const inTabs = segments[0] === "(tabs)";
      if (!user && inTabs) {
        router.replace("/login");
      } else if (user && segments[0] === "login") {
        router.replace("/");
      }
      setCurrentUserId(user?.uid ?? null);
      setAuthChecked(true);
    });
    return () => unsubscribe();
  }, [router, segments]);

  // Register for push notifications when user is logged in
  useEffect(() => {
    if (!currentUserId) return;

    registerForPushNotificationsAsync().then((token) => {
      if (token) {
        savePushTokenToFirestore(token);
      }
    });

    // Listen for notification taps (when user taps a notification)
    responseListener.current = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        const data = response.notification.request.content.data;
        if (data?.chatId && data?.buddyId) {
          router.push({
            pathname: "/chat",
            params: {
              chatId: data.chatId as string,
              buddyId: data.buddyId as string,
            },
          });
        }
      }
    );

    return () => {
      if (notificationListener.current) {
        Notifications.removeNotificationSubscription(notificationListener.current);
      }
      if (responseListener.current) {
        Notifications.removeNotificationSubscription(responseListener.current);
      }
    };
  }, [currentUserId, router]);

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
      if (agreed) {
        setBetaChecked(false);
      }
    });

    return () => unsubscribe();
  }, [APP_ID, currentUserId]);

  const handleBetaAgree = async () => {
    if (!currentUserId || betaSaving) return;
    setBetaSaving(true);
    try {
      const userRef = doc(db, "artifacts", APP_ID, "users", currentUserId);
      await setDoc(
        userRef,
        {
          betaAgreed: true,
          betaAgreedAt: serverTimestamp(),
        },
        { merge: true }
      );
    } finally {
      setBetaSaving(false);
    }
  };

  if (!authChecked) {
    return (
      <GluestackUIProvider mode="dark">
        <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
          <View className="flex-1 bg-[#1A1F25] items-center justify-center">
            <ActivityIndicator size="large" color="#8BC34A" />
          </View>
        </ThemeProvider>
      </GluestackUIProvider>
    );
  }

  // Replace with your Stripe publishable key (pk_live_... or pk_test_...)
  // You get this from https://dashboard.stripe.com/apikeys
  const STRIPE_PUBLISHABLE_KEY = "pk_test_51T6yYLPSSNYdXAll0E6iEsq9OI01LzgHHS77wQn8g7yr5naj7IwU1jxz3YRuHhMqhR2YFzWsoc1mDqW6ntaVxlBD00V0tvJ2op";

  return (
    <StripeProvider
      publishableKey={STRIPE_PUBLISHABLE_KEY}
      merchantIdentifier="merchant.com.beartoe.trailmatch"
    >
    <KeyboardProvider>
    <GluestackUIProvider mode="dark">
      <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
        <Stack>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="login" options={{ headerShown: false }} />
          <Stack.Screen name="registration-confirmation" options={{ headerShown: false }} />
          <Stack.Screen
            name="modal"
            options={{ presentation: "modal", title: "Modal" }}
          />
        </Stack>
        <StatusBar style="auto" />
        <Modal
          transparent
          animationType="fade"
          visible={authChecked && !!currentUserId && showBetaModal}
          onRequestClose={() => {}}
        >
          <View
            className="flex-1 bg-slate-950/90 items-center justify-center px-5"
            style={{ backdropFilter: "blur(20px)" }}
          >
            <View className="w-full max-w-xl bg-slate-900/80 border border-emerald-500/20 rounded-3xl p-6">
              <Text className="text-emerald-400 text-2xl font-bold mb-4 text-center">
                TrailMatch Beta Tester Agreement
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
      </ThemeProvider>
    </GluestackUIProvider>
    </KeyboardProvider>
    </StripeProvider>
  );
}
