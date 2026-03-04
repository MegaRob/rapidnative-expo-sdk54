import { Star } from 'lucide-react-native';
import React from 'react';
import { Text, View } from 'react-native';

interface StarRatingProps {
  rating: number; // 0 - 5 (can be decimal)
  reviewCount?: number;
  size?: number;
  showCount?: boolean;
  starColor?: string;
  emptyColor?: string;
  textColor?: string;
}

export default function StarRating({
  rating,
  reviewCount,
  size = 14,
  showCount = true,
  starColor = '#FBBF24',
  emptyColor = '#475569',
  textColor = '#94A3B8',
}: StarRatingProps) {
  if (!rating || rating <= 0) return null;

  const fullStars = Math.floor(rating);
  const hasHalf = rating - fullStars >= 0.3;
  const emptyStars = 5 - fullStars - (hasHalf ? 1 : 0);

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
      {/* Full stars */}
      {Array.from({ length: fullStars }).map((_, i) => (
        <Star key={`full-${i}`} size={size} color={starColor} fill={starColor} />
      ))}
      {/* Half star (rendered as full for simplicity since lucide doesn't have half-star) */}
      {hasHalf && <Star size={size} color={starColor} fill={starColor} />}
      {/* Empty stars */}
      {Array.from({ length: emptyStars }).map((_, i) => (
        <Star key={`empty-${i}`} size={size} color={emptyColor} fill="transparent" />
      ))}
      {/* Rating number + count */}
      <Text style={{ color: textColor, fontSize: size - 2, marginLeft: 4, fontWeight: '600' }}>
        {rating.toFixed(1)}
      </Text>
      {showCount && reviewCount !== undefined && reviewCount > 0 && (
        <Text style={{ color: textColor, fontSize: size - 3, marginLeft: 2 }}>
          ({reviewCount})
        </Text>
      )}
    </View>
  );
}
