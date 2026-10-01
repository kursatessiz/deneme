import React from 'react';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { spacing, typography, useTheme, useThemeFonts } from '../theme';

export interface SectionTitleProps {
  title: string;
  description?: string;
  /** Drawn at the end of the title row, e.g. a compact Button. */
  action?: ReactNode;
}

/** Heading of a screen section, with optional muted description and trailing action. */
export function SectionTitle({ title, description, action }: SectionTitleProps) {
  const { theme } = useTheme();
  const fonts = useThemeFonts();
  const c = theme.colors;
  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <Text style={[styles.title, fonts.display, { color: c.textPrimary }]} accessibilityRole="header">
          {title}
        </Text>
        {action}
      </View>
      {description ? <Text style={[styles.description, fonts.body, { color: c.textMuted }]}>{description}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing[1], marginBottom: spacing[3] },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing[3] },
  title: { flex: 1, fontSize: typography.size.md },
  description: { fontSize: typography.size.sm },
});
