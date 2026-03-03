import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { doc, getDoc } from 'firebase/firestore';
import { ArrowLeft, Calendar, MapPin, Route, Clock } from 'lucide-react-native';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import QRCode from 'react-native-qrcode-svg';
import { db } from '../src/firebaseConfig';

const getParam = (param: string | string[] | undefined, fallback: string = ''): string => {
  if (!param) return fallback;
  return Array.isArray(param) ? param[0] : param;
};

const formatDate = (value: any): string => {
  if (!value) return 'TBD';
  if (typeof value === 'string') {
    if (!value.includes('T') && !value.includes('Z')) {
      return value;
    }
    try {
      const parsed = new Date(value);
      if (!isNaN(parsed.getTime())) {
        return parsed.toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        });
      }
    } catch {
      return value;
    }
  }
  if (typeof value === 'object' && value !== null) {
    try {
      if (typeof value.toDate === 'function') {
        return value.toDate().toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        });
      }
      if ('seconds' in value && typeof value.seconds === 'number') {
        return new Date(value.seconds * 1000).toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        });
      }
    } catch {}
  }
  return String(value);
};

export default function DigitalBibScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const params = useLocalSearchParams();

  const registrationId = getParam(params.registrationId);
  const bibNumber = getParam(params.bibNumber, '----');
  const raceName = getParam(params.raceName, 'Race');
  const runnerName = getParam(params.runnerName, 'Runner');
  const distance = getParam(params.distance, '');
  const shirtSize = getParam(params.shirtSize, '');
  const startTime = getParam(params.startTime, '');
  const trailId = getParam(params.trailId);

  const [raceLocation, setRaceLocation] = useState('');
  const [raceDate, setRaceDate] = useState('');
  const [loading, setLoading] = useState(true);

  // Hide default header
  useEffect(() => {
    navigation.setOptions({ headerShown: false });
  }, [navigation]);

  // Fetch race details for location and date
  useEffect(() => {
    const fetchRaceDetails = async () => {
      if (!trailId) {
        setLoading(false);
        return;
      }
      try {
        const trailDoc = await getDoc(doc(db, 'trails', trailId));
        if (trailDoc.exists()) {
          const data = trailDoc.data();
          setRaceLocation(data.location || '');
          setRaceDate(formatDate(data.date));
        }
      } catch (error) {
        console.error('Error fetching race details for bib:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchRaceDetails();
  }, [trailId]);

  // QR code encodes a check-in URL that the director portal handles
  const qrData = `https://trailmatch-49203553-49000.web.app/checkin?registrationId=${encodeURIComponent(registrationId)}&trailId=${encodeURIComponent(trailId)}&bib=${encodeURIComponent(bibNumber)}&runner=${encodeURIComponent(runnerName)}&raceName=${encodeURIComponent(raceName)}`;

  if (loading) {
    return (
      <SafeAreaView className="flex-1 bg-[#1A1F25]" edges={['top', 'left', 'right']}>
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#10b981" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-[#1A1F25]" edges={['top', 'left', 'right']}>
      {/* Header */}
      <View className="px-5 pt-4 pb-2 flex-row items-center">
        <TouchableOpacity onPress={() => router.back()} className="mr-4">
          <ArrowLeft size={24} color="#10b981" />
        </TouchableOpacity>
        <Text className="text-2xl font-bold text-white">Digital Bib</Text>
      </View>

      {/* Bib Card */}
      <View className="flex-1 px-5 pt-4">
        <View className="bg-white rounded-3xl overflow-hidden" style={{
          shadowColor: '#10b981',
          shadowOffset: { width: 0, height: 8 },
          shadowOpacity: 0.25,
          shadowRadius: 20,
          elevation: 12,
        }}>

          {/* Top accent bar */}
          <View className="h-2 bg-emerald-500" />

          {/* Race name header */}
          <View className="bg-slate-900 px-6 py-5">
            <Text className="text-emerald-400 text-xs font-bold tracking-widest mb-1">
              OFFICIAL ENTRY
            </Text>
            <Text className="text-white text-2xl font-bold" numberOfLines={2}>
              {raceName}
            </Text>
          </View>

          {/* Bib number — the main visual */}
          <View className="items-center py-8 bg-white">
            <Text className="text-gray-400 text-xs font-bold tracking-widest mb-2">
              BIB NUMBER
            </Text>
            <Text
              className="text-slate-900 font-black"
              style={{ fontSize: 72, lineHeight: 80 }}
            >
              {bibNumber}
            </Text>
            <Text className="text-slate-700 text-xl font-bold mt-1">
              {runnerName}
            </Text>
          </View>

          {/* Divider */}
          <View className="mx-6 border-t border-dashed border-gray-300" />

          {/* Race details grid */}
          <View className="px-6 py-5">
            <View className="flex-row flex-wrap">
              {raceDate ? (
                <View className="w-1/2 mb-4">
                  <View className="flex-row items-center mb-1">
                    <Calendar size={14} color="#6b7280" />
                    <Text className="text-gray-400 text-xs ml-1.5 font-semibold">DATE</Text>
                  </View>
                  <Text className="text-slate-800 text-sm font-bold">{raceDate}</Text>
                </View>
              ) : null}

              {raceLocation ? (
                <View className="w-1/2 mb-4">
                  <View className="flex-row items-center mb-1">
                    <MapPin size={14} color="#6b7280" />
                    <Text className="text-gray-400 text-xs ml-1.5 font-semibold">LOCATION</Text>
                  </View>
                  <Text className="text-slate-800 text-sm font-bold" numberOfLines={2}>{raceLocation}</Text>
                </View>
              ) : null}

              {distance ? (
                <View className="w-1/2 mb-4">
                  <View className="flex-row items-center mb-1">
                    <Route size={14} color="#6b7280" />
                    <Text className="text-gray-400 text-xs ml-1.5 font-semibold">DISTANCE</Text>
                  </View>
                  <Text className="text-slate-800 text-sm font-bold">{distance}</Text>
                </View>
              ) : null}

              {startTime ? (
                <View className="w-1/2 mb-4">
                  <View className="flex-row items-center mb-1">
                    <Clock size={14} color="#6b7280" />
                    <Text className="text-gray-400 text-xs ml-1.5 font-semibold">START TIME</Text>
                  </View>
                  <Text className="text-slate-800 text-sm font-bold">{startTime}</Text>
                </View>
              ) : null}
            </View>
          </View>

          {/* Divider */}
          <View className="mx-6 border-t border-dashed border-gray-300" />

          {/* QR Code */}
          <View className="items-center py-6 bg-white">
            <Text className="text-gray-400 text-xs font-bold tracking-widest mb-3">
              SCAN AT CHECK-IN
            </Text>
            <QRCode
              value={qrData}
              size={140}
              color="#0f172a"
              backgroundColor="#ffffff"
            />
          </View>

          {/* Bottom accent bar */}
          <View className="h-2 bg-emerald-500" />
        </View>

        {/* Instruction text below the card */}
        <Text className="text-gray-500 text-sm text-center mt-5 px-4">
          Present this digital bib at packet pickup or the start line. Race officials can scan the QR code to verify your registration.
        </Text>
      </View>
    </SafeAreaView>
  );
}
