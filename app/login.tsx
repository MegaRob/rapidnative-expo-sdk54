import { useRouter } from 'expo-router';
import { sendPasswordResetEmail, signInWithEmailAndPassword } from 'firebase/auth';
import React, { useState } from 'react';
import { ActivityIndicator, Alert, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { auth } from '../src/firebaseConfig';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const router = useRouter();

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
    // Basic validation
    if (!email || !password) {
      setErrorMessage('Please fill in all fields');
      return;
    }

    // Simple email validation
    if (!/\S+@\S+\.\S+/.test(email)) {
      setErrorMessage('Please enter a valid email address');
      return;
    }

    // Firebase login
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
    <KeyboardAwareScrollView
      style={{ flex: 1, backgroundColor: '#111827' }}
      contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24 }}
      keyboardShouldPersistTaps="handled"
      bounces={false}
      bottomOffset={40}
    >
        <View className="bg-gray-800 rounded-3xl p-8">
          <Text className="text-3xl font-bold text-white text-center mb-8">
            Welcome Back
          </Text>

          {errorMessage ? (
            <Text className="text-red-500 text-center mb-4">{errorMessage}</Text>
          ) : null}

          <View className="mb-6">
            <Text className="text-gray-300 mb-2 ml-2">Email</Text>
            <TextInput
              className="bg-gray-700 rounded-xl p-4 text-white"
              placeholder="Enter your email"
              placeholderTextColor="#9CA3AF"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
            />
          </View>

          <View className="mb-4">
            <Text className="text-gray-300 mb-2 ml-2">Password</Text>
            <TextInput
              className="bg-gray-700 rounded-xl p-4 text-white"
              placeholder="Enter your password"
              placeholderTextColor="#9CA3AF"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
            />
          </View>

          <TouchableOpacity onPress={handleForgotPassword} className="mb-6 self-end">
            <Text className="text-green-500 text-sm font-medium">Forgot Password?</Text>
          </TouchableOpacity>

          <TouchableOpacity
            className="bg-green-500 rounded-xl py-4 mb-6 items-center"
            onPress={handleLogin}
            disabled={isLoading}
          >
            {isLoading ? (
              <ActivityIndicator size="small" color="#ffffff" />
            ) : (
              <Text className="text-white text-lg font-semibold">Login</Text>
            )}
          </TouchableOpacity>

          <View className="flex-row justify-center">
            <Text className="text-gray-400">Don't have an account? </Text>
            <TouchableOpacity onPress={() => router.replace('/signup')}>
              <Text className="text-green-500 font-semibold">Create Account</Text>
            </TouchableOpacity>
          </View>
        </View>
    </KeyboardAwareScrollView>
  );
}