import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../src/firebaseConfig';

const getParam = (param: string | string[] | undefined, fallback: string = ''): string => {
  if (!param) return fallback;
  return Array.isArray(param) ? param[0] : param;
};

const formatDate = (value: any): string => {
  if (!value) return 'TBD';
  if (typeof value === 'string') {
    if (!value.includes('T') || !value.includes('Z')) {
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
    } catch {
      return 'TBD';
    }
  }
  return 'TBD';
};

export default function RegistrationConfirmationScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();

  const trailId = getParam(params.trailId);
  const raceName = getParam(params.raceName, 'Race');
  const distance = getParam(params.distance, 'Unknown');
  const location = getParam(params.location, 'Unknown Location');
  const date = formatDate(getParam(params.date, ''));
  const priceValue = parseFloat(getParam(params.price, '0'));
  const price = Number.isFinite(priceValue) && priceValue > 0 ? `$${priceValue.toFixed(2)}` : 'Free';
  const bibNumberParam = getParam(params.bibNumber, '');
  const shirtSizeParam = getParam(params.shirtSize, '');
  const startTimeParam = getParam(params.startTime, '');
  const simpleRegistrationId = getParam(params.simpleRegistrationId, '');
  const [bibNumber, setBibNumber] = useState(bibNumberParam);
  const [shirtSize, setShirtSize] = useState(shirtSizeParam);
  const [startTime, setStartTime] = useState(startTimeParam);

  useEffect(() => {
    if ((bibNumberParam && shirtSizeParam) || !simpleRegistrationId) return;
    const fetchBibNumber = async () => {
      try {
        const regSnap = await getDoc(doc(db, 'registrations', simpleRegistrationId));
        if (regSnap.exists()) {
          const data = regSnap.data();
          if (data?.bibNumber) {
            setBibNumber(String(data.bibNumber));
          }
          if (data?.shirtSize) {
            setShirtSize(String(data.shirtSize));
          }
        }
      } catch (error) {
        console.error('Failed to load bib number:', error);
      }
    };
    fetchBibNumber();
  }, [bibNumberParam, shirtSizeParam, simpleRegistrationId]);

  useEffect(() => {
    if (startTimeParam || !trailId) return;
    const fetchStartTime = async () => {
      try {
        const raceSnap = await getDoc(doc(db, 'trails', trailId));
        if (raceSnap.exists()) {
          const data = raceSnap.data();
          const resolvedStartTime =
            data?.startTime || data?.start_time || data?.start || '';
          if (resolvedStartTime) {
            setStartTime(String(resolvedStartTime));
          }
        }
      } catch (error) {
        console.error('Failed to load start time:', error);
      }
    };
    fetchStartTime();
  }, [startTimeParam, trailId]);

  return (
    <SafeAreaView className="flex-1 bg-[#1A1F25]" edges={['top', 'left', 'right']}>
      <ScrollView contentContainerStyle={{ padding: 24 }}>
        <View className="bg-emerald-500/20 rounded-3xl p-6 mb-6">
          <Text className="text-emerald-400 text-3xl font-bold mb-2">Congratulations</Text>
          <Text className="text-white text-base">
            Congratulations on registering for the race. We wish you the best of luck and have a blast!
          </Text>
        </View>

        <View className="bg-[#2C3440] rounded-3xl p-6 mb-6">
          <Text className="text-white text-2xl font-bold mb-2">{raceName}</Text>
          <Text className="text-emerald-400 text-base mb-4">{distance}</Text>
          <View className="mb-3">
            <Text className="text-gray-400 text-xs uppercase mb-1">Date</Text>
            <Text className="text-white text-base">{date}</Text>
          </View>
          <View className="mb-3">
            <Text className="text-gray-400 text-xs uppercase mb-1">Location</Text>
            <Text className="text-white text-base">{location}</Text>
          </View>
          <View className="mb-3">
            <Text className="text-gray-400 text-xs uppercase mb-1">Entry</Text>
            <Text className="text-white text-base">{price}</Text>
          </View>
          {startTime ? (
            <View className="mb-3">
              <Text className="text-gray-400 text-xs uppercase mb-1">Start Time</Text>
              <Text className="text-white text-base">{startTime}</Text>
            </View>
          ) : null}
          {shirtSize ? (
            <View className="mb-3">
              <Text className="text-gray-400 text-xs uppercase mb-1">Shirt Size</Text>
              <Text className="text-white text-base">{shirtSize}</Text>
            </View>
          ) : null}
          {bibNumber ? (
            <View>
              <Text className="text-gray-400 text-xs uppercase mb-1">Bib Number</Text>
              <Text className="text-white text-base">{bibNumber}</Text>
            </View>
          ) : null}
        </View>

        <TouchableOpacity
          onPress={() => {
            if (!trailId) {
              router.push('/saved-races');
              return;
            }
            router.push({ pathname: '/race-details', params: { id: trailId } });
          }}
          className="bg-emerald-500 rounded-2xl py-4 items-center mb-3"
          activeOpacity={0.85}
        >
          <Text className="text-white text-lg font-bold">View Race Details</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => router.push('/saved-races')}
          className="bg-slate-900 border border-emerald-500 rounded-2xl py-4 items-center mb-3"
          activeOpacity={0.85}
        >
          <Text className="text-emerald-400 text-lg font-bold">View My Races</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => router.back()}
          className="bg-slate-800 rounded-2xl py-4 items-center"
          activeOpacity={0.85}
        >
          <Text className="text-white text-lg font-bold">Close</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}
