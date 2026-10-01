import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';

import { radii, spacing, typography, useTheme, useThemeFonts } from '../theme';
import { toneColors } from './tones';
import type { Tone } from './tones';

export interface BadgeProps {
  label: string;
  tone?: Tone;
  /** Soft (tinted, default) or solid fill. */
  solid?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** Small status label. Display only; use Chip for something the user can press. */
export function Badge({ label, tone = 'muted', solid, style }: BadgeProps) {
  const { theme } = useTheme();
  const fonts = useThemeFonts();
  const t = toneColors(theme, tone);
  return (
    <View style={[styles.badge, { backgroundColor: solid ? t.main : t.soft, borderRadius: radii.full }, style]}>
      <Text style={[styles.text, fonts.bodyMedium, { color: solid ? t.onMain : t.ink }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { alignSelf: 'flex-start', paddingHorizontal: spacing[2], paddingVertical: spacing[1] / 2 },
  text: { fontSize: typography.size.xs },
});
