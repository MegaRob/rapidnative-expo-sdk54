import React, { useState, useEffect } from 'react';
import { Modal, View, Text, Pressable, ScrollView } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { X, MapPin, Navigation, Calendar, ChevronLeft, ChevronRight } from 'lucide-react-native';

export type DistanceFilter = 'All' | '5K-25K' | '50K' | '100K' | '100M+';
export type DifficultyFilter = 'All' | 'Technical/Skyrunning' | 'Moderate/Mountain' | 'Easy/Fire Road';
export type ElevationFilter = 'All' | '< 2,000ft' | '2,000-5,000ft' | '5,000-10,000ft' | '10,000ft+';
export type RadiusFilter = 25 | 50 | 100 | 250 | 500 | 0; // 0 means Global/No Limit

export interface RaceFilters {
  radius: RadiusFilter;
  distance: DistanceFilter;
  difficulty: DifficultyFilter;
  elevation: ElevationFilter;
  dateFrom: Date | null;
  dateTo: Date | null;
}

interface FilterModalProps {
  visible: boolean;
  filters: RaceFilters;
  onClose: () => void;
  onApply: (filters: RaceFilters) => void;
  onReset: () => void;
  gpsStatus?: 'active' | 'denied' | 'unavailable' | 'loading';
  gpsLocationName?: string;
}

const RADIUS_OPTIONS: { value: RadiusFilter; label: string; description: string }[] = [
  { value: 25, label: '25 mi', description: 'Nearby' },
  { value: 50, label: '50 mi', description: 'Local' },
  { value: 100, label: '100 mi', description: 'Regional' },
  { value: 250, label: '250 mi', description: 'Extended' },
  { value: 500, label: '500 mi', description: 'Wide' },
  { value: 0, label: 'Global', description: 'Everywhere' },
];
const DISTANCE_OPTIONS: DistanceFilter[] = ['All', '5K-25K', '50K', '100K', '100M+'];
const DIFFICULTY_OPTIONS: DifficultyFilter[] = ['All', 'Technical/Skyrunning', 'Moderate/Mountain', 'Easy/Fire Road'];
const ELEVATION_OPTIONS: ElevationFilter[] = ['All', '< 2,000ft', '2,000-5,000ft', '5,000-10,000ft', '10,000ft+'];

export default function FilterModal({
  visible,
  filters,
  onClose,
  onApply,
  onReset,
  gpsStatus = 'unavailable',
  gpsLocationName,
}: FilterModalProps) {
  const insets = useSafeAreaInsets();
  const [localFilters, setLocalFilters] = useState<RaceFilters>(filters);

  // Sync local filters with props when modal opens
  useEffect(() => {
    if (visible) {
      setLocalFilters(filters);
    }
  }, [visible, filters]);

  const handleApply = () => {
    onApply(localFilters);
    onClose();
  };

  const handleReset = () => {
    const resetFilters: RaceFilters = {
      radius: 0,
      distance: 'All',
      difficulty: 'All',
      elevation: 'All',
      dateFrom: null,
      dateTo: null,
    };
    setLocalFilters(resetFilters);
    setShowDatePicker(null);
    onReset();
    onClose();
  };

  const hasActiveFilters = 
    localFilters.radius !== 0 ||
    localFilters.distance !== 'All' ||
    localFilters.difficulty !== 'All' ||
    localFilters.elevation !== 'All' ||
    localFilters.dateFrom !== null ||
    localFilters.dateTo !== null;

  const gpsAvailable = gpsStatus === 'active';
  const radiusSelected = localFilters.radius > 0;

  // Date picker state: null = closed, 'from' | 'to' = which picker is open
  const [showDatePicker, setShowDatePicker] = useState<'from' | 'to' | null>(null);
  const [pickerYear, setPickerYear] = useState(() => new Date().getFullYear());
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const formatDateLabel = (date: Date | null): string => {
    if (!date) return 'Any';
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const handleMonthSelect = (monthIndex: number) => {
    if (!showDatePicker) return;
    // Set first day of month for "from", last day for "to"
    let selected: Date;
    if (showDatePicker === 'from') {
      selected = new Date(pickerYear, monthIndex, 1);
    } else {
      // Last day of the selected month
      selected = new Date(pickerYear, monthIndex + 1, 0);
    }

    // Validate: from can't be after to, to can't be before from
    if (showDatePicker === 'from' && localFilters.dateTo && selected > localFilters.dateTo) {
      setLocalFilters({ ...localFilters, dateFrom: selected, dateTo: null });
    } else if (showDatePicker === 'to' && localFilters.dateFrom && selected < localFilters.dateFrom) {
      // Don't allow — do nothing
      return;
    } else {
      setLocalFilters({ ...localFilters, [showDatePicker === 'from' ? 'dateFrom' : 'dateTo']: selected });
    }
    setShowDatePicker(null);
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={false}
      onRequestClose={onClose}
    >
      <View className="flex-1 bg-slate-950" style={{ paddingTop: insets.top }}>
        {/* Header */}
        <View className="flex-row justify-between items-center px-4 py-3 border-b border-slate-800">
          <Text className="text-white text-xl font-bold">Filter Races</Text>
          <Pressable
            onPress={onClose}
            className="w-10 h-10 items-center justify-center rounded-full bg-slate-800"
            hitSlop={12}
          >
            <X size={24} color="#fff" />
          </Pressable>
        </View>

        <ScrollView className="flex-1 p-5">
          {/* Search Radius Filter */}
          <View className="mb-6">
            <Text className="text-white text-lg font-semibold mb-2">Search Radius</Text>

            {/* GPS Status Indicator */}
            <View className="flex-row items-center mb-3 px-1">
              {gpsStatus === 'active' && (
                <>
                  <Navigation size={14} color="#34D399" />
                  <Text className="text-emerald-400 text-xs ml-1.5 font-medium">
                    GPS Active{gpsLocationName ? ` · ${gpsLocationName}` : ''}
                  </Text>
                </>
              )}
              {gpsStatus === 'loading' && (
                <>
                  <Navigation size={14} color="#9CA3AF" />
                  <Text className="text-gray-400 text-xs ml-1.5">Getting your location...</Text>
                </>
              )}
              {gpsStatus === 'denied' && (
                <>
                  <MapPin size={14} color="#F87171" />
                  <Text className="text-red-400 text-xs ml-1.5">Location access denied — enable in Settings</Text>
                </>
              )}
              {gpsStatus === 'unavailable' && (
                <>
                  <MapPin size={14} color="#9CA3AF" />
                  <Text className="text-gray-400 text-xs ml-1.5">Location unavailable</Text>
                </>
              )}
            </View>

            {/* Radius not functional without GPS */}
            {!gpsAvailable && radiusSelected && (
              <View className="bg-amber-900/30 border border-amber-700/50 rounded-lg p-3 mb-3">
                <Text className="text-amber-300 text-xs">
                  Radius filtering requires GPS access. Enable location services to use this filter.
                </Text>
              </View>
            )}

            <View className="flex-row flex-wrap gap-2">
              {RADIUS_OPTIONS.map((option) => {
                const isSelected = localFilters.radius === option.value;
                const isDisabled = option.value !== 0 && !gpsAvailable;
                return (
                  <Pressable
                    key={option.value}
                    onPress={() => {
                      if (!isDisabled) {
                        setLocalFilters({ ...localFilters, radius: option.value });
                      }
                    }}
                    className={`px-4 py-2.5 rounded-full ${
                      isSelected
                        ? 'bg-emerald-500'
                        : isDisabled
                          ? 'bg-slate-800/50'
                          : 'bg-slate-800'
                    }`}
                    style={{ opacity: isDisabled ? 0.4 : 1 }}
                  >
                    <Text
                      className={`text-sm font-semibold ${
                        isSelected ? 'text-white' : isDisabled ? 'text-gray-500' : 'text-gray-300'
                      }`}
                    >
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* Distance Filter */}
          <View className="mb-6">
            <Text className="text-white text-lg font-semibold mb-3">Distance</Text>
            <View className="flex-row flex-wrap gap-2">
              {DISTANCE_OPTIONS.map((option) => (
                <Pressable
                  key={option}
                  onPress={() => setLocalFilters({ ...localFilters, distance: option })}
                  className={`px-4 py-2 rounded-full ${
                    localFilters.distance === option
                      ? 'bg-emerald-500'
                      : 'bg-slate-800'
                  }`}
                >
                  <Text
                    className={`text-sm font-semibold ${
                      localFilters.distance === option ? 'text-white' : 'text-gray-300'
                    }`}
                  >
                    {option}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          {/* Difficulty Filter */}
          <View className="mb-6">
            <Text className="text-white text-lg font-semibold mb-3">Difficulty</Text>
            <View className="flex-row flex-wrap gap-2">
              {DIFFICULTY_OPTIONS.map((option) => (
                <Pressable
                  key={option}
                  onPress={() => setLocalFilters({ ...localFilters, difficulty: option })}
                  className={`px-4 py-2 rounded-full ${
                    localFilters.difficulty === option
                      ? 'bg-emerald-500'
                      : 'bg-slate-800'
                  }`}
                >
                  <Text
                    className={`text-sm font-semibold ${
                      localFilters.difficulty === option ? 'text-white' : 'text-gray-300'
                    }`}
                  >
                    {option}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          {/* Elevation Filter */}
          <View className="mb-6">
            <Text className="text-white text-lg font-semibold mb-3">Elevation Gain</Text>
            <View className="flex-row flex-wrap gap-2">
              {ELEVATION_OPTIONS.map((option) => (
                <Pressable
                  key={option}
                  onPress={() => setLocalFilters({ ...localFilters, elevation: option })}
                  className={`px-4 py-2 rounded-full ${
                    localFilters.elevation === option
                      ? 'bg-emerald-500'
                      : 'bg-slate-800'
                  }`}
                >
                  <Text
                    className={`text-sm font-semibold ${
                      localFilters.elevation === option ? 'text-white' : 'text-gray-300'
                    }`}
                  >
                    {option}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          {/* Date Range Filter */}
          <View className="mb-6">
            <Text className="text-white text-lg font-semibold mb-3">Race Dates</Text>
            <View className="flex-row gap-3 mb-3">
              {/* From button */}
              <Pressable
                onPress={() => {
                  setPickerYear(localFilters.dateFrom?.getFullYear() ?? new Date().getFullYear());
                  setShowDatePicker(showDatePicker === 'from' ? null : 'from');
                }}
                className={`flex-1 flex-row items-center px-4 py-3 rounded-xl border ${
                  showDatePicker === 'from'
                    ? 'border-emerald-500 bg-emerald-500/10'
                    : localFilters.dateFrom
                      ? 'border-emerald-500/50 bg-slate-800'
                      : 'border-slate-700 bg-slate-800'
                }`}
              >
                <Calendar size={16} color={localFilters.dateFrom ? '#34D399' : '#9CA3AF'} />
                <View className="ml-2 flex-1">
                  <Text className="text-gray-400 text-xs">From</Text>
                  <Text className={`text-sm font-semibold ${localFilters.dateFrom ? 'text-white' : 'text-gray-500'}`}>
                    {formatDateLabel(localFilters.dateFrom)}
                  </Text>
                </View>
              </Pressable>

              {/* To button */}
              <Pressable
                onPress={() => {
                  setPickerYear(localFilters.dateTo?.getFullYear() ?? localFilters.dateFrom?.getFullYear() ?? new Date().getFullYear());
                  setShowDatePicker(showDatePicker === 'to' ? null : 'to');
                }}
                className={`flex-1 flex-row items-center px-4 py-3 rounded-xl border ${
                  showDatePicker === 'to'
                    ? 'border-emerald-500 bg-emerald-500/10'
                    : localFilters.dateTo
                      ? 'border-emerald-500/50 bg-slate-800'
                      : 'border-slate-700 bg-slate-800'
                }`}
              >
                <Calendar size={16} color={localFilters.dateTo ? '#34D399' : '#9CA3AF'} />
                <View className="ml-2 flex-1">
                  <Text className="text-gray-400 text-xs">To</Text>
                  <Text className={`text-sm font-semibold ${localFilters.dateTo ? 'text-white' : 'text-gray-500'}`}>
                    {formatDateLabel(localFilters.dateTo)}
                  </Text>
                </View>
              </Pressable>
            </View>

            {/* Clear dates button */}
            {(localFilters.dateFrom || localFilters.dateTo) && (
              <Pressable
                onPress={() => {
                  setLocalFilters({ ...localFilters, dateFrom: null, dateTo: null });
                  setShowDatePicker(null);
                }}
                className="self-start mb-3"
              >
                <Text className="text-emerald-400 text-xs font-medium">Clear dates</Text>
              </Pressable>
            )}

            {/* Month/Year picker inline */}
            {showDatePicker && (
              <View className="bg-slate-900 rounded-2xl p-4 border border-slate-700">
                {/* Year navigation */}
                <View className="flex-row items-center justify-between mb-4">
                  <Pressable
                    onPress={() => setPickerYear(prev => prev - 1)}
                    className="w-10 h-10 items-center justify-center rounded-full bg-slate-800"
                    hitSlop={8}
                  >
                    <ChevronLeft size={20} color="#fff" />
                  </Pressable>
                  <Text className="text-white text-lg font-bold">{pickerYear}</Text>
                  <Pressable
                    onPress={() => setPickerYear(prev => prev + 1)}
                    className="w-10 h-10 items-center justify-center rounded-full bg-slate-800"
                    hitSlop={8}
                  >
                    <ChevronRight size={20} color="#fff" />
                  </Pressable>
                </View>

                {/* Month grid (3 x 4) */}
                <View className="flex-row flex-wrap">
                  {MONTHS.map((month, index) => {
                    const now = new Date();
                    const monthDate = showDatePicker === 'from'
                      ? new Date(pickerYear, index, 1)
                      : new Date(pickerYear, index + 1, 0);
                    const isPast = showDatePicker === 'from'
                      ? new Date(pickerYear, index + 1, 0) < new Date(now.getFullYear(), now.getMonth(), 1)
                      : monthDate < new Date(now.getFullYear(), now.getMonth(), 1);
                    const isBelowFrom = showDatePicker === 'to' && localFilters.dateFrom
                      ? monthDate < localFilters.dateFrom
                      : false;
                    const isDisabled = isPast || isBelowFrom;

                    const isSelected =
                      (showDatePicker === 'from' && localFilters.dateFrom &&
                        localFilters.dateFrom.getMonth() === index &&
                        localFilters.dateFrom.getFullYear() === pickerYear) ||
                      (showDatePicker === 'to' && localFilters.dateTo &&
                        localFilters.dateTo.getMonth() === index &&
                        localFilters.dateTo.getFullYear() === pickerYear);

                    return (
                      <Pressable
                        key={month}
                        onPress={() => !isDisabled && handleMonthSelect(index)}
                        className={`w-1/4 p-1`}
                      >
                        <View
                          className={`items-center py-2.5 rounded-xl ${
                            isSelected
                              ? 'bg-emerald-500'
                              : isDisabled
                                ? 'bg-slate-800/30'
                                : 'bg-slate-800'
                          }`}
                          style={isDisabled ? { opacity: 0.35 } : undefined}
                        >
                          <Text
                            className={`text-sm font-semibold ${
                              isSelected ? 'text-white' : isDisabled ? 'text-gray-600' : 'text-gray-300'
                            }`}
                          >
                            {month}
                          </Text>
                        </View>
                      </Pressable>
                    );
                  })}
                </View>

                {/* Selecting label */}
                <Text className="text-gray-500 text-xs text-center mt-3">
                  Selecting {showDatePicker === 'from' ? 'start' : 'end'} date
                </Text>
              </View>
            )}
          </View>
        </ScrollView>

        {/* Footer Buttons */}
        <View className="p-5 border-t border-slate-800">
          <View className="flex-row gap-3">
            <Pressable
              onPress={handleReset}
              className="flex-1 bg-slate-800 py-4 rounded-lg items-center"
            >
              <Text className="text-white text-base font-semibold">Reset</Text>
            </Pressable>
            <Pressable
              onPress={handleApply}
              className={`flex-1 py-4 rounded-lg items-center ${
                hasActiveFilters ? 'bg-emerald-500' : 'bg-slate-700'
              }`}
            >
              <Text className="text-white text-base font-bold">Apply Filters</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
