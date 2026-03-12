import React, { useEffect, useRef } from 'react';
import { Animated, Dimensions, View, StyleSheet } from 'react-native';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

interface ConfettiPieceProps {
  delay: number;
  color: string;
  startX: number;
  startY: number;
  horizontalDrift: number;
  size: number;
}

const ConfettiPiece = ({ delay, color, startX, startY, horizontalDrift, size }: ConfettiPieceProps) => {
  const translateY = useRef(new Animated.Value(startY)).current;
  const translateX = useRef(new Animated.Value(0)).current;
  const rotate = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const fallDuration = 2500 + Math.random() * 2000;

    Animated.parallel([
      // Fall down
      Animated.timing(translateY, {
        toValue: SCREEN_HEIGHT + 50,
        duration: fallDuration,
        delay,
        useNativeDriver: true,
      }),
      // Horizontal sway
      Animated.sequence([
        Animated.timing(translateX, {
          toValue: horizontalDrift,
          duration: fallDuration / 2,
          delay,
          useNativeDriver: true,
        }),
        Animated.timing(translateX, {
          toValue: -horizontalDrift * 0.5,
          duration: fallDuration / 2,
          useNativeDriver: true,
        }),
      ]),
      // Spin
      Animated.timing(rotate, {
        toValue: 360 * (Math.random() > 0.5 ? 1 : -1),
        duration: fallDuration,
        delay,
        useNativeDriver: true,
      }),
      // Fade out near bottom
      Animated.timing(opacity, {
        toValue: 0,
        duration: 1000,
        delay: delay + fallDuration - 1000,
        useNativeDriver: true,
      }),
    ]).start();
  }, [delay, translateY, translateX, rotate, opacity, horizontalDrift]);

  return (
    <Animated.View
      style={[
        styles.piece,
        {
          left: startX,
          width: size,
          height: size * (Math.random() > 0.5 ? 1 : 1.8),
          backgroundColor: color,
          borderRadius: size > 8 ? 2 : size / 2,
          transform: [
            { translateY },
            { translateX },
            {
              rotate: rotate.interpolate({
                inputRange: [0, 360],
                outputRange: ['0deg', '360deg'],
              }),
            },
          ],
          opacity,
        },
      ]}
    />
  );
};

export default function ConfettiEffect() {
  const colors = ['#10b981', '#8BC34A', '#FFD700', '#FF6B6B', '#4ECDC4', '#FFE66D', '#A78BFA', '#F472B6'];
  const pieces = Array.from({ length: 80 }, (_, i) => ({
    id: i,
    delay: Math.random() * 800,
    color: colors[Math.floor(Math.random() * colors.length)],
    startX: Math.random() * SCREEN_WIDTH,
    startY: -20 - Math.random() * 100,
    horizontalDrift: (Math.random() - 0.5) * 80,
    size: 6 + Math.random() * 8,
  }));

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {pieces.map((piece) => (
        <ConfettiPiece
          key={piece.id}
          delay={piece.delay}
          color={piece.color}
          startX={piece.startX}
          startY={piece.startY}
          horizontalDrift={piece.horizontalDrift}
          size={piece.size}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  piece: {
    position: 'absolute',
    top: 0,
  },
});
