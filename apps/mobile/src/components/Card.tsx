import React from 'react';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';

import { borderWidth, radii, spacing, typography, useTheme, useThemeFonts } from '../theme';

export interface CardProps {
  children?: ReactNode;
  /** Optional header band (muted background, bottom border). A string renders as a title. */
  header?: ReactNode;
  /** Draws no padding around children, for lists that bring their own rows. */
  flush?: boolean;
  onPress?: () => void;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

/** Flat card of the kit: page-colored surface, 1px border, radius 9, no shadow. */
export function Card({ children, header, flush, onPress, accessibilityLabel, style }: CardProps) {
  const { theme } = useTheme();
  const fonts = useThemeFonts();
  const c = theme.colors;

  const body = (
    <>
      {header !== undefined && header !== null ? (
        <View style={[styles.header, { backgroundColor: c.surfaceMuted, borderBottomColor: c.border }]}>
          {typeof header === 'string' ? (
            <Text style={[styles.headerText, fonts.bodyStrong, { color: c.textPrimary }]}>{header}</Text>
          ) : (
            header
          )}
        </View>
      ) : null}
      <View style={flush ? undefined : styles.body}>{children}</View>
    </>
  );

  const frame: StyleProp<ViewStyle> = [
    styles.card,
    { backgroundColor: c.surface, borderColor: c.border, borderRadius: radii.md },
    style,
  ];

  if (onPress) {
    return (
      <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} onPress={onPress} style={frame}>
        {body}
      </Pressable>
    );
  }
  return <View style={frame}>{body}</View>;
}

const styles = StyleSheet.create({
  card: { borderWidth: borderWidth, overflow: 'hidden' },
  header: { paddingHorizontal: spacing[4], paddingVertical: spacing[3], borderBottomWidth: borderWidth },
  headerText: { fontSize: typography.size.sm },
  body: { padding: spacing[4], gap: spacing[2] },
});
