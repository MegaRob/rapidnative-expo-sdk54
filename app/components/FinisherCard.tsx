import React, { useEffect, useRef } from 'react';
import { Animated, View, Text, Image } from 'react-native';
import { Trophy, Clock, Award, Gauge } from 'lucide-react-native';

interface FinisherCardProps {
  raceName: string;
  raceImageUrl: string;
  finishTime?: string;
  rank?: string;
  pace?: string;
  isPendingVerification?: boolean;
}

export default function FinisherCard({
  raceName,
  raceImageUrl,
  finishTime,
  rank,
  pace,
  isPendingVerification = false,
}: FinisherCardProps) {
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (isPendingVerification) {
      // Create pulsing animation
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 0.7,
            duration: 1000,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 1000,
            useNativeDriver: true,
          }),
        ])
      ).start();
    }
  }, [isPendingVerification, pulseAnim]);

  return (
    <View className="bg-[#2C3440] rounded-2xl p-6 mb-4">
      {/* Trophy Icon - Most Prominent */}
      <View className="items-center mb-4">
        <View className="bg-emerald-500 rounded-full p-4 mb-2">
          <Trophy size={48} color="#1A1F25" fill="#1A1F25" />
        </View>
        <Text className="text-emerald-400 text-lg font-bold">OFFICIAL FINISHER</Text>
      </View>

      {/* Race Image */}
      <View className="mb-4">
        <Image
          source={{ uri: raceImageUrl }}
          className="w-full h-40 rounded-xl"
          resizeMode="cover"
        />
      </View>

      {/* Race Name */}
      <Text className="text-white text-2xl font-bold mb-4 text-center">
        {raceName}
      </Text>

      {/* Stats Grid or Pending Verification */}
      {isPendingVerification ? (
        <Animated.View
          style={{ opacity: pulseAnim }}
          className="bg-slate-800 rounded-xl p-6 items-center"
        >
          <View className="mb-3">
            <Clock size={32} color="#9CA3AF" />
          </View>
          <Text className="text-white text-lg font-semibold mb-2 text-center">
            Results Pending
          </Text>
          <Text className="text-gray-400 text-sm text-center leading-5">
            Great work out there! We are currently waiting for the official race data to be confirmed. Your stats will appear here shortly.
          </Text>
        </Animated.View>
      ) : (
        <View className="bg-slate-800 rounded-xl p-4">
          <View className="flex-row justify-around">
            {finishTime && (
              <View className="items-center flex-1">
                <View className="mb-2">
                  <Clock size={24} color="#10b981" />
                </View>
                <Text className="text-gray-400 text-xs mb-1">Finish Time</Text>
                <Text className="text-white text-lg font-bold">{finishTime}</Text>
              </View>
            )}
            {pace && (
              <View className="items-center flex-1 border-l border-slate-700">
                <View className="mb-2">
                  <Gauge size={24} color="#10b981" />
                </View>
                <Text className="text-gray-400 text-xs mb-1">Pace</Text>
                <Text className="text-white text-lg font-bold">{pace}</Text>
              </View>
            )}
            {rank && (
              <View className="items-center flex-1 border-l border-slate-700">
                <View className="mb-2">
                  <Award size={24} color="#10b981" />
                </View>
                <Text className="text-gray-400 text-xs mb-1">Rank</Text>
                <Text className="text-white text-lg font-bold">{rank}</Text>
              </View>
            )}
          </View>
        </View>
      )}
    </View>
  );
}

