import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';

import { TOUCH_TARGET, borderWidth, radii, spacing, typography, useTheme, useThemeFonts } from '../theme';
import { toneColors } from './tones';

export interface ChipProps {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** Pressable filter pill. Selected is the soft tenant color with a tenant border. */
export function Chip({ label, selected = false, onPress, disabled, style }: ChipProps) {
  const { theme } = useTheme();
  const fonts = useThemeFonts();
  const c = theme.colors;
  const t = toneColors(theme, 'theme');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected, disabled }}
      onPress={onPress}
      disabled={disabled}
      hitSlop={(TOUCH_TARGET - spacing[8]) / 2}
      style={[
        styles.chip,
        {
          borderRadius: radii.full,
          borderColor: selected ? t.line : c.border,
          backgroundColor: selected ? t.soft : 'transparent',
        },
        disabled && styles.disabled,
        style,
      ]}
    >
      <Text style={[styles.label, fonts.bodyMedium, { color: selected ? t.ink : c.textPrimary }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    minHeight: spacing[8],
    paddingHorizontal: spacing[3],
    borderWidth: borderWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { fontSize: typography.size.sm },
  disabled: { opacity: 0.5 },
});
