import { useNavigation, useRouter } from 'expo-router';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { ArrowLeft } from 'lucide-react-native';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Switch, Text, TouchableOpacity, View } from 'react-native';
import KeyboardScreen from '../components/KeyboardScreen';
import { SafeAreaView } from 'react-native-safe-area-context';
import { auth, db } from '../../src/firebaseConfig';
import LocationModal, { LocationModalHandle } from '../components/LocationModal';

export default function SettingsScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const [isPrivate, setIsPrivate] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [locationName, setLocationName] = useState<string>('');
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  const locationModalRef = useRef<LocationModalHandle>(null);
  const user = auth.currentUser;

  // Hide default header
  useEffect(() => {
    navigation.setOptions({
      headerShown: false,
    });
  }, [navigation]);

  // Fetch current privacy setting
  useEffect(() => {
    const fetchPrivacySetting = async () => {
      if (!user) {
        setLoading(false);
        return;
      }

      try {
        const userDocRef = doc(db, 'users', user.uid);
        const userDoc = await getDoc(userDocRef);
        
        if (userDoc.exists()) {
          const data = userDoc.data();
          setIsPrivate(data.isPrivate === true);
          setLocationName(data.locationName || '');
          setLatitude(data.latitude || null);
          setLongitude(data.longitude || null);
        }
      } catch (error) {
        console.error('Error fetching settings:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchPrivacySetting();
  }, [user]);

  const handleTogglePrivacy = async (value: boolean) => {
    if (!user) return;

    setSaving(true);
    try {
      const userDocRef = doc(db, 'users', user.uid);
      await updateDoc(userDocRef, {
        isPrivate: value,
      });
      setIsPrivate(value);
      
      Alert.alert(
        value ? 'Private Profile Enabled' : 'Private Profile Disabled',
        value
          ? 'Your profile is now hidden from other runners. You can still discover and register for races, but you will not appear in public lists.'
          : 'Your profile is now visible to other runners.',
        [{ text: 'OK' }]
      );
    } catch (error: any) {
      console.error('Error updating privacy setting:', error);
      Alert.alert('Error', 'Failed to update privacy setting. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleLocationSet = async (name: string, lat: number, lon: number) => {
    if (!user) return;

    setSaving(true);
    try {
      const userDocRef = doc(db, 'users', user.uid);
      await updateDoc(userDocRef, {
        locationName: name,
        latitude: lat,
        longitude: lon,
      });
      setLocationName(name);
      setLatitude(lat);
      setLongitude(lon);
      Alert.alert('Location Updated', `Search location set to ${name}.`);
    } catch (error: any) {
      console.error('Error updating location:', error);
      Alert.alert('Error', 'Failed to update location. Please try again.');
    } finally {
      setSaving(false);
    }
  };


  if (loading) {
    return (
      <SafeAreaView className="flex-1 bg-gray-900" edges={['top', 'left', 'right']}>
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#8BC34A" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-gray-900" edges={['top', 'left', 'right']}>
      {/* Header */}
      <View className="px-5 pt-4 pb-2 flex-row items-center">
        <TouchableOpacity 
          onPress={() => router.back()}
          className="mr-4"
        >
          <ArrowLeft size={24} color="#8BC34A" />
        </TouchableOpacity>
        <View className="flex-1">
          <Text className="text-2xl font-bold text-white">Settings</Text>
          <Text className="text-sm text-gray-400">Manage your preferences</Text>
        </View>
      </View>

      {/* Content */}
      <KeyboardScreen contentContainerStyle={{ padding: 20, paddingTop: 8 }}>
        {/* Privacy Settings Section */}
        <View className="bg-gray-800 rounded-lg p-5 mb-4">
          <Text className="text-white text-xl font-bold mb-4">Privacy Settings</Text>
          
          {/* Private Profile Toggle */}
          <View className="flex-row items-center justify-between py-4 border-b border-gray-700">
            <View className="flex-1 mr-4">
              <Text className="text-white text-base font-semibold mb-1">
                Private Profile
              </Text>
              <Text className="text-gray-400 text-sm leading-5">
                When enabled, your profile will be hidden from other runners. You can still like and register for races, but you will not appear in "Other Runners Going" lists or discovery feeds.
              </Text>
            </View>
            <Switch
              value={isPrivate}
              onValueChange={handleTogglePrivacy}
              disabled={saving}
              trackColor={{ false: '#374151', true: '#8BC34A' }}
              thumbColor={isPrivate ? '#FFFFFF' : '#9CA3AF'}
            />
          </View>
        </View>

        {/* Search Location Section */}
        <View className="bg-gray-800 rounded-lg p-5 mb-4">
          <Text className="text-white text-xl font-bold mb-4">Search Location</Text>
          
          {/* Current Location Display */}
          <View className="mb-4">
            <Text className="text-gray-400 text-sm mb-2">Current Location</Text>
            <Text className="text-white text-base font-semibold">
              {locationName || 'Not set'}
            </Text>
          </View>

          {/* Change Location Button */}
          <TouchableOpacity
            onPress={() => locationModalRef.current?.present()}
            className="w-full bg-green-500 py-3 rounded-lg items-center"
          >
            <Text className="text-white text-base font-semibold">Change Location</Text>
          </TouchableOpacity>
          
          <Text className="text-gray-400 text-sm mt-3">
            Choose between using your current GPS location or setting a virtual location for race discovery.
          </Text>
        </View>

        {/* Other Settings Links */}
        <View className="bg-gray-800 rounded-lg p-5">
          <Text className="text-white text-xl font-bold mb-4">Account</Text>
          
          <TouchableOpacity
            onPress={() => router.push('/settings/blocked-users')}
            className="flex-row items-center justify-between py-4 border-b border-gray-700"
          >
            <Text className="text-white text-base">Blocked Users</Text>
            <Text className="text-gray-400">›</Text>
          </TouchableOpacity>
        </View>
      </KeyboardScreen>

      {/* Location Modal */}
      <LocationModal
        ref={locationModalRef}
        currentLocationName={locationName}
        onLocationSet={handleLocationSet}
      />
    </SafeAreaView>
  );
}

