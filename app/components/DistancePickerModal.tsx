import { Route, X } from 'lucide-react-native';
import React from 'react';
import { Modal, Text, TouchableOpacity, View } from 'react-native';

export interface DistanceOption {
  label: string;
  price?: number;
  startTime?: string;
  elevationGain?: string;
}

interface DistancePickerModalProps {
  visible: boolean;
  onClose: () => void;
  onSelect: (distance: DistanceOption) => void;
  distances: DistanceOption[];
  raceName: string;
}

export default function DistancePickerModal({
  visible,
  onClose,
  onSelect,
  distances,
  raceName,
}: DistancePickerModalProps) {
  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={onClose}
    >
      <View className="flex-1 justify-end bg-black/60">
        <View className="bg-slate-900 rounded-t-3xl px-6 pt-6 pb-10">
          {/* Header */}
          <View className="flex-row justify-between items-center mb-2">
            <Text className="text-white text-xl font-bold flex-1 mr-4" numberOfLines={1}>
              Select a Distance
            </Text>
            <TouchableOpacity onPress={onClose} hitSlop={12}>
              <X size={22} color="#94a3b8" />
            </TouchableOpacity>
          </View>
          <Text className="text-slate-400 text-sm mb-6">{raceName}</Text>

          {/* Distance Options */}
          {distances.map((d, i) => {
            const price = typeof d.price === 'number' && d.price > 0 ? d.price : null;
            return (
              <TouchableOpacity
                key={i}
                onPress={() => onSelect(d)}
                className="bg-slate-800 rounded-2xl p-4 mb-3 border border-slate-700 active:border-emerald-500"
                activeOpacity={0.7}
              >
                <View className="flex-row items-center justify-between">
                  <View className="flex-row items-center flex-1">
                    <View className="bg-emerald-500/20 rounded-full p-2 mr-3">
                      <Route size={20} color="#10b981" />
                    </View>
                    <View className="flex-1">
                      <Text className="text-white text-lg font-bold">{d.label}</Text>
                      {(d.elevationGain || d.startTime) && (
                        <Text className="text-slate-400 text-xs mt-0.5">
                          {[d.elevationGain ? `${d.elevationGain} gain` : '', d.startTime ? `Starts ${d.startTime}` : ''].filter(Boolean).join(' · ')}
                        </Text>
                      )}
                    </View>
                  </View>
                  {price !== null && (
                    <Text className="text-emerald-400 text-lg font-bold ml-3">
                      ${price.toFixed(2)}
                    </Text>
                  )}
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    </Modal>
  );
}
