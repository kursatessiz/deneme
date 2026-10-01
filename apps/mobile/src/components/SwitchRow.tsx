import React from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';

import { TOUCH_TARGET, spacing, typography, useTheme, useThemeFonts } from '../theme';

interface SwitchRowProps {
  label: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
}

/** A single labeled switch (tenant color when on), laid out for a >=44pt touch target. */
export function SwitchRow({ label, value, onValueChange, disabled }: SwitchRowProps) {
  const { theme } = useTheme();
  const fonts = useThemeFonts();
  const colors = theme.colors;

  return (
    <View style={styles.row}>
      <Text style={[styles.label, fonts.bodyMedium, { color: colors.textPrimary }]}>{label}</Text>
      <Switch
        accessibilityLabel={label}
        accessibilityRole="switch"
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        trackColor={{ false: colors.surfaceEmphasis, true: colors.primary }}
        thumbColor={value ? colors.onPrimary : colors.background}
        ios_backgroundColor={colors.surfaceEmphasis}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: TOUCH_TARGET,
  },
  label: {
    flex: 1,
    fontSize: typography.size.sm,
    marginRight: spacing[3],
  },
});
