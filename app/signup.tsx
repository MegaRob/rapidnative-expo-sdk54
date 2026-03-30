import { useRouter } from 'expo-router';
import { doc, setDoc, Timestamp } from "firebase/firestore";
import { syncUserPublicDisplay, userPrivateAccountRef } from '../utils/userProfile';
import { Mountain } from 'lucide-react-native';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import KeyboardScreen from './components/KeyboardScreen';
import { auth, createUserWithEmailAndPassword, db } from "@/src/firebaseConfig";

export default function SignUpScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  // Animations
  const logoScale = useRef(new Animated.Value(0)).current;
  const formOpacity = useRef(new Animated.Value(0)).current;
  const formTranslateY = useRef(new Animated.Value(30)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.spring(logoScale, {
        toValue: 1,
        tension: 50,
        friction: 7,
        useNativeDriver: true,
      }),
      Animated.parallel([
        Animated.timing(formOpacity, {
          toValue: 1,
          duration: 400,
          useNativeDriver: true,
        }),
        Animated.timing(formTranslateY, {
          toValue: 0,
          duration: 400,
          useNativeDriver: true,
        }),
      ]),
    ]).start();
  }, [formOpacity, formTranslateY, logoScale]);

  const handleSignUp = async () => {
    if (!email || !password || !confirmPassword) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }

    if (password.length < 6) {
      Alert.alert('Weak Password', 'Password must be at least 6 characters.');
      return;
    }

    if (password !== confirmPassword) {
      Alert.alert('Error', 'Passwords do not match');
      return;
    }

    setIsLoading(true);
    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email.trim().toLowerCase(), password);
      const user = userCredential.user;

      if (user) {
        const userDocRef = doc(db, "users", user.uid);
        const initialRoot = {
          uid: user.uid,
          onboardingComplete: false,
          createdAt: Timestamp.now(),
          username: "NewUser",
          location: "",
          skillLevel: "Beginner",
          bio: "",
          preferredTerrain: [],
          preferredDistance: null,
          preferredDifficulty: null,
          preferredRadius: 0,
          matchedTrails: [],
          friends: []
        };
        await setDoc(userDocRef, initialRoot);
        await syncUserPublicDisplay(user.uid, initialRoot as Record<string, unknown>);
        await setDoc(
          userPrivateAccountRef(user.uid),
          { email: user.email ?? null },
          { merge: true }
        );

        setIsLoading(false);
        router.replace('/onboarding');
      }
    } catch (error: any) {
      setIsLoading(false);
      const code = error?.code || '';
      if (code === 'auth/email-already-in-use') {
        Alert.alert('Account Exists', 'An account with this email already exists. Try logging in.');
      } else if (code === 'auth/weak-password') {
        Alert.alert('Weak Password', 'Password must be at least 6 characters.');
      } else if (code === 'auth/invalid-email') {
        Alert.alert('Invalid Email', 'Please enter a valid email address.');
      } else {
        Alert.alert('Error', error.message || 'Failed to create account');
      }
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <LinearGradient
        colors={['#0F172A', '#1E293B', '#064E3B']}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      />
      <KeyboardScreen
        contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 40 }}
      >
        {/* Logo / Branding */}
        <Animated.View
          style={{
            transform: [{ scale: logoScale }],
            alignItems: 'center',
            marginBottom: 32,
          }}
        >
          <View
            style={{
              width: 80,
              height: 80,
              borderRadius: 24,
              backgroundColor: 'rgba(16, 185, 129, 0.15)',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 16,
              borderWidth: 1,
              borderColor: 'rgba(16, 185, 129, 0.3)',
            }}
          >
            <Mountain color="#10B981" size={40} />
          </View>
          <Text style={{ fontSize: 32, fontWeight: '800', color: '#FFFFFF', letterSpacing: -0.5 }}>
            Join The Collective
          </Text>
          <Text style={{ fontSize: 15, color: '#94A3B8', marginTop: 6 }}>
            Your next adventure starts here
          </Text>
        </Animated.View>

        {/* Form Card */}
        <Animated.View
          style={{
            opacity: formOpacity,
            transform: [{ translateY: formTranslateY }],
            backgroundColor: 'rgba(30, 41, 59, 0.7)',
            borderRadius: 24,
            padding: 24,
            borderWidth: 1,
            borderColor: 'rgba(71, 85, 105, 0.4)',
          }}
        >
          <View style={{ marginBottom: 20 }}>
            <Text style={{ color: '#CBD5E1', marginBottom: 8, marginLeft: 4, fontSize: 14, fontWeight: '600' }}>Email</Text>
            <TextInput
              style={{
                backgroundColor: 'rgba(15, 23, 42, 0.6)',
                borderRadius: 14,
                padding: 16,
                color: '#FFFFFF',
                fontSize: 16,
                borderWidth: 1,
                borderColor: 'rgba(71, 85, 105, 0.5)',
              }}
              placeholder="Enter your email"
              placeholderTextColor="#64748B"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
            />
          </View>

          <View style={{ marginBottom: 20 }}>
            <Text style={{ color: '#CBD5E1', marginBottom: 8, marginLeft: 4, fontSize: 14, fontWeight: '600' }}>Password</Text>
            <TextInput
              style={{
                backgroundColor: 'rgba(15, 23, 42, 0.6)',
                borderRadius: 14,
                padding: 16,
                color: '#FFFFFF',
                fontSize: 16,
                borderWidth: 1,
                borderColor: 'rgba(71, 85, 105, 0.5)',
              }}
              placeholder="Create a password"
              placeholderTextColor="#64748B"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete="new-password"
            />
          </View>

          <View style={{ marginBottom: 24 }}>
            <Text style={{ color: '#CBD5E1', marginBottom: 8, marginLeft: 4, fontSize: 14, fontWeight: '600' }}>Confirm Password</Text>
            <TextInput
              style={{
                backgroundColor: 'rgba(15, 23, 42, 0.6)',
                borderRadius: 14,
                padding: 16,
                color: '#FFFFFF',
                fontSize: 16,
                borderWidth: 1,
                borderColor: 'rgba(71, 85, 105, 0.5)',
              }}
              placeholder="Confirm your password"
              placeholderTextColor="#64748B"
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              secureTextEntry
              autoComplete="new-password"
            />
          </View>

          <TouchableOpacity
            style={{
              backgroundColor: '#10B981',
              borderRadius: 14,
              paddingVertical: 16,
              alignItems: 'center',
              marginBottom: 20,
              shadowColor: '#10B981',
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 0.3,
              shadowRadius: 8,
              elevation: 4,
            }}
            onPress={handleSignUp}
            disabled={isLoading}
            activeOpacity={0.8}
          >
            {isLoading ? (
              <ActivityIndicator size="small" color="#ffffff" />
            ) : (
              <Text style={{ color: '#FFFFFF', fontSize: 17, fontWeight: '700' }}>Create Account</Text>
            )}
          </TouchableOpacity>

          <View style={{ flexDirection: 'row', justifyContent: 'center' }}>
            <Text style={{ color: '#94A3B8', fontSize: 15 }}>Already have an account? </Text>
            <TouchableOpacity onPress={() => router.replace('/login')}>
              <Text style={{ color: '#10B981', fontWeight: '700', fontSize: 15 }}>Sign In</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
      </KeyboardScreen>
    </View>
  );
}
