import React from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import type { KeyboardTypeOptions } from 'react-native';

import { TOUCH_TARGET, borderWidth, radii, spacing, typography, useTheme, useThemeFonts } from '../theme';

interface TextFieldProps {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  keyboardType?: KeyboardTypeOptions;
  secureTextEntry?: boolean;
  maxLength?: number;
  autoFocus?: boolean;
  errorMessage?: string;
}

/** Labeled text input with an accessible label and error text. */
export function TextField({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  secureTextEntry,
  maxLength,
  autoFocus,
  errorMessage,
}: TextFieldProps) {
  const { theme } = useTheme();
  const fonts = useThemeFonts();
  const colors = theme.colors;

  return (
    <View style={styles.container}>
      <Text style={[styles.label, fonts.bodyMedium, { color: colors.textPrimary }]}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        keyboardType={keyboardType}
        secureTextEntry={secureTextEntry}
        maxLength={maxLength}
        autoFocus={autoFocus}
        autoCapitalize="none"
        autoCorrect={false}
        style={[
          styles.input,
          fonts.body,
          {
            borderColor: errorMessage ? theme.roles.error : colors.border,
            color: colors.textPrimary,
            backgroundColor: colors.surface,
            borderRadius: radii.sm,
          },
        ]}
      />
      {errorMessage ? <Text style={[styles.error, fonts.body, { color: theme.roles.error }]}>{errorMessage}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: spacing[4],
  },
  label: {
    fontSize: typography.size.sm,
    marginBottom: spacing[1],
  },
  input: {
    minHeight: TOUCH_TARGET,
    borderWidth: borderWidth,
    paddingHorizontal: spacing[3],
    fontSize: typography.size.sm,
  },
  error: {
    marginTop: spacing[1],
    fontSize: typography.size.xs,
  },
});
