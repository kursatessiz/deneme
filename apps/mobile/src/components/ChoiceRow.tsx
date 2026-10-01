import React from 'react';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { borderWidth, radii, spacing, typography, useTheme, useThemeFonts } from '../theme';

interface ChoiceRowProps {
  label: string;
  description?: string;
  selected: boolean;
  onPress: () => void;
  /** Optional preview drawn on the right. */
  accessory?: ReactNode;
  disabled?: boolean;
}

const RADIO_SIZE = spacing[5];
const DOT_SIZE = spacing[2];

/** Single-choice list row with a radio indicator, >=44pt touch target. */
export function ChoiceRow({ label, description, selected, onPress, accessory, disabled }: ChoiceRowProps) {
  const { theme } = useTheme();
  const fonts = useThemeFonts();
  const c = theme.colors;
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled }}
      accessibilityLabel={label}
      onPress={onPress}
      disabled={disabled}
      style={[styles.row, { borderColor: c.border }]}
    >
      <View style={[styles.radio, { borderColor: selected ? c.primary : c.border }]}>
        {selected ? <View style={[styles.dot, { backgroundColor: c.primary }]} /> : null}
      </View>
      <View style={styles.text}>
        <Text style={[styles.label, fonts.bodyMedium, { color: c.textPrimary }]}>{label}</Text>
        {description ? <Text style={[styles.description, fonts.body, { color: c.textMuted }]}>{description}</Text> : null}
      </View>
      {accessory}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: spacing[12] + spacing[2],
    paddingVertical: spacing[3],
    borderBottomWidth: borderWidth,
    gap: spacing[3],
  },
  radio: {
    width: RADIO_SIZE,
    height: RADIO_SIZE,
    borderRadius: radii.full,
    borderWidth: borderWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: radii.full,
  },
  text: {
    flex: 1,
  },
  label: {
    fontSize: typography.size.sm,
  },
  description: {
    fontSize: typography.size.xs,
    marginTop: spacing[1] / 2,
  },
});
