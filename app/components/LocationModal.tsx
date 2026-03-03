import React, { useState } from 'react';
import { Modal, View, Text, TextInput, Pressable, Alert, ActivityIndicator } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { SafeAreaView } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';
import * as Location from 'expo-location';
import { getCoordinatesForCity } from '../../utils/geolocationUtils';

interface LocationModalProps {
  visible: boolean;
  currentLocationName?: string;
  onClose: () => void;
  onLocationSet: (locationName: string, latitude: number, longitude: number) => void;
}

export default function LocationModal({
  visible,
  currentLocationName,
  onClose,
  onLocationSet,
}: LocationModalProps) {
  const [manualLocation, setManualLocation] = useState('');
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<'select' | 'manual'>('select');

  const handleUseGPS = async () => {
    setLoading(true);
    try {
      // Request permissions
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Permission Denied',
          'Location permission is required to use GPS. Please enable it in your device settings.'
        );
        setLoading(false);
        return;
      }

      // Get current location
      const location = await Location.getCurrentPositionAsync({});
      const { latitude, longitude } = location.coords;

      // Reverse geocode to get city name
      const geocode = await Location.reverseGeocodeAsync({ latitude, longitude });
      if (geocode && geocode.length > 0) {
        const address = geocode[0];
        const cityName = address.city && address.region
          ? `${address.city}, ${address.region}`
          : address.city || address.region || 'Current Location';

        onLocationSet(cityName, latitude, longitude);
        onClose();
      } else {
        Alert.alert('Error', 'Could not determine location name. Please try manual entry.');
      }
    } catch (error: any) {
      console.error('Error getting GPS location:', error);
      Alert.alert('Error', 'Failed to get GPS location. Please try manual entry.');
    } finally {
      setLoading(false);
    }
  };

  const handleManualLocation = async () => {
    if (!manualLocation.trim()) {
      Alert.alert('Location Required', 'Please enter a city name.');
      return;
    }

    setLoading(true);

    // First try the hardcoded list for instant results
    const cachedCoords = getCoordinatesForCity(manualLocation.trim());
    if (cachedCoords) {
      onLocationSet(manualLocation.trim(), cachedCoords.lat, cachedCoords.lon);
      setManualLocation('');
      setLoading(false);
      onClose();
      return;
    }

    // Fall back to device geocoder (handles any address worldwide)
    try {
      const results = await Location.geocodeAsync(manualLocation.trim());
      if (results && results.length > 0) {
        const { latitude, longitude } = results[0];
        onLocationSet(manualLocation.trim(), latitude, longitude);
        setManualLocation('');
        onClose();
      } else {
        Alert.alert(
          'Location Not Found',
          `We couldn't find coordinates for "${manualLocation}". Please try a different city name or use GPS.`
        );
      }
    } catch (error) {
      console.error('Geocoding error:', error);
      Alert.alert('Error', 'Failed to look up location. Please try GPS instead.');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setMode('select');
    setManualLocation('');
    setLoading(false);
    onClose();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={false}
      onRequestClose={handleClose}
    >
      <SafeAreaView className="flex-1 bg-gray-900">
        {/* Header */}
        <View className="flex-row justify-between items-center p-4 border-b border-gray-700">
          <Text className="text-white text-xl font-bold">Set Search Location</Text>
          <Pressable
            onPress={handleClose}
            className="w-10 h-10 items-center justify-center rounded-full bg-gray-800"
          >
            <X size={24} color="#fff" />
          </Pressable>
        </View>

        {mode === 'select' ? (
          <View className="flex-1 px-6 pt-8">
            {currentLocationName && (
              <View className="mb-6">
                <Text className="text-gray-400 text-sm mb-2">Current Location</Text>
                <Text className="text-white text-lg font-semibold">{currentLocationName}</Text>
              </View>
            )}

            <Text className="text-white text-lg font-semibold mb-4">Choose Location Method</Text>

            <Pressable
              onPress={handleUseGPS}
              disabled={loading}
              className="w-full bg-green-500 py-4 rounded-lg items-center mb-4"
            >
              {loading ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text className="text-white text-lg font-bold">Use Current GPS</Text>
              )}
            </Pressable>

            <Pressable
              onPress={() => setMode('manual')}
              className="w-full bg-gray-700 py-4 rounded-lg items-center"
            >
              <Text className="text-white text-lg font-semibold">Set Manual Location</Text>
            </Pressable>
          </View>
        ) : (
          <KeyboardAwareScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 32 }} keyboardShouldPersistTaps="handled" bottomOffset={40}>
            <Text className="text-white text-lg font-semibold mb-2">Enter City Name</Text>
            <Text className="text-gray-400 text-sm mb-4">
              Enter a city and state (e.g., "Boulder, CO" or "Denver, CO")
            </Text>

            <TextInput
              className="bg-gray-800 rounded-lg p-4 text-white text-base mb-4"
              placeholder="e.g., Boulder, CO"
              placeholderTextColor="#9CA3AF"
              value={manualLocation}
              onChangeText={setManualLocation}
              autoCapitalize="words"
            />

            <View className="flex-row gap-3">
              <Pressable
                onPress={() => setMode('select')}
                className="flex-1 bg-gray-700 py-4 rounded-lg items-center"
              >
                <Text className="text-white text-lg font-semibold">Back</Text>
              </Pressable>

              <Pressable
                onPress={handleManualLocation}
                disabled={!manualLocation.trim()}
                className={`flex-1 py-4 rounded-lg items-center ${
                  manualLocation.trim() ? 'bg-green-500' : 'bg-gray-700'
                }`}
              >
                <Text className="text-white text-lg font-bold">Set Location</Text>
              </Pressable>
            </View>
          </KeyboardAwareScrollView>
        )}
      </SafeAreaView>
    </Modal>
  );
}









