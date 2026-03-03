import React from 'react';
import { View } from 'react-native';

export const SkeletonCard = () => {
  return (
    <View className="bg-[#2C3440] rounded-2xl p-4 mb-4">
      <View className="flex-row">
        <View className="w-20 h-20 rounded-xl bg-slate-700 animate-pulse" />
        <View className="flex-1 ml-4">
          <View className="h-5 bg-slate-700 rounded mb-2 w-3/4" />
          <View className="h-4 bg-slate-700 rounded mb-1 w-1/2" />
          <View className="h-4 bg-slate-700 rounded w-2/3" />
        </View>
      </View>
      <View className="mt-3 h-10 bg-slate-700 rounded-lg" />
    </View>
  );
};

export const SkeletonLoader = ({ count = 3 }: { count?: number }) => {
  return (
    <View>
      {Array.from({ length: count }).map((_, index) => (
        <SkeletonCard key={index} />
      ))}
    </View>
  );
};

export default SkeletonLoader;






