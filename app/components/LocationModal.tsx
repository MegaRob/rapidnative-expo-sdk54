import React, { forwardRef, useState, useCallback, useRef } from 'react';
import { View, Text, Pressable, Alert, ActivityIndicator } from 'react-native';
import { BottomSheetTextInput } from '@gorhom/bottom-sheet';
import * as Location from 'expo-location';
import { getCoordinatesForCity } from '../../utils/geolocationUtils';
import StandardBottomSheet, { StandardBottomSheetHandle } from './StandardBottomSheet';

/* ── Public handle exposed via ref ──────────────────────────────────── */
export interface LocationModalHandle {
  present: () => void;
  close: () => void;
}

interface LocationModalProps {
  currentLocationName?: string;
  onClose?: () => void;
  onLocationSet: (locationName: string, latitude: number, longitude: number) => void;
}

const LocationModal = forwardRef<LocationModalHandle, LocationModalProps>(
  ({ currentLocationName, onClose, onLocationSet }, ref) => {
    const sheetRef = useRef<StandardBottomSheetHandle>(null);
    const [manualLocation, setManualLocation] = useState('');
    const [loading, setLoading] = useState(false);
    const [mode, setMode] = useState<'select' | 'manual'>('select');

    // Expose present / close to parent via ref
    React.useImperativeHandle(ref, () => ({
      present: () => {
        setMode('select');
        setManualLocation('');
        setLoading(false);
        sheetRef.current?.present();
      },
      close: () => {
        sheetRef.current?.close();
      },
    }));

    const handleUseGPS = async () => {
      setLoading(true);
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert(
            'Permission Denied',
            'Location permission is required to use GPS. Please enable it in your device settings.'
          );
          setLoading(false);
          return;
        }

        const location = await Location.getCurrentPositionAsync({});
        const { latitude, longitude } = location.coords;

        const geocode = await Location.reverseGeocodeAsync({ latitude, longitude });
        if (geocode && geocode.length > 0) {
          const address = geocode[0];
          const cityName =
            address.city && address.region
              ? `${address.city}, ${address.region}`
              : address.city || address.region || 'Current Location';

          onLocationSet(cityName, latitude, longitude);
          sheetRef.current?.close();
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

      const cachedCoords = getCoordinatesForCity(manualLocation.trim());
      if (cachedCoords) {
        onLocationSet(manualLocation.trim(), cachedCoords.lat, cachedCoords.lon);
        setManualLocation('');
        setLoading(false);
        sheetRef.current?.close();
        return;
      }

      try {
        const results = await Location.geocodeAsync(manualLocation.trim());
        if (results && results.length > 0) {
          const { latitude, longitude } = results[0];
          onLocationSet(manualLocation.trim(), latitude, longitude);
          setManualLocation('');
          sheetRef.current?.close();
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

    const handleClose = useCallback(() => {
      setMode('select');
      setManualLocation('');
      setLoading(false);
      onClose?.();
    }, [onClose]);

    return (
      <StandardBottomSheet
        ref={sheetRef}
        title="Set Search Location"
        snapPoints={['50%', '90%']}
        onClose={handleClose}
      >
        {mode === 'select' ? (
          <View>
            {currentLocationName && (
              <View style={{ marginBottom: 24 }}>
                <Text style={{ color: '#9CA3AF', fontSize: 14, marginBottom: 8 }}>Current Location</Text>
                <Text style={{ color: '#FFFFFF', fontSize: 18, fontWeight: '600' }}>{currentLocationName}</Text>
              </View>
            )}

            <Text style={{ color: '#FFFFFF', fontSize: 18, fontWeight: '600', marginBottom: 16 }}>
              Choose Location Method
            </Text>

            <Pressable
              onPress={handleUseGPS}
              disabled={loading}
              style={{
                width: '100%',
                backgroundColor: '#10B981',
                paddingVertical: 16,
                borderRadius: 8,
                alignItems: 'center',
                marginBottom: 16,
              }}
            >
              {loading ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text style={{ color: '#FFFFFF', fontSize: 18, fontWeight: '700' }}>Use Current GPS</Text>
              )}
            </Pressable>

            <Pressable
              onPress={() => setMode('manual')}
              style={{
                width: '100%',
                backgroundColor: '#334155',
                paddingVertical: 16,
                borderRadius: 8,
                alignItems: 'center',
              }}
            >
              <Text style={{ color: '#FFFFFF', fontSize: 18, fontWeight: '600' }}>Set Manual Location</Text>
            </Pressable>
          </View>
        ) : (
          <View>
            <Text style={{ color: '#FFFFFF', fontSize: 18, fontWeight: '600', marginBottom: 8 }}>
              Enter City Name
            </Text>
            <Text style={{ color: '#9CA3AF', fontSize: 14, marginBottom: 16 }}>
              Enter a city and state (e.g., Boulder, CO or Denver, CO)
            </Text>

            <BottomSheetTextInput
              style={{
                backgroundColor: 'rgba(15, 23, 42, 0.6)',
                borderRadius: 12,
                padding: 16,
                color: '#FFFFFF',
                fontSize: 16,
                borderWidth: 1,
                borderColor: 'rgba(71, 85, 105, 0.5)',
                marginBottom: 16,
              }}
              placeholder="e.g., Boulder, CO"
              placeholderTextColor="#9CA3AF"
              selectionColor="#10B981"
              value={manualLocation}
              onChangeText={setManualLocation}
              autoCapitalize="words"
              onFocus={() => requestAnimationFrame(() => sheetRef.current?.expand())}
            />

            <View style={{ flexDirection: 'row', gap: 12 }}>
              <Pressable
                onPress={() => setMode('select')}
                style={{
                  flex: 1,
                  backgroundColor: '#334155',
                  paddingVertical: 16,
                  borderRadius: 8,
                  alignItems: 'center',
                }}
              >
                <Text style={{ color: '#FFFFFF', fontSize: 18, fontWeight: '600' }}>Back</Text>
              </Pressable>

              <Pressable
                onPress={handleManualLocation}
                disabled={!manualLocation.trim()}
                style={{
                  flex: 1,
                  paddingVertical: 16,
                  borderRadius: 8,
                  alignItems: 'center',
                  backgroundColor: manualLocation.trim() ? '#10B981' : '#334155',
                }}
              >
                <Text style={{ color: '#FFFFFF', fontSize: 18, fontWeight: '700' }}>Set Location</Text>
              </Pressable>
            </View>
          </View>
        )}
      </StandardBottomSheet>
    );
  }
);

LocationModal.displayName = 'LocationModal';
export default LocationModal;
