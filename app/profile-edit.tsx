import { useNavigation, useRouter } from 'expo-router';
import { updateProfile } from 'firebase/auth';
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import * as ImagePicker from 'expo-image-picker';
import { ArrowLeft } from 'lucide-react-native';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import KeyboardScreen from './components/KeyboardScreen';
import { auth, db, storage } from '../src/firebaseConfig';
import { getCoordinatesForCity } from '../utils/geolocationUtils';

export default function ProfileEditScreen() {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [username, setUsername] = useState('');
  const [hometown, setHometown] = useState('');
  const [bio, setBio] = useState('');
  const [primaryDistance, setPrimaryDistance] = useState('');
  const [preferredTerrain, setPreferredTerrain] = useState('');
  const [paceRange, setPaceRange] = useState('');
  const [lookingFor, setLookingFor] = useState<string[]>([]);
  const [openDMs, setOpenDMs] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [profileImageUrl, setProfileImageUrl] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const user = auth.currentUser;
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const navigation = useNavigation();

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
            const data = userDoc.data();
            const resolvedFirstName =
              data.firstName ||
              (data.name ? String(data.name).split(' ')[0] : '') ||
              '';
            const resolvedLastName =
              data.lastName ||
              (data.name ? String(data.name).split(' ').slice(1).join(' ') : '') ||
              '';
            setFirstName(resolvedFirstName);
            setLastName(resolvedLastName);
            setUsername(data.username || '');
            setHometown(data.hometown || data.locationName || data.location || '');
            setBio(data.bio || '');
            setPrimaryDistance(data.primaryDistance || '');
            setPreferredTerrain(data.preferredTerrain || '');
            setPaceRange(data.paceRange || '');
            setLookingFor(Array.isArray(data.lookingFor) ? data.lookingFor : []);
            setOpenDMs(data.openDMs !== false);
            // Set profile image from user's photoURL or avatarUrl
            setProfileImageUrl(data.avatarUrl || data.photoURL || user.photoURL || null);
          } else {
            // No user document found
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

  const handleSaveProfile = async () => {
    if (!user) return;

    setSaving(true);
    try {
      const fullName = `${firstName} ${lastName}`.trim();
      const userDocRef = doc(db, "users", user.uid);
      const updateData: Record<string, any> = {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        username: username,
        hometown: hometown,
        location: hometown,
        bio: bio,
        primaryDistance: primaryDistance,
        preferredTerrain: preferredTerrain,
        paceRange: paceRange,
        lookingFor: lookingFor,
        openDMs: openDMs,
      };
      if (hometown.trim()) {
        updateData.locationName = hometown.trim();
        const coords = getCoordinatesForCity(hometown.trim());
        if (coords) {
          updateData.latitude = coords.lat;
          updateData.longitude = coords.lon;
        }
      }
      if (fullName) {
        updateData.name = fullName;
      } else if (username) {
        updateData.name = username;
      }
      await updateDoc(userDocRef, updateData);
      Alert.alert("Profile Saved!");
      router.back(); // Go back to the profile screen
    } catch (error) {
      console.error("Error saving profile: ", error);
      Alert.alert("Error", "Could not save profile.");
    } finally {
      setSaving(false);
    }
  };

  const uploadImageAndSaveURL = async (uri: string) => {
    if (!auth.currentUser) return;
    const uid = auth.currentUser.uid;

    // Set a loading state here if you have one
    setUploadingImage(true);

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

      // Update the local state (e.g., setProfileImage(downloadURL))
      // so the new image appears instantly.
      setProfileImageUrl(downloadURL);
    } catch (error: any) {
      // Use 'any' to access code/message
      console.error("Error uploading image:", error.message);
      console.error("Firebase Error Code:", error.code);
      Alert.alert("Error", `Failed to upload image: ${error.message}`);
    }

    // Set loading to false here
    setUploadingImage(false);
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

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#1A1F25' }}>
        <ActivityIndicator size="large" color="#8BC34A" />
      </View>
    );
  }

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
        <Text className="text-2xl font-bold text-white">Edit Profile</Text>
      </View>
      <KeyboardScreen
        style={{ flex: 1, backgroundColor: '#2A3038' }}
        contentContainerStyle={{ padding: 20 }}
      >
          <View className="bg-gray-800 rounded-3xl p-6">

        <View className="items-center mb-8">
          <Pressable onPress={handlePickImage} disabled={uploadingImage}>
            <View className="relative">
              <Image 
                source={{ 
                  uri: profileImageUrl || user?.photoURL || 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=900&auto=format&fit=crop&q=60&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxzZWFyY2h8M3x8dXNlcnxlbnwwfHwwfHx8MA%3D%3D' 
                }} 
                className="w-32 h-32 rounded-full mb-4"
              />
              {uploadingImage && (
                <View className="absolute inset-0 items-center justify-center bg-black/50 rounded-full">
                  <ActivityIndicator size="small" color="#8BC34A" />
                </View>
              )}
            </View>
          </Pressable>
          <TouchableOpacity 
            className="bg-green-500 rounded-full py-3 px-6"
            onPress={handlePickImage}
            disabled={uploadingImage}
          >
            <Text className="text-white font-semibold">
              {uploadingImage ? 'Uploading...' : 'Change Photo'}
            </Text>
          </TouchableOpacity>
        </View>

        <View className="mb-6">
          <Text className="text-gray-300 mb-2 ml-2">First Name</Text>
          <TextInput
            className="bg-gray-700 rounded-xl p-4 text-white"
            placeholder="Enter your first name"
            placeholderTextColor="#9CA3AF"
            value={firstName}
            onChangeText={setFirstName}
          />
        </View>

        <View className="mb-6">
          <Text className="text-gray-300 mb-2 ml-2">Last Name</Text>
          <TextInput
            className="bg-gray-700 rounded-xl p-4 text-white"
            placeholder="Enter your last name"
            placeholderTextColor="#9CA3AF"
            value={lastName}
            onChangeText={setLastName}
          />
        </View>

        <View className="mb-6">
          <Text className="text-gray-300 mb-2 ml-2">Username</Text>
          <TextInput
            className="bg-gray-700 rounded-xl p-4 text-white"
            placeholder="Enter your username"
            placeholderTextColor="#9CA3AF"
            value={username}
            onChangeText={setUsername}
          />
        </View>

        <View className="mb-6">
          <Text className="text-gray-300 mb-2 ml-2">Hometown</Text>
          <TextInput
            className="bg-gray-700 rounded-xl p-4 text-white"
            placeholder="Where are you based?"
            placeholderTextColor="#9CA3AF"
            value={hometown}
            onChangeText={setHometown}
          />
        </View>

        <View className="mb-6">
          <Text className="text-gray-300 mb-2 ml-2">Bio</Text>
          <TextInput
            className="bg-gray-700 rounded-xl p-4 text-white h-24"
            placeholder="Tell us about yourself"
            placeholderTextColor="#9CA3AF"
            value={bio}
            onChangeText={setBio}
            multiline
            textAlignVertical="top"
          />
        </View>

        <View className="mb-6">
          <Text className="text-gray-300 mb-2 ml-2">Primary Distance</Text>
          <TextInput
            className="bg-gray-700 rounded-xl p-4 text-white"
            placeholder="e.g. 50K, 50M, 100K"
            placeholderTextColor="#9CA3AF"
            value={primaryDistance}
            onChangeText={setPrimaryDistance}
          />
        </View>

        <View className="mb-6">
          <Text className="text-gray-300 mb-2 ml-2">Preferred Terrain</Text>
          <TextInput
            className="bg-gray-700 rounded-xl p-4 text-white"
            placeholder="e.g. Mountain, Desert, Forest"
            placeholderTextColor="#9CA3AF"
            value={preferredTerrain}
            onChangeText={setPreferredTerrain}
          />
        </View>

        <View className="mb-6">
          <Text className="text-gray-300 mb-2 ml-2">Pace Range</Text>
          <TextInput
            className="bg-gray-700 rounded-xl p-4 text-white"
            placeholder="e.g. 9–11 min/mi"
            placeholderTextColor="#9CA3AF"
            value={paceRange}
            onChangeText={setPaceRange}
          />
        </View>

        <View className="mb-6">
          <Text className="text-gray-300 mb-2 ml-2">Looking For</Text>
          <View className="flex-row flex-wrap gap-2">
            {['carpool', 'pacer', 'crew'].map((tag) => {
              const isActive = lookingFor.includes(tag);
              return (
                <TouchableOpacity
                  key={tag}
                  className={`px-4 py-2 rounded-full ${
                    isActive ? 'bg-green-500' : 'border border-gray-600'
                  }`}
                  onPress={() => {
                    setLookingFor((prev) =>
                      prev.includes(tag) ? prev.filter((item) => item !== tag) : [...prev, tag]
                    );
                  }}
                >
                  <Text className={isActive ? 'text-white font-semibold' : 'text-gray-300'}>
                    {tag.charAt(0).toUpperCase() + tag.slice(1)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <View className="mb-8">
          <Text className="text-gray-300 mb-2 ml-2">Open DMs</Text>
          <TouchableOpacity
            className={`px-4 py-3 rounded-full ${
              openDMs ? 'bg-green-500' : 'border border-gray-600'
            }`}
            onPress={() => setOpenDMs((prev) => !prev)}
          >
            <Text className={openDMs ? 'text-white font-semibold text-center' : 'text-gray-300 text-center'}>
              {openDMs ? 'DMs Open' : 'DMs Closed'}
            </Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          className="bg-green-500 rounded-xl py-4 mb-6 items-center"
          onPress={handleSaveProfile}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator size="small" color="#ffffff" />
          ) : (
            <Text className="text-white text-lg font-semibold">Save Profile</Text>
          )}
        </TouchableOpacity>
          </View>
      </KeyboardScreen>
    </SafeAreaView>
  );
}