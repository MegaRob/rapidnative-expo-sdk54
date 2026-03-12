import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from 'react';
import { Keyboard, Platform, Text, TouchableOpacity, View } from 'react-native';
import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetScrollView,
} from '@gorhom/bottom-sheet';
import type {
  BottomSheetBackdropProps,
  BottomSheetFooterProps,
} from '@gorhom/bottom-sheet';
import { Easing } from 'react-native-reanimated';
import { X } from 'lucide-react-native';

/* ── Public handle exposed via ref ──────────────────────────────────── */
export interface StandardBottomSheetHandle {
  /** Snap the sheet to the first snap-point (open). */
  present: () => void;
  /** Dismiss the sheet. */
  close: () => void;
  /** Expand the sheet to the top (highest) snap-point. */
  expand: () => void;
}

/* ── Props ──────────────────────────────────────────────────────────── */
export interface StandardBottomSheetProps {
  children: React.ReactNode;
  /** Optional title rendered in the sheet header. */
  title?: string;
  /** Snap-point array, e.g. `['50%', '90%']`. Defaults to `['50%', '90%']`. */
  snapPoints?: (string | number)[];
  /** Called every time the sheet is fully dismissed. */
  onClose?: () => void;
  /** Called when the sheet index changes. */
  onChange?: (index: number) => void;
  /** Whether the sheet should close when the backdrop is pressed. Default `true`. */
  closeOnBackdropPress?: boolean;
  /** Whether to enable swipe-down-to-close. Default `true`. */
  enablePanDownToClose?: boolean;
  /**
   * Sticky footer pinned to the bottom of the sheet (above safe area).
   * Use `BottomSheetFooter` from `@gorhom/bottom-sheet` inside your render function.
   */
  footerComponent?: React.FC<BottomSheetFooterProps>;
}

/**
 * Premium bottom-sheet wrapper built on `@gorhom/bottom-sheet` v5
 * (`BottomSheetModal` flavour — requires `<BottomSheetModalProvider>` in the tree).
 *
 * Usage:
 * ```tsx
 * const sheetRef = useRef<StandardBottomSheetHandle>(null);
 *
 * <StandardBottomSheet ref={sheetRef} title="My Sheet">
 *   <BottomSheetTextInput … />
 * </StandardBottomSheet>
 *
 * sheetRef.current?.present();
 * ```
 */
const StandardBottomSheet = forwardRef<
  StandardBottomSheetHandle,
  StandardBottomSheetProps
>(
  (
    {
      children,
      title,
      snapPoints: snapPointsProp,
      onClose,
      onChange,
      closeOnBackdropPress = true,
      enablePanDownToClose = true,
      footerComponent,
    },
    ref
  ) => {
    const bottomSheetRef = useRef<BottomSheetModal>(null);
    const snapPoints = useMemo(
      () => snapPointsProp ?? ['50%', '90%'],
      [snapPointsProp]
    );

    /* ── Animation config — fast, premium "weighty" ease ───────────── */
    const animationConfigs = useMemo(
      () => ({
        duration: 250,
        easing: Easing.out(Easing.exp),
      }),
      []
    );

    /* ── Track whether the sheet is currently open ────────────────── */
    const currentIndex = useRef(-1);

    /* ── Imperative handle ─────────────────────────────────────────── */
    useImperativeHandle(ref, () => ({
      present: () => bottomSheetRef.current?.present(),
      close: () => bottomSheetRef.current?.dismiss(),
      expand: () => bottomSheetRef.current?.snapToIndex(snapPoints.length - 1),
    }));

    /* ── Keyboard auto-snap: jump to top snap when keyboard shows ── */
    useEffect(() => {
      const showEvent =
        Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
      const topIndex = snapPoints.length - 1;
      const sub = Keyboard.addListener(showEvent, () => {
        // Only snap if the sheet is open AND not already at the top snap point
        if (currentIndex.current >= 0 && currentIndex.current < topIndex) {
          bottomSheetRef.current?.snapToIndex(topIndex);
        }
      });
      return () => sub.remove();
    }, [snapPoints]);

    /* ── Callbacks ─────────────────────────────────────────────────── */
    const handleDismiss = useCallback(() => {
      currentIndex.current = -1;
      onClose?.();
    }, [onClose]);

    const handleChange = useCallback(
      (index: number) => {
        currentIndex.current = index;
        onChange?.(index);
      },
      [onChange]
    );

    /* ── Backdrop ──────────────────────────────────────────────────── */
    const renderBackdrop = useCallback(
      (props: BottomSheetBackdropProps) => (
        <BottomSheetBackdrop
          {...props}
          appearsOnIndex={0}
          disappearsOnIndex={-1}
          opacity={0.7}
          pressBehavior={closeOnBackdropPress ? 'close' : 'none'}
        />
      ),
      [closeOnBackdropPress]
    );

    /* ── Render ────────────────────────────────────────────────────── */
    return (
      <BottomSheetModal
        ref={bottomSheetRef}
        snapPoints={snapPoints}
        animationConfigs={animationConfigs}
        detached={false}
        bottomInset={0}
        onDismiss={handleDismiss}
        onChange={handleChange}
        enablePanDownToClose={enablePanDownToClose}
        keyboardBehavior="fillParent"
        keyboardBlurBehavior="restore"
        android_keyboardInputMode="adjustResize"
        backdropComponent={renderBackdrop}
        footerComponent={footerComponent}
        backgroundStyle={{
          backgroundColor: '#1E293B',
          borderTopLeftRadius: 24,
          borderTopRightRadius: 24,
        }}
        handleIndicatorStyle={{
          backgroundColor: '#475569',
          width: 40,
        }}
      >
        <BottomSheetScrollView
          contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 40 }}
          keyboardShouldPersistTaps="handled"
        >
          {/* ── Header ──────────────────────────────────────────────── */}
          {title ? (
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
                paddingTop: 8,
                paddingBottom: 20,
              }}
            >
              <Text
                style={{
                  color: '#FFFFFF',
                  fontSize: 20,
                  fontWeight: '800',
                }}
              >
                {title}
              </Text>
              <TouchableOpacity
                onPress={() => bottomSheetRef.current?.dismiss()}
                hitSlop={12}
              >
                <X color="#94A3B8" size={24} />
              </TouchableOpacity>
            </View>
          ) : null}

          {/* ── Content ─────────────────────────────────────────────── */}
          {children}
        </BottomSheetScrollView>
      </BottomSheetModal>
    );
  }
);

StandardBottomSheet.displayName = 'StandardBottomSheet';
export default StandardBottomSheet;
