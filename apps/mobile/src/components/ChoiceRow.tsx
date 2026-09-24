import React from 'react';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { spacing, typography, useTheme, useThemeFonts } from '../theme';

interface ChoiceRowProps {
  label: string;
  description?: string;
  selected: boolean;
  onPress: () => void;
  /** Optional preview drawn on the right, e.g. color swatches. */
  accessory?: ReactNode;
  disabled?: boolean;
}

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
        <Text style={[styles.label, fonts.bodyStrong, { color: c.textPrimary }]}>{label}</Text>
        {description ? <Text style={[styles.description, fonts.body, { color: c.textSecondary }]}>{description}</Text> : null}
      </View>
      {accessory}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 56,
    paddingVertical: spacing[3],
    borderBottomWidth: 1,
    gap: spacing[3],
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  text: {
    flex: 1,
  },
  label: {
    fontSize: typography.size.md,
  },
  description: {
    fontSize: typography.size.sm,
    marginTop: 2,
  },
});
