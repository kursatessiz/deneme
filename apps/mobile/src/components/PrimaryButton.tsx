import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { onColor } from '@platform/shared';

import { appBreadcrumbs } from '../errors/breadcrumbs';
import { palette, spacing, typography, useTheme, useThemeFonts } from '../theme';

interface PrimaryButtonProps {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: 'primary' | 'secondary' | 'danger';
}

/** Action button, minimum 44pt touch target. The primary variant is flat in the tenant color. */
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
        : theme.colors.onPrimary;

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
      onPress={() => {
        // A step for error reports: the button's label only, never field values.
        appBreadcrumbs.add('click', `button ${label}`);
        onPress();
      }}
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
        <View style={[styles.fill, { borderRadius: radius, backgroundColor: theme.colors.primary }]}>
          {content}
        </View>
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
