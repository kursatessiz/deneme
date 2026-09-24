import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';

import { onColor } from '@platform/shared';

import { GradientSurface } from './GradientSurface';
import { palette, spacing, typography, useTheme, useThemeFonts } from '../theme';

interface PrimaryButtonProps {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: 'primary' | 'secondary' | 'danger';
}

/** Action button, minimum 44pt touch target. The primary variant carries the tenant gradient. */
export function PrimaryButton({ label, onPress, disabled, loading, variant = 'primary' }: PrimaryButtonProps) {
  const { theme } = useTheme();
  const fonts = useThemeFonts();
  const isDisabled = disabled || loading;
  const radius = theme.family.radii.button;

  const textColor =
    variant === 'secondary'
      ? theme.colors.textPrimary
      : variant === 'danger'
        ? onColor(palette.danger)
        : onColor(theme.gradient.stops[0]);

  const content = loading ? (
    <ActivityIndicator color={textColor} />
  ) : (
    <Text style={[styles.label, fonts.bodyStrong, { color: textColor }]}>{label}</Text>
  );

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        { borderRadius: radius },
        variant === 'danger' && { backgroundColor: palette.danger },
        variant === 'secondary' && { borderWidth: 1, borderColor: theme.colors.border },
        isDisabled && styles.disabled,
        pressed && !isDisabled && styles.pressed,
      ]}
    >
      {variant === 'primary' ? (
        <GradientSurface slot="primaryButton" style={[styles.fill, { borderRadius: radius }]}>
          {content}
        </GradientSurface>
      ) : (
        content
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  fill: {
    alignSelf: 'stretch',
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[4],
  },
  disabled: {
    opacity: 0.5,
  },
  pressed: {
    opacity: 0.85,
  },
  label: {
    fontSize: typography.size.md,
    fontWeight: typography.weight.semibold,
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[4],
  },
});
