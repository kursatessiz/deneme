import React from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';

import { palette, spacing, typography } from '../theme';
import { useThemeColors } from '../theme';

interface SwitchRowProps {
  label: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
}

/** A single labeled switch, laid out for a >=44pt touch target. */
export function SwitchRow({ label, value, onValueChange, disabled }: SwitchRowProps) {
  const colors = useThemeColors();

  return (
    <View style={styles.row}>
      <Text style={[styles.label, { color: colors.textPrimary }]}>{label}</Text>
      <Switch
        accessibilityLabel={label}
        accessibilityRole="switch"
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        trackColor={{ false: palette.ink[200], true: palette.success }}
        thumbColor={palette.white}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 44,
  },
  label: {
    fontSize: typography.size.sm,
    fontWeight: typography.weight.medium,
    marginRight: spacing[3],
  },
});
