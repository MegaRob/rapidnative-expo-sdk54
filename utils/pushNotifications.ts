import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { doc, setDoc } from 'firebase/firestore';
import { auth, db } from '../src/firebaseConfig';

// expo-notifications remote push was removed from Expo Go in SDK 53.
// Lazy-require so everything degrades gracefully in Expo Go.
let Notifications: typeof import('expo-notifications') | null = null;
const isExpoGo = Constants.appOwnership === 'expo';
if (!isExpoGo) {
  try {
    Notifications = require('expo-notifications');
  } catch {
    // Native module unavailable — notifications disabled
  }
}

// Configure how notifications appear when the app is in the foreground
if (Notifications) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
    }),
  });
}

/**
 * Register for push notifications and return the Expo push token.
 * Saves the token to the user's Firestore document.
 */
export async function registerForPushNotificationsAsync(): Promise<string | null> {
  // Notifications unavailable in Expo Go (SDK 53+)
  if (!Notifications) return null;

  // Push notifications only work on physical devices
  if (!Device.isDevice) {
    console.log('Push notifications require a physical device');
    return null;
  }

  // Check / request permissions
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    console.log('Push notification permission not granted');
    return null;
  }

  // Get the Expo push token
  try {
    const projectId = 'f296dffd-789f-40a0-b962-2a3ca373f529';
    const tokenData = await Notifications.getExpoPushTokenAsync({
      projectId,
    });
    const token = tokenData.data;

    // Android needs notification channels
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('chat', {
        name: 'Chat Messages',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#10b981',
        sound: 'default',
      });

      await Notifications.setNotificationChannelAsync('race_reminders', {
        name: 'Race Reminders',
        description: 'Upcoming race reminders and weekly new race digests',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#8BC34A',
        sound: 'default',
      });

      await Notifications.setNotificationChannelAsync('social', {
        name: 'Social Updates',
        description: 'When other runners save the same races as you',
        importance: Notifications.AndroidImportance.DEFAULT,
        sound: 'default',
      });
    }

    return token;
  } catch (error) {
    console.error('Error getting push token:', error);
    return null;
  }
}

/**
 * Save the push token to the current user's Firestore document.
 */
export async function savePushTokenToFirestore(token: string): Promise<void> {
  const user = auth.currentUser;
  if (!user || !token) return;

  try {
    const userRef = doc(db, 'users', user.uid);
    await setDoc(userRef, { expoPushToken: token }, { merge: true });
  } catch (error) {
    console.error('Error saving push token:', error);
  }
}

/**
 * Remove the push token from Firestore (e.g., on logout).
 */
export async function removePushTokenFromFirestore(): Promise<void> {
  const user = auth.currentUser;
  if (!user) return;

  try {
    const userRef = doc(db, 'users', user.uid);
    await setDoc(userRef, { expoPushToken: null }, { merge: true });
  } catch (error) {
    console.error('Error removing push token:', error);
  }
}
