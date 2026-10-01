import React from 'react';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { TOUCH_TARGET, borderWidth, spacing, typography, useTheme, useThemeFonts } from '../theme';

export interface ListRowProps {
  title: string;
  subtitle?: string;
  /** Drawn at the start, e.g. an avatar or an icon. */
  leading?: ReactNode;
  /** Drawn at the end, e.g. a Badge or a value. */
  trailing?: ReactNode;
  onPress?: () => void;
  accessibilityLabel?: string;
  /** Bottom hairline; turn off for the last row of a Card. */
  divider?: boolean;
}

/** A row of a list: title, optional subtitle, optional leading and trailing content. */
export function ListRow({ title, subtitle, leading, trailing, onPress, accessibilityLabel, divider = true }: ListRowProps) {
  const { theme } = useTheme();
  const fonts = useThemeFonts();
  const c = theme.colors;

  const content = (
    <>
      {leading}
      <View style={styles.text}>
        <Text style={[styles.title, fonts.bodyMedium, { color: c.textPrimary }]}>{title}</Text>
        {subtitle ? <Text style={[styles.subtitle, fonts.body, { color: c.textMuted }]}>{subtitle}</Text> : null}
      </View>
      {trailing}
    </>
  );
  const frame = [styles.row, divider && { borderBottomWidth: borderWidth, borderBottomColor: c.border }];

  if (onPress) {
    return (
      <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? title} onPress={onPress} style={frame}>
        {content}
      </Pressable>
    );
  }
  return <View style={frame}>{content}</View>;
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: TOUCH_TARGET + spacing[3],
    paddingVertical: spacing[2],
    gap: spacing[3],
  },
  text: { flex: 1, gap: spacing[1] / 2 },
  title: { fontSize: typography.size.sm },
  subtitle: { fontSize: typography.size.xs },
});
