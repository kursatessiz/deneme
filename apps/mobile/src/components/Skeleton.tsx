import React, { useEffect, useRef } from 'react';
import { Animated } from 'react-native';
import type { DimensionValue, StyleProp, ViewStyle } from 'react-native';

import { radii, spacing, useTheme } from '../theme';

export interface SkeletonProps {
  width?: DimensionValue;
  height?: number;
  style?: StyleProp<ViewStyle>;
}

/** Pulsing placeholder block shown while data loads. Hidden from screen readers. */
export function Skeleton({ width = '100%', height = spacing[4], style }: SkeletonProps) {
  const { theme } = useTheme();
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.5, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[{ width, height, borderRadius: radii.sm, backgroundColor: theme.colors.surfaceEmphasis, opacity }, style]}
    />
  );
}
