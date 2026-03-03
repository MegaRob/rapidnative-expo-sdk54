import { useRouter } from 'expo-router';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { doc, setDoc, Timestamp } from "firebase/firestore";
import React, { useState } from 'react';
import { ActivityIndicator, Alert, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { auth, db } from '../src/firebaseConfig';

export default function SignUpScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  const handleSignUp = async () => {
    // Basic validation
    if (!email || !password || !confirmPassword) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }

    if (password !== confirmPassword) {
      Alert.alert('Error', 'Passwords do not match');
      return;
    }

    // Firebase sign up
    setIsLoading(true);
    try {
      // 1. Create the user in Auth
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;

      if (user) {
        const userDocRef = doc(db, "users", user.uid);
        await setDoc(userDocRef, {
          uid: user.uid,
          email: user.email,
          onboardingComplete: false,
          createdAt: Timestamp.now(),
          username: "NewUser",
          location: "",
          skillLevel: "Beginner",
          bio: "No bio available",
          preferredTerrain: [],
          matchedTrails: [],
          friends: []
        });

        setIsLoading(false);
        router.replace('/onboarding');
      }
    } catch (error: any) {
      setIsLoading(false);
      Alert.alert('Error', error.message || 'Failed to create account');
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
            Create Account
          </Text>

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

          <View className="mb-6">
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

          <View className="mb-8">
            <Text className="text-gray-300 mb-2 ml-2">Confirm Password</Text>
            <TextInput
              className="bg-gray-700 rounded-xl p-4 text-white"
              placeholder="Confirm your password"
              placeholderTextColor="#9CA3AF"
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              secureTextEntry
            />
          </View>

          <TouchableOpacity
            className="bg-green-500 rounded-xl py-4 mb-6 items-center"
            onPress={handleSignUp}
            disabled={isLoading}
          >
            {isLoading ? (
              <ActivityIndicator size="small" color="#ffffff" />
            ) : (
              <Text className="text-white text-lg font-semibold">Sign Up</Text>
            )}
          </TouchableOpacity>

          <View className="flex-row justify-center">
            <Text className="text-gray-400">Already have an account? </Text>
            <TouchableOpacity onPress={() => router.replace('/login')}>
              <Text className="text-green-500 font-semibold">Go to Login</Text>
            </TouchableOpacity>
          </View>
        </View>
    </KeyboardAwareScrollView>
  );
}