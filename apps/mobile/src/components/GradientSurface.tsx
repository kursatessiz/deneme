import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';

import type { GradientSlot } from '@platform/shared';

import { useTheme } from '../theme';

interface GradientSurfaceProps {
  /** Gradients may only render in the designated slots. */
  slot: GradientSlot;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
}

/** The tenant's gradient preset, used only in GRADIENT_SLOTS. */
export function GradientSurface({ slot, style, children }: GradientSurfaceProps) {
  const { theme } = useTheme();
  const { stops, angle } = theme.gradient;
  // 135deg: top-left to bottom-right.
  const rad = ((angle - 90) * Math.PI) / 180;
  const start = { x: 0.5 - Math.cos(rad) / 2, y: 0.5 - Math.sin(rad) / 2 };
  const end = { x: 0.5 + Math.cos(rad) / 2, y: 0.5 + Math.sin(rad) / 2 };
  return (
    <LinearGradient
      testID={`gradient-${slot}`}
      colors={stops as unknown as readonly [string, string, ...string[]]}
      start={start}
      end={end}
      style={style}
    >
      {children}
    </LinearGradient>
  );
}
