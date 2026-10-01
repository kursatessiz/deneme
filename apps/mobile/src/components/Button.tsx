import React from 'react';
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';

import { appBreadcrumbs } from '../errors/breadcrumbs';
import { TOUCH_TARGET, borderWidth, radii, spacing, typography, useTheme, useThemeFonts } from '../theme';
import { toneColors } from './tones';
import type { Tone } from './tones';

export type ButtonVariant = 'solid' | 'soft' | 'outline';

export interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  tone?: Tone;
  disabled?: boolean;
  loading?: boolean;
  /** Smaller control for dense rows; the touch target stays 44pt through hitSlop. */
  compact?: boolean;
  leading?: ReactNode;
  style?: StyleProp<ViewStyle>;
}

/**
 * Button of the kit: solid (default, flat tenant color), soft (tinted) or
 * outline. Never a gradient.
 */
export function Button({
  label,
  onPress,
  variant = 'solid',
  tone = 'theme',
  disabled,
  loading,
  compact,
  leading,
  style,
}: ButtonProps) {
  const { theme } = useTheme();
  const fonts = useThemeFonts();
  const t = toneColors(theme, tone);
  const isDisabled = disabled || loading;

  const background = variant === 'solid' ? t.main : variant === 'soft' ? t.soft : 'transparent';
  const textColor = variant === 'solid' ? t.onMain : t.ink;
  const lineColor = variant === 'outline' ? t.line : variant === 'solid' && tone === 'surface' ? theme.colors.border : 'transparent';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      onPress={() => {
        // A step for error reports: the button's label only, never field values.
        appBreadcrumbs.add('click', `button ${label}`);
        onPress();
      }}
      disabled={isDisabled}
      hitSlop={compact ? spacing[2] : undefined}
      style={({ pressed }) => [
        styles.base,
        compact ? styles.compact : styles.regular,
        { backgroundColor: background, borderColor: lineColor, borderRadius: radii.sm },
        isDisabled && styles.disabled,
        pressed && !isDisabled && styles.pressed,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={textColor} />
      ) : (
        <View style={styles.content}>
          {leading}
          <Text style={[styles.label, fonts.bodyMedium, { color: textColor }]} numberOfLines={1}>
            {label}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: borderWidth,
    paddingHorizontal: spacing[4],
  },
  regular: { minHeight: TOUCH_TARGET },
  compact: { minHeight: spacing[8], paddingHorizontal: spacing[3] },
  content: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  label: { fontSize: typography.size.sm },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.85 },
});
