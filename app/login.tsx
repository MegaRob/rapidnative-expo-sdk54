import { useRouter } from 'expo-router';
import { Mountain } from 'lucide-react-native';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import KeyboardScreen from './components/KeyboardScreen';
import {
  auth,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
} from "@/src/firebaseConfig";

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
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
  }, []);

  const handleForgotPassword = async () => {
    const trimmedEmail = email.trim().toLowerCase();

    if (!trimmedEmail) {
      Alert.alert('Enter Your Email', 'Please enter your email address above, then tap "Forgot Password" again.');
      return;
    }

    if (!/\S+@\S+\.\S+/.test(trimmedEmail)) {
      Alert.alert('Invalid Email', 'Please enter a valid email address.');
      return;
    }

    try {
      await sendPasswordResetEmail(auth, trimmedEmail);
      Alert.alert(
        'Reset Email Sent',
        `We've sent a password reset link to ${trimmedEmail}. Check your inbox (and spam folder) to reset your password.`
      );
    } catch (error: any) {
      const code = error?.code || '';
      if (code === 'auth/user-not-found') {
        Alert.alert('Account Not Found', 'No account exists with that email address.');
      } else if (code === 'auth/too-many-requests') {
        Alert.alert('Too Many Requests', 'Please wait a moment before trying again.');
      } else if (code === 'auth/invalid-email') {
        Alert.alert('Invalid Email', 'Please enter a valid email address.');
      } else {
        Alert.alert('Error', error.message || 'Failed to send reset email. Please try again.');
      }
    }
  };

  const handleLogin = async () => {
    if (!email || !password) {
      setErrorMessage('Please fill in all fields');
      return;
    }

    if (!/\S+@\S+\.\S+/.test(email)) {
      setErrorMessage('Please enter a valid email address');
      return;
    }

    setIsLoading(true);
    setErrorMessage('');

    try {
      const trimmedEmail = email.trim().toLowerCase();
      await signInWithEmailAndPassword(auth, trimmedEmail, password);
      setIsLoading(false);
      router.push('/');
    } catch (error: any) {
      setIsLoading(false);
      const code = error?.code || '';
      if (code === 'auth/user-not-found' || code === 'auth/invalid-credential') {
        setErrorMessage('No account found with that email, or incorrect password.');
      } else if (code === 'auth/wrong-password') {
        setErrorMessage('Incorrect password. Please try again.');
      } else if (code === 'auth/invalid-email') {
        setErrorMessage('Invalid email format.');
      } else if (code === 'auth/user-disabled') {
        setErrorMessage('This account has been disabled. Contact support.');
      } else if (code === 'auth/too-many-requests') {
        setErrorMessage('Too many failed attempts. Please try again later.');
      } else {
        setErrorMessage(error.message || 'Failed to login. Please try again.');
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
            The Collective
          </Text>
          <Text style={{ fontSize: 15, color: '#94A3B8', marginTop: 6 }}>
            Find your next trail adventure
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
          {errorMessage ? (
            <View style={{
              backgroundColor: 'rgba(239, 68, 68, 0.1)',
              borderRadius: 12,
              padding: 12,
              marginBottom: 16,
              borderWidth: 1,
              borderColor: 'rgba(239, 68, 68, 0.2)',
            }}>
              <Text style={{ color: '#F87171', textAlign: 'center', fontSize: 14 }}>{errorMessage}</Text>
            </View>
          ) : null}

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

          <View style={{ marginBottom: 12 }}>
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
              placeholder="Enter your password"
              placeholderTextColor="#64748B"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete="password"
            />
          </View>

          <TouchableOpacity onPress={handleForgotPassword} style={{ alignSelf: 'flex-end', marginBottom: 20 }}>
            <Text style={{ color: '#10B981', fontSize: 14, fontWeight: '600' }}>Forgot Password?</Text>
          </TouchableOpacity>

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
            onPress={handleLogin}
            disabled={isLoading}
            activeOpacity={0.8}
          >
            {isLoading ? (
              <ActivityIndicator size="small" color="#ffffff" />
            ) : (
              <Text style={{ color: '#FFFFFF', fontSize: 17, fontWeight: '700' }}>Sign In</Text>
            )}
          </TouchableOpacity>

          <View style={{ flexDirection: 'row', justifyContent: 'center' }}>
            <Text style={{ color: '#94A3B8', fontSize: 15 }}>Don't have an account? </Text>
            <TouchableOpacity onPress={() => router.replace('/signup')}>
              <Text style={{ color: '#10B981', fontWeight: '700', fontSize: 15 }}>Sign Up</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
      </KeyboardScreen>
    </View>
  );
}
