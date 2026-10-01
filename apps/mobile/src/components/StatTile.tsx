import React from 'react';
import { StyleSheet, Text } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';

import { spacing, typography, useTheme, useThemeFonts } from '../theme';
import { Card } from './Card';

export interface StatTileProps {
  label: string;
  value: string;
  hint?: string;
  style?: StyleProp<ViewStyle>;
}

/** One number with its label: the building block of summaries and reports. */
export function StatTile({ label, value, hint, style }: StatTileProps) {
  const { theme } = useTheme();
  const fonts = useThemeFonts();
  const c = theme.colors;
  return (
    <Card style={[styles.tile, style]}>
      <Text style={[styles.label, fonts.bodyMedium, { color: c.textMuted }]}>{label}</Text>
      <Text style={[styles.value, fonts.display, { color: c.textPrimary }]}>{value}</Text>
      {hint ? <Text style={[styles.hint, fonts.body, { color: c.textMuted }]}>{hint}</Text> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  tile: { flex: 1 },
  label: { fontSize: typography.size.xs },
  value: { fontSize: typography.size.xl, marginTop: spacing[1] },
  hint: { fontSize: typography.size.xs },
});
