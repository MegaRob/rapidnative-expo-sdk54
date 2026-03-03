import * as ImagePicker from 'expo-image-picker';
import { useNavigation, useRouter } from 'expo-router';
import { signOut, updateProfile } from 'firebase/auth';
import { collection, doc, getDoc, getDocs, query, updateDoc, where } from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { ArrowLeft } from 'lucide-react-native';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Button, Image, Linking, Pressable, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { auth, db, storage } from '../src/firebaseConfig';

// Define a type for our user data based on the PRD
interface UserData {
  firstName?: string;
  lastName?: string;
  name?: string;
  username?: string;
  displayName?: string;
  email?: string;
  hometown?: string;
  bio?: string;
  location?: string;
  primaryDistance?: string;
  preferredTerrain?: string;
  paceRange?: string;
  lookingFor?: string[];
  openDMs?: boolean;
  pace?: string;
  avatarUrl?: string;
  // Add other fields from your PRD if needed
}

export default function ProfileScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const [userData, setUserData] = useState<UserData | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileImageUrl, setProfileImageUrl] = useState<string | null>(null);
  const [completedCount, setCompletedCount] = useState(0);
  const user = auth.currentUser;

  // Hide default header
  useEffect(() => {
    navigation.setOptions({
      headerShown: false,
    });
  }, [navigation]);

  useEffect(() => {
    const fetchUserData = async () => {
      if (user) {
        try {
          const userDocRef = doc(db, "users", user.uid);
          const userDoc = await getDoc(userDocRef);
          if (userDoc.exists()) {
            const data = userDoc.data() as UserData;
            setUserData(data);
            // Set profile image from user's photoURL or avatarUrl
            setProfileImageUrl(data.avatarUrl || user.photoURL || null);
          } else {
            console.log("No such user document!");
          }
        } catch (error) {
          console.error("Error fetching user data: ", error);
        } finally {
          setLoading(false);
        }
      } else {
        setLoading(false);
      }
    };

    fetchUserData();
  }, [user]); // Re-run if the user changes

  useEffect(() => {
    const fetchCompletedCount = async () => {
      if (!user?.uid) {
        setCompletedCount(0);
        return;
      }
      try {
        const completedQuery = query(
          collection(db, 'completed_races'),
          where('userId', '==', user.uid)
        );
        const snapshot = await getDocs(completedQuery);
        setCompletedCount(snapshot.size);
      } catch (error) {
        console.error('Error fetching completed races:', error);
        setCompletedCount(0);
      }
    };

    fetchCompletedCount();
  }, [user?.uid]);

  const uploadImageAndSaveURL = async (uri: string) => {
    if (!auth.currentUser) return;
    const uid = auth.currentUser.uid;

    try {
      // Convert the image URI to a blob
      const response = await fetch(uri);
      const blob = await response.blob();

      // Create a unique path in Firebase Storage
      const storageRef = ref(storage, `profile_photos/${uid}`);

      // Upload the blob
      await uploadBytes(storageRef, blob);

      // Get the public download URL
      const downloadURL = await getDownloadURL(storageRef);

      // --- Save the URL in BOTH places ---
      // 1. Update the Firebase Auth profile
      await updateProfile(auth.currentUser, { photoURL: downloadURL });

      // 2. Update the Firestore user document
      const userDocRef = doc(db, 'users', uid);
      await updateDoc(userDocRef, { photoURL: downloadURL, avatarUrl: downloadURL });

      // Update the local state so the new image appears instantly
      setProfileImageUrl(downloadURL);
      setUserData(prev => prev ? { ...prev, avatarUrl: downloadURL } : null);
    } catch (error) {
      console.error("Error uploading image:", error);
      Alert.alert("Error", "Failed to upload image.");
    }
  };

  const handlePickImage = async () => {
    try {
      // Ask for permission
      const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
      
      if (permissionResult.granted === false) {
        Alert.alert("Permission Required", "We need permission to access your photo library.");
        return;
      }

      // Launch the picker
      const result = await ImagePicker.launchImageLibraryAsync({
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.7,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const uri = result.assets[0].uri;
        await uploadImageAndSaveURL(uri);
      }
    } catch (error) {
      console.error("Error picking image:", error);
      Alert.alert("Error", "Failed to pick image.");
    }
  };

  const onSignOut = async () => {
    try {
      await signOut(auth);
      router.replace('/login'); // Use replace to prevent going "back"
    } catch (error) {
      console.error("Sign out error", error);
    }
  };

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#1A1F25' }}>
        <ActivityIndicator size="large" color="#8BC34A" />
      </View>
    );
  }

  // Fallback values for display
  const fullName = [userData?.firstName, userData?.lastName].filter(Boolean).join(' ').trim();
  const displayName = fullName || userData?.name || userData?.displayName || userData?.username || user?.email?.split('@')[0] || 'User';
  const bio = userData?.bio || 'No bio available';
  const pace = userData?.pace || 'Not set';
  const avatarUrl = profileImageUrl || userData?.avatarUrl || user?.photoURL || 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=900&auto=format&fit=crop&q=60&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxzZWFyY2h8M3x8dXNlcnxlbnwwfHwwfHx8MA%3D%3D';
  const location = userData?.hometown || userData?.location || 'Not set';
  const email = user?.email || userData?.email || 'Not available';
  const primaryDistance = userData?.primaryDistance || 'Not set';
  const preferredTerrain = userData?.preferredTerrain || 'Not set';
  const paceRange = userData?.paceRange || 'Not set';
  const lookingFor = Array.isArray(userData?.lookingFor) ? userData?.lookingFor : [];
  const openDMs = userData?.openDMs !== false;
  const badgeThresholds = [1, 5, 10, 15];
  const earnedBadges = badgeThresholds.filter((threshold) => completedCount >= threshold);

  return (
    <SafeAreaView className="flex-1 bg-[#1A1F25]" edges={['top', 'left', 'right']}>
      {/* Header with back button */}
      <View className="px-4 pt-4 pb-2 flex-row items-center">
        <TouchableOpacity 
          onPress={() => router.back()}
          className="mr-4"
        >
          <ArrowLeft size={24} color="#8BC34A" />
        </TouchableOpacity>
        <Text className="text-2xl font-bold text-white">Your Profile</Text>
      </View>
      <ScrollView style={{ flex: 1, backgroundColor: '#2A3038' }} contentContainerStyle={{ padding: 20 }}>
        <View className="bg-gray-800 rounded-3xl p-6">

        {/* Avatar */}
        <View className="items-center mb-8">
          <Pressable onPress={handlePickImage}>
            <Image 
              source={{ uri: avatarUrl }} 
              className="w-32 h-32 rounded-full mb-4"
            />
          </Pressable>
          <Text className="text-gray-400 text-sm mt-2">Tap to change photo</Text>
        </View>

        {/* User Info */}
        <View className="mb-8">
          <View className="mb-6">
            <Text className="text-gray-400 text-sm mb-1 ml-2">Name</Text>
            <Text className="text-white text-lg font-semibold bg-gray-700 rounded-xl p-4">
              {displayName}
            </Text>
          </View>

          <View className="mb-6">
            <Text className="text-gray-400 text-sm mb-1 ml-2">Email</Text>
            <Text className="text-white text-lg font-semibold bg-gray-700 rounded-xl p-4">
              {email}
            </Text>
          </View>

          <View className="mb-6">
            <Text className="text-gray-400 text-sm mb-1 ml-2">Bio</Text>
            <Text className="text-white text-lg bg-gray-700 rounded-xl p-4">
              {bio}
            </Text>
          </View>

          <View className="mb-6">
            <Text className="text-gray-400 text-sm mb-1 ml-2">Hometown</Text>
            <Text className="text-white text-lg bg-gray-700 rounded-xl p-4">
              {location && location.trim() !== '' ? location : 'Not set'}
            </Text>
          </View>

          <View className="mb-2">
            <Text className="text-gray-400 text-sm mb-1 ml-2">Pace</Text>
            <Text className="text-white text-lg bg-gray-700 rounded-xl p-4">
              {pace}
            </Text>
          </View>

          <View className="mb-6 mt-6">
            <Text className="text-gray-400 text-sm mb-1 ml-2">Primary Distance</Text>
            <Text className="text-white text-lg bg-gray-700 rounded-xl p-4">
              {primaryDistance}
            </Text>
          </View>

          <View className="mb-6">
            <Text className="text-gray-400 text-sm mb-1 ml-2">Preferred Terrain</Text>
            <Text className="text-white text-lg bg-gray-700 rounded-xl p-4">
              {preferredTerrain}
            </Text>
          </View>

          <View className="mb-6">
            <Text className="text-gray-400 text-sm mb-1 ml-2">Pace Range</Text>
            <Text className="text-white text-lg bg-gray-700 rounded-xl p-4">
              {paceRange}
            </Text>
          </View>

          <View className="mb-6">
            <Text className="text-gray-400 text-sm mb-2 ml-2">Looking For</Text>
            <View className="flex-row flex-wrap gap-2">
              {lookingFor.length === 0 ? (
                <Text className="text-gray-400 ml-2">None set</Text>
              ) : (
                lookingFor.map((tag) => (
                  <View key={tag} className="bg-green-500/20 px-3 py-1 rounded-full">
                    <Text className="text-green-400 text-sm">
                      {tag.charAt(0).toUpperCase() + tag.slice(1)}
                    </Text>
                  </View>
                ))
              )}
            </View>
          </View>

          <View className="mb-6">
            <Text className="text-gray-400 text-sm mb-1 ml-2">DM Status</Text>
            <Text className="text-white text-lg bg-gray-700 rounded-xl p-4">
              {openDMs ? 'Open to DMs' : 'DMs Closed'}
            </Text>
          </View>
        </View>

        <View className="mb-8">
          <Text className="text-gray-400 text-sm mb-2 ml-2">Races Completed</Text>
          <Text className="text-white text-lg bg-gray-700 rounded-xl p-4 mb-3">
            {completedCount}
          </Text>
          <View className="flex-row flex-wrap gap-2">
            {earnedBadges.length === 0 ? (
              <Text className="text-gray-400 ml-2">No badges yet</Text>
            ) : (
              earnedBadges.map((threshold) => (
                <View key={threshold} className="bg-green-500/20 px-3 py-1 rounded-full">
                  <Text className="text-green-400 text-sm">{threshold} Races</Text>
                </View>
              ))
            )}
          </View>
        </View>

        {/* Action Buttons */}
        <View style={{ marginTop: 30 }}>
          <Button 
            title="Edit Profile" 
            onPress={() => router.push('/profile-edit')} 
            color="#8BC34A" 
          />
          <View style={{ marginTop: 15 }} />
          <Button 
            title="Settings" 
            onPress={() => router.push('/settings')} 
            color="#9CA3AF" 
          />
          <View style={{ marginTop: 15 }} />
          <Button 
            title="Give Feedback" 
            onPress={() => Linking.openURL('https://forms.gle/YOUR_FORM_ID')} 
            color="#2196F3" 
          />
          <View style={{ marginTop: 15 }} />
          <Button 
            title="Log Out" 
            onPress={onSignOut} 
            color="#D9534F" 
          />
        </View>
      </View>
    </ScrollView>
    </SafeAreaView>
  );
}