import React, { useEffect, useRef } from 'react';
import { Animated, View, StyleSheet } from 'react-native';

interface ConfettiPieceProps {
  delay: number;
  color: string;
  left: number;
}

const ConfettiPiece = ({ delay, color, left }: ConfettiPieceProps) => {
  const translateY = useRef(new Animated.Value(-50)).current;
  const rotate = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(translateY, {
        toValue: 1000,
        duration: 3000 + delay * 100,
        useNativeDriver: true,
      }),
      Animated.timing(rotate, {
        toValue: 360,
        duration: 2000,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 0,
        duration: 3000,
        delay: 2000,
        useNativeDriver: true,
      }),
    ]).start();
  }, [delay, translateY, rotate, opacity]);

  return (
    <Animated.View
      style={[
        styles.piece,
        {
          left,
          backgroundColor: color,
          transform: [
            { translateY },
            { rotate: rotate.interpolate({
              inputRange: [0, 360],
              outputRange: ['0deg', '360deg'],
            })},
          ],
          opacity,
        },
      ]}
    />
  );
};

export default function ConfettiEffect() {
  const colors = ['#10b981', '#8BC34A', '#FFD700', '#FF6B6B', '#4ECDC4', '#FFE66D'];
  const pieces = Array.from({ length: 50 }, (_, i) => ({
    id: i,
    delay: Math.random() * 1000,
    color: colors[Math.floor(Math.random() * colors.length)],
    left: Math.random() * 100,
  }));

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {pieces.map((piece) => (
        <ConfettiPiece
          key={piece.id}
          delay={piece.delay}
          color={piece.color}
          left={piece.left}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  piece: {
    position: 'absolute',
    width: 10,
    height: 10,
    borderRadius: 2,
  },
});






