import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import type { AppearancePreference, ColorSchemePreference } from '@platform/shared';

import { ChoiceRow } from '../../../src/components/ChoiceRow';
import { ScreenContainer } from '../../../src/components/ScreenContainer';
import { Text } from '../../../src/components/Text';
import { useT } from '../../../src/i18n';
import { ApiError } from '../../../src/lib/api';
import { palette, spacing, typography, useTheme, useThemeFonts } from '../../../src/theme';

/**
 * The user's own light/dark/system choice. The studio's logo and primary
 * color stay as they are; the stored theme family is a legacy field and is
 * sent back unchanged.
 */
export default function GorunumScreen() {
  const { theme, appearance, setAppearance } = useTheme();
  const fonts = useThemeFonts();
  const t = useT();
  const [error, setError] = useState<string | undefined>();
  const c = theme.colors;

  const SCHEMES: { key: ColorSchemePreference; label: string; description: string }[] = [
    { key: 'SYSTEM', label: t('mAccount.appearance.system'), description: t('mAccount.appearance.systemDescription') },
    { key: 'LIGHT', label: t('mAccount.appearance.light'), description: t('mAccount.appearance.lightDescription') },
    { key: 'DARK', label: t('mAccount.appearance.dark'), description: t('mAccount.appearance.darkDescription') },
  ];

  const save = async (next: AppearancePreference) => {
    setError(undefined);
    try {
      await setAppearance(next);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('mAccount.appearance.saveError'));
    }
  };

  return (
    <ScreenContainer>
      <Text style={[styles.section, fonts.bodyStrong, { color: c.textPrimary }]}>{t('mAccount.appearance.section.colorScheme')}</Text>
      <View style={styles.group}>
        {SCHEMES.map((s) => (
          <ChoiceRow
            key={s.key}
            label={s.label}
            description={s.description}
            selected={appearance.colorScheme === s.key}
            onPress={() => save({ ...appearance, colorScheme: s.key })}
          />
        ))}
      </View>

      <Text style={[styles.note, fonts.body, { color: c.textMuted }]}>{t('mAccount.appearance.note')}</Text>
      {error ? <Text style={[styles.error, { color: palette.danger }]}>{error}</Text> : null}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  section: {
    fontSize: typography.size.sm,
    marginTop: spacing[4],
    marginBottom: spacing[1],
  },
  group: {
    marginBottom: spacing[4],
  },
  note: {
    fontSize: typography.size.sm,
    marginTop: spacing[2],
  },
  error: {
    marginTop: spacing[3],
    fontSize: typography.size.sm,
  },
});
