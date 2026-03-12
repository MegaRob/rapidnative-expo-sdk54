import React, { forwardRef, useCallback, useRef } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { Route } from 'lucide-react-native';
import StandardBottomSheet, { StandardBottomSheetHandle } from './StandardBottomSheet';

export interface DistanceOption {
  label: string;
  price?: number;
  startTime?: string;
  elevationGain?: string;
}

/* ── Public handle exposed via ref ──────────────────────────────────── */
export interface DistancePickerModalHandle {
  present: () => void;
  close: () => void;
}

interface DistancePickerModalProps {
  onClose?: () => void;
  onSelect: (distance: DistanceOption) => void;
  distances: DistanceOption[];
  raceName: string;
}

const DistancePickerModal = forwardRef<DistancePickerModalHandle, DistancePickerModalProps>(
  ({ onClose, onSelect, distances, raceName }, ref) => {
    const sheetRef = useRef<StandardBottomSheetHandle>(null);

    // Expose present / close to parent via ref
    React.useImperativeHandle(ref, () => ({
      present: () => {
        sheetRef.current?.present();
      },
      close: () => {
        sheetRef.current?.close();
      },
    }));

    const handleClose = useCallback(() => {
      onClose?.();
    }, [onClose]);

    const handleSelect = (d: DistanceOption) => {
      onSelect(d);
      sheetRef.current?.close();
    };

    return (
      <StandardBottomSheet
        ref={sheetRef}
        title="Select a Distance"
        snapPoints={['45%', '75%']}
        onClose={handleClose}
      >
        <Text style={{ color: '#94A3B8', fontSize: 14, marginBottom: 20 }}>{raceName}</Text>

        {/* Distance Options */}
        {distances.map((d, i) => {
          const price = typeof d.price === 'number' && d.price > 0 ? d.price : null;
          return (
            <TouchableOpacity
              key={i}
              onPress={() => handleSelect(d)}
              style={{
                backgroundColor: '#0F172A',
                borderRadius: 16,
                padding: 16,
                marginBottom: 12,
                borderWidth: 1,
                borderColor: '#334155',
              }}
              activeOpacity={0.7}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                  <View
                    style={{
                      backgroundColor: 'rgba(16, 185, 129, 0.2)',
                      borderRadius: 20,
                      padding: 8,
                      marginRight: 12,
                    }}
                  >
                    <Route size={20} color="#10b981" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: '#FFFFFF', fontSize: 18, fontWeight: '700' }}>{d.label}</Text>
                    {(d.elevationGain || d.startTime) && (
                      <Text style={{ color: '#94A3B8', fontSize: 12, marginTop: 2 }}>
                        {[d.elevationGain ? `${d.elevationGain} gain` : '', d.startTime ? `Starts ${d.startTime}` : '']
                          .filter(Boolean)
                          .join(' · ')}
                      </Text>
                    )}
                  </View>
                </View>
                {price !== null && (
                  <Text style={{ color: '#34D399', fontSize: 18, fontWeight: '700', marginLeft: 12 }}>
                    ${price.toFixed(2)}
                  </Text>
                )}
              </View>
            </TouchableOpacity>
          );
        })}
      </StandardBottomSheet>
    );
  }
);

DistancePickerModal.displayName = 'DistancePickerModal';
export default DistancePickerModal;
