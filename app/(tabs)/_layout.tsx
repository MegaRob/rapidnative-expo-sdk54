import { Tabs } from 'expo-router';
import React from 'react';
import { View } from 'react-native';

/**
 * Tab bar is hidden (display: 'none'). Full-screen routes like /chat sit above this
 * and do not need to subtract a tab bar height from GiftedChat bottomOffset.
 * If you show the tab bar again, use useBottomTabBarHeight() in chat and subtract from bottomOffset.
 *
 * Unread chat badge (red dot on MessageCircle): home screen header in (tabs)/index.tsx
 * via useCurrentUserProfile().hasUnreadMessages — not a tab icon while the bar is hidden.
 */
export default function TabLayout() {
  return (
    <View style={{ flex: 1, backgroundColor: '#1A1F25' }}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarStyle: { display: 'none' },
        }}>
        <Tabs.Screen
          name="index"
          options={{
            title: 'Home',
            tabBarButton: () => null,
          }}
        />
        <Tabs.Screen
          name="community"
          options={{
            title: 'Community',
            tabBarButton: () => null,
          }}
        />
      </Tabs>
    </View>
  );
}
