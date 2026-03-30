import React from 'react';
import { KeyboardAvoidingView, Platform, StyleProp, ViewStyle } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';

interface KeyboardScreenProps {
  children: React.ReactNode;
  /** Style applied to the outer wrapper (the scroll view or KeyboardAvoidingView). */
  style?: StyleProp<ViewStyle>;
  /** Style applied to the scroll-view content container. Defaults to `{ flexGrow: 1 }`. */
  contentContainerStyle?: StyleProp<ViewStyle>;
  /**
   * Set `true` when the children contain a VirtualizedList (FlatList / SectionList).
   * Uses a plain `KeyboardAvoidingView` instead of a scroll wrapper to avoid
   * the "VirtualizedLists should never be nested inside plain ScrollViews" warning.
   */
  isList?: boolean;
}

/**
 * App-wide keyboard-safe wrapper.
 *
 * • **Form screens** (`isList` omitted / `false`):
 *   Wraps children in a `KeyboardAwareScrollView` that auto-scrolls focused
 *   inputs into view on both platforms.
 *
 * • **List screens** (`isList={true}`):
 *   Wraps children in a `KeyboardAvoidingView` so the layout resizes without
 *   triggering nested-scroll warnings.
 */
export default function KeyboardScreen({
  children,
  style,
  contentContainerStyle,
  isList = false,
}: KeyboardScreenProps) {
  if (isList) {
    return (
      <KeyboardAvoidingView
        style={[{ flex: 1 }, style]}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 100 : 30}
      >
        {children}
      </KeyboardAvoidingView>
    );
  }

  return (
    <KeyboardAwareScrollView
      style={[{ flex: 1 }, style]}
      contentContainerStyle={[{ flexGrow: 1 }, contentContainerStyle]}
      extraKeyboardSpace={30}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      bottomOffset={40}
    >
      {children}
    </KeyboardAwareScrollView>
  );
}
