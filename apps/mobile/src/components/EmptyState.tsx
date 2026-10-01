import React from 'react';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { borderWidth, radii, spacing, typography, useTheme, useThemeFonts } from '../theme';

export interface EmptyStateProps {
  title: string;
  description?: string;
  /** Usually a Button. */
  action?: ReactNode;
}

/** Quiet placeholder for an empty list: dashed outline, muted copy, optional action. */
export function EmptyState({ title, description, action }: EmptyStateProps) {
  const { theme } = useTheme();
  const fonts = useThemeFonts();
  const c = theme.colors;
  return (
    <View style={[styles.wrap, { borderColor: c.border, borderRadius: radii.md }]}>
      <Text style={[styles.title, fonts.bodyStrong, { color: c.textPrimary }]}>{title}</Text>
      {description ? <Text style={[styles.description, fonts.body, { color: c.textMuted }]}>{description}</Text> : null}
      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    gap: spacing[2],
    padding: spacing[6],
    borderWidth: borderWidth,
    borderStyle: 'dashed',
  },
  title: { fontSize: typography.size.md, textAlign: 'center' },
  description: { fontSize: typography.size.sm, textAlign: 'center' },
});
