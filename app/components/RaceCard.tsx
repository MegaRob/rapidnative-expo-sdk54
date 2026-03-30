import React from 'react';
import { Text, Image, TouchableOpacity, Dimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { cssInterop } from 'nativewind';

// Enable className support for LinearGradient
cssInterop(LinearGradient, {
  className: 'style',
});

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface RaceCardProps {
  imageUrl: string;
  name: string;
  slogan: string;
  onPress: () => void;
}

export default function RaceCard({ imageUrl, name, slogan, onPress }: RaceCardProps) {
  return (
    <TouchableOpacity 
      className="w-full rounded-3xl overflow-hidden"
      onPress={onPress}
      activeOpacity={0.9}
    >
      <Image
        source={{ uri: imageUrl }}
        style={{ width: SCREEN_WIDTH - 32, height: 500 }}
        className="w-full"
      />
      
      {/* Text overlays */}
      <LinearGradient
        colors={['transparent', 'rgba(0,0,0,0.9)']}
        className="absolute bottom-0 left-0 right-0 p-6"
      >
        <Text className="text-white text-3xl font-bold mb-2">
          {name}
        </Text>
        <Text className="text-white text-lg">
          {slogan}
        </Text>
      </LinearGradient>
    </TouchableOpacity>
  );
}