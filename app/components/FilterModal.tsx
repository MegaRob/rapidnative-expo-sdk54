import React, { forwardRef, useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, Pressable } from 'react-native';
import { BottomSheetFooter } from '@gorhom/bottom-sheet';
import type { BottomSheetFooterProps } from '@gorhom/bottom-sheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MapPin, Navigation, Calendar, ChevronLeft, ChevronRight } from 'lucide-react-native';
import StandardBottomSheet, { StandardBottomSheetHandle } from './StandardBottomSheet';

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

/* ── Public handle exposed via ref ──────────────────────────────────── */
export interface FilterModalHandle {
  present: () => void;
  close: () => void;
}

interface FilterModalProps {
  filters: RaceFilters;
  onClose?: () => void;
  onApply: (filters: RaceFilters) => void;
  onReset?: () => void;
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

const FilterModal = forwardRef<FilterModalHandle, FilterModalProps>(
  (
    {
      filters,
      onClose,
      onApply,
      onReset,
      gpsStatus = 'unavailable',
      gpsLocationName,
    },
    ref
  ) => {
    const sheetRef = useRef<StandardBottomSheetHandle>(null);
    const [localFilters, setLocalFilters] = useState<RaceFilters>(filters);
    const [isOpen, setIsOpen] = useState(false);

    // Expose present / close to parent via ref
    React.useImperativeHandle(ref, () => ({
      present: () => {
        setIsOpen(true);
        sheetRef.current?.present();
      },
      close: () => {
        sheetRef.current?.close();
      },
    }));

    // Sync local filters with props when sheet opens
    useEffect(() => {
      if (isOpen) {
        setLocalFilters(filters);
      }
    }, [isOpen, filters]);

    const handleApply = useCallback(() => {
      onApply(localFilters);
      sheetRef.current?.close();
    }, [localFilters, onApply]);

    const handleReset = useCallback(() => {
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
      onReset?.();
      sheetRef.current?.close();
    }, [onReset]);

    const handleClose = useCallback(() => {
      setIsOpen(false);
      onClose?.();
    }, [onClose]);

    const hasActiveFilters =
      localFilters.radius !== 0 ||
      localFilters.distance !== 'All' ||
      localFilters.difficulty !== 'All' ||
      localFilters.elevation !== 'All' ||
      localFilters.dateFrom !== null ||
      localFilters.dateTo !== null;

    const gpsAvailable = gpsStatus === 'active';
    const radiusSelected = localFilters.radius > 0;

    // Date picker state
    const [showDatePicker, setShowDatePicker] = useState<'from' | 'to' | null>(null);
    const [pickerYear, setPickerYear] = useState(() => new Date().getFullYear());
    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    const formatDateLabel = (date: Date | null): string => {
      if (!date) return 'Any';
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    };

    const insets = useSafeAreaInsets();

    /* ── Sticky footer: Apply & Reset buttons pinned to the bottom ─── */
    const renderFooter = useCallback(
      (props: BottomSheetFooterProps) => (
        <BottomSheetFooter {...props} bottomInset={insets.bottom}>
          <View
            style={{
              flexDirection: 'row',
              gap: 12,
              paddingHorizontal: 24,
              paddingTop: 12,
              paddingBottom: 16,
              backgroundColor: '#1E293B',
              borderTopWidth: 1,
              borderTopColor: '#334155',
            }}
          >
            <Pressable
              onPress={handleReset}
              style={{
                flex: 1,
                backgroundColor: '#0F172A',
                paddingVertical: 16,
                borderRadius: 12,
                alignItems: 'center',
              }}
            >
              <Text style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '600' }}>Reset</Text>
            </Pressable>
            <Pressable
              onPress={handleApply}
              style={{
                flex: 1,
                paddingVertical: 16,
                borderRadius: 12,
                alignItems: 'center',
                backgroundColor: hasActiveFilters ? '#10B981' : '#334155',
              }}
            >
              <Text style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '700' }}>
                Apply Filters
              </Text>
            </Pressable>
          </View>
        </BottomSheetFooter>
      ),
      [handleApply, handleReset, hasActiveFilters, insets.bottom]
    );

    const handleMonthSelect = (monthIndex: number) => {
      if (!showDatePicker) return;
      let selected: Date;
      if (showDatePicker === 'from') {
        selected = new Date(pickerYear, monthIndex, 1);
      } else {
        selected = new Date(pickerYear, monthIndex + 1, 0);
      }

      if (showDatePicker === 'from' && localFilters.dateTo && selected > localFilters.dateTo) {
        setLocalFilters({ ...localFilters, dateFrom: selected, dateTo: null });
      } else if (showDatePicker === 'to' && localFilters.dateFrom && selected < localFilters.dateFrom) {
        return;
      } else {
        setLocalFilters({ ...localFilters, [showDatePicker === 'from' ? 'dateFrom' : 'dateTo']: selected });
      }
      setShowDatePicker(null);
    };

    return (
      <StandardBottomSheet
        ref={sheetRef}
        title="Filter Races"
        snapPoints={['50%', '90%']}
        onClose={handleClose}
        footerComponent={renderFooter}
      >
        {/* Search Radius Filter */}
        <View style={{ marginBottom: 24 }}>
          <Text style={{ color: '#FFFFFF', fontSize: 18, fontWeight: '600', marginBottom: 8 }}>
            Search Radius
          </Text>

          {/* GPS Status Indicator */}
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12, paddingHorizontal: 4 }}>
            {gpsStatus === 'active' && (
              <>
                <Navigation size={14} color="#34D399" />
                <Text style={{ color: '#34D399', fontSize: 12, marginLeft: 6, fontWeight: '500' }}>
                  GPS Active{gpsLocationName ? ` · ${gpsLocationName}` : ''}
                </Text>
              </>
            )}
            {gpsStatus === 'loading' && (
              <>
                <Navigation size={14} color="#9CA3AF" />
                <Text style={{ color: '#9CA3AF', fontSize: 12, marginLeft: 6 }}>Getting your location...</Text>
              </>
            )}
            {gpsStatus === 'denied' && (
              <>
                <MapPin size={14} color="#F87171" />
                <Text style={{ color: '#F87171', fontSize: 12, marginLeft: 6 }}>Location access denied — enable in Settings</Text>
              </>
            )}
            {gpsStatus === 'unavailable' && (
              <>
                <MapPin size={14} color="#9CA3AF" />
                <Text style={{ color: '#9CA3AF', fontSize: 12, marginLeft: 6 }}>Location unavailable</Text>
              </>
            )}
          </View>

          {/* Radius not functional without GPS */}
          {!gpsAvailable && radiusSelected && (
            <View style={{ backgroundColor: 'rgba(120, 53, 15, 0.3)', borderWidth: 1, borderColor: 'rgba(146, 64, 14, 0.5)', borderRadius: 8, padding: 12, marginBottom: 12 }}>
              <Text style={{ color: '#FCD34D', fontSize: 12 }}>
                Radius filtering requires GPS access. Enable location services to use this filter.
              </Text>
            </View>
          )}

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
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
                  style={{
                    paddingHorizontal: 16,
                    paddingVertical: 10,
                    borderRadius: 20,
                    backgroundColor: isSelected ? '#10B981' : isDisabled ? 'rgba(30, 41, 59, 0.5)' : '#1E293B',
                    opacity: isDisabled ? 0.4 : 1,
                  }}
                >
                  <Text
                    style={{
                      fontSize: 14,
                      fontWeight: '600',
                      color: isSelected ? '#FFFFFF' : isDisabled ? '#6B7280' : '#D1D5DB',
                    }}
                  >
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* Distance Filter */}
        <View style={{ marginBottom: 24 }}>
          <Text style={{ color: '#FFFFFF', fontSize: 18, fontWeight: '600', marginBottom: 12 }}>Distance</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {DISTANCE_OPTIONS.map((option) => (
              <Pressable
                key={option}
                onPress={() => setLocalFilters({ ...localFilters, distance: option })}
                style={{
                  paddingHorizontal: 16,
                  paddingVertical: 8,
                  borderRadius: 20,
                  backgroundColor: localFilters.distance === option ? '#10B981' : '#1E293B',
                }}
              >
                <Text
                  style={{
                    fontSize: 14,
                    fontWeight: '600',
                    color: localFilters.distance === option ? '#FFFFFF' : '#D1D5DB',
                  }}
                >
                  {option}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Difficulty Filter */}
        <View style={{ marginBottom: 24 }}>
          <Text style={{ color: '#FFFFFF', fontSize: 18, fontWeight: '600', marginBottom: 12 }}>Difficulty</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {DIFFICULTY_OPTIONS.map((option) => (
              <Pressable
                key={option}
                onPress={() => setLocalFilters({ ...localFilters, difficulty: option })}
                style={{
                  paddingHorizontal: 16,
                  paddingVertical: 8,
                  borderRadius: 20,
                  backgroundColor: localFilters.difficulty === option ? '#10B981' : '#1E293B',
                }}
              >
                <Text
                  style={{
                    fontSize: 14,
                    fontWeight: '600',
                    color: localFilters.difficulty === option ? '#FFFFFF' : '#D1D5DB',
                  }}
                >
                  {option}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Elevation Filter */}
        <View style={{ marginBottom: 24 }}>
          <Text style={{ color: '#FFFFFF', fontSize: 18, fontWeight: '600', marginBottom: 12 }}>Elevation Gain</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {ELEVATION_OPTIONS.map((option) => (
              <Pressable
                key={option}
                onPress={() => setLocalFilters({ ...localFilters, elevation: option })}
                style={{
                  paddingHorizontal: 16,
                  paddingVertical: 8,
                  borderRadius: 20,
                  backgroundColor: localFilters.elevation === option ? '#10B981' : '#1E293B',
                }}
              >
                <Text
                  style={{
                    fontSize: 14,
                    fontWeight: '600',
                    color: localFilters.elevation === option ? '#FFFFFF' : '#D1D5DB',
                  }}
                >
                  {option}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Date Range Filter */}
        <View style={{ marginBottom: 24 }}>
          <Text style={{ color: '#FFFFFF', fontSize: 18, fontWeight: '600', marginBottom: 12 }}>Race Dates</Text>
          <View style={{ flexDirection: 'row', gap: 12, marginBottom: 12 }}>
            {/* From button */}
            <Pressable
              onPress={() => {
                setPickerYear(localFilters.dateFrom?.getFullYear() ?? new Date().getFullYear());
                setShowDatePicker(showDatePicker === 'from' ? null : 'from');
              }}
              style={{
                flex: 1,
                flexDirection: 'row',
                alignItems: 'center',
                paddingHorizontal: 16,
                paddingVertical: 12,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: showDatePicker === 'from' ? '#10B981' : localFilters.dateFrom ? 'rgba(16, 185, 129, 0.5)' : '#334155',
                backgroundColor: showDatePicker === 'from' ? 'rgba(16, 185, 129, 0.1)' : '#1E293B',
              }}
            >
              <Calendar size={16} color={localFilters.dateFrom ? '#34D399' : '#9CA3AF'} />
              <View style={{ marginLeft: 8, flex: 1 }}>
                <Text style={{ color: '#9CA3AF', fontSize: 12 }}>From</Text>
                <Text style={{ fontSize: 14, fontWeight: '600', color: localFilters.dateFrom ? '#FFFFFF' : '#6B7280' }}>
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
              style={{
                flex: 1,
                flexDirection: 'row',
                alignItems: 'center',
                paddingHorizontal: 16,
                paddingVertical: 12,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: showDatePicker === 'to' ? '#10B981' : localFilters.dateTo ? 'rgba(16, 185, 129, 0.5)' : '#334155',
                backgroundColor: showDatePicker === 'to' ? 'rgba(16, 185, 129, 0.1)' : '#1E293B',
              }}
            >
              <Calendar size={16} color={localFilters.dateTo ? '#34D399' : '#9CA3AF'} />
              <View style={{ marginLeft: 8, flex: 1 }}>
                <Text style={{ color: '#9CA3AF', fontSize: 12 }}>To</Text>
                <Text style={{ fontSize: 14, fontWeight: '600', color: localFilters.dateTo ? '#FFFFFF' : '#6B7280' }}>
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
              style={{ alignSelf: 'flex-start', marginBottom: 12 }}
            >
              <Text style={{ color: '#34D399', fontSize: 12, fontWeight: '500' }}>Clear dates</Text>
            </Pressable>
          )}

          {/* Month/Year picker inline */}
          {showDatePicker && (
            <View style={{ backgroundColor: '#0F172A', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: '#334155' }}>
              {/* Year navigation */}
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <Pressable
                  onPress={() => setPickerYear((prev) => prev - 1)}
                  style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20, backgroundColor: '#1E293B' }}
                  hitSlop={8}
                >
                  <ChevronLeft size={20} color="#fff" />
                </Pressable>
                <Text style={{ color: '#FFFFFF', fontSize: 18, fontWeight: '700' }}>{pickerYear}</Text>
                <Pressable
                  onPress={() => setPickerYear((prev) => prev + 1)}
                  style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20, backgroundColor: '#1E293B' }}
                  hitSlop={8}
                >
                  <ChevronRight size={20} color="#fff" />
                </Pressable>
              </View>

              {/* Month grid (3 x 4) */}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                {MONTHS.map((month, index) => {
                  const now = new Date();
                  const monthDate =
                    showDatePicker === 'from'
                      ? new Date(pickerYear, index, 1)
                      : new Date(pickerYear, index + 1, 0);
                  const isPast =
                    showDatePicker === 'from'
                      ? new Date(pickerYear, index + 1, 0) < new Date(now.getFullYear(), now.getMonth(), 1)
                      : monthDate < new Date(now.getFullYear(), now.getMonth(), 1);
                  const isBelowFrom =
                    showDatePicker === 'to' && localFilters.dateFrom
                      ? monthDate < localFilters.dateFrom
                      : false;
                  const isDisabled = isPast || isBelowFrom;

                  const isSelected =
                    (showDatePicker === 'from' &&
                      localFilters.dateFrom &&
                      localFilters.dateFrom.getMonth() === index &&
                      localFilters.dateFrom.getFullYear() === pickerYear) ||
                    (showDatePicker === 'to' &&
                      localFilters.dateTo &&
                      localFilters.dateTo.getMonth() === index &&
                      localFilters.dateTo.getFullYear() === pickerYear);

                  return (
                    <Pressable
                      key={month}
                      onPress={() => !isDisabled && handleMonthSelect(index)}
                      style={{ width: '25%', padding: 4 }}
                    >
                      <View
                        style={{
                          alignItems: 'center',
                          paddingVertical: 10,
                          borderRadius: 12,
                          backgroundColor: isSelected ? '#10B981' : isDisabled ? 'rgba(30, 41, 59, 0.3)' : '#1E293B',
                          opacity: isDisabled ? 0.35 : 1,
                        }}
                      >
                        <Text
                          style={{
                            fontSize: 14,
                            fontWeight: '600',
                            color: isSelected ? '#FFFFFF' : isDisabled ? '#4B5563' : '#D1D5DB',
                          }}
                        >
                          {month}
                        </Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>

              {/* Selecting label */}
              <Text style={{ color: '#6B7280', fontSize: 12, textAlign: 'center', marginTop: 12 }}>
                Selecting {showDatePicker === 'from' ? 'start' : 'end'} date
              </Text>
            </View>
          )}
        </View>

        {/* Extra bottom padding so scrollable content doesn't hide behind the sticky footer */}
        <View style={{ height: 80 }} />
      </StandardBottomSheet>
    );
  }
);

FilterModal.displayName = 'FilterModal';
export default FilterModal;
