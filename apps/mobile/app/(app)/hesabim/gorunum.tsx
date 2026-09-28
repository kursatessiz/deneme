import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { THEME_FAMILIES, THEME_FAMILY_KEYS } from '@platform/shared';
import type { AppearancePreference, ColorSchemePreference, ThemeFamilyKey } from '@platform/shared';

import { ChoiceRow } from '../../../src/components/ChoiceRow';
import { ScreenContainer } from '../../../src/components/ScreenContainer';
import { Swatches } from '../../../src/components/Swatches';
import { useT } from '../../../src/i18n';
import { ApiError } from '../../../src/lib/api';
import { useSession } from '../../../src/lib/session';
import { palette, spacing, typography, useTheme, useThemeFonts } from '../../../src/theme';

/** The user's own theme family and light/dark choice. The studio's brand colors stay as they are. */
export default function GorunumScreen() {
  const { theme, appearance, setAppearance } = useTheme();
  const fonts = useThemeFonts();
  const t = useT();
  const { activeMembership } = useSession();
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

  const studioFamily = activeMembership?.theme.themeFamily;
  const studioLabel = studioFamily ? THEME_FAMILIES[studioFamily].label : null;

  return (
    <ScreenContainer>
      <Text style={[styles.section, fonts.bodyStrong, { color: c.textSecondary }]}>{t('mAccount.appearance.section.theme')}</Text>
      <View style={styles.group}>
        <ChoiceRow
          label={t('mAccount.appearance.studioTheme')}
          description={
            studioLabel
              ? t('mAccount.appearance.studioThemeDescription', { family: studioLabel })
              : t('mAccount.appearance.studioThemeDescriptionFallback')
          }
          selected={appearance.themeFamily === null}
          onPress={() => save({ ...appearance, themeFamily: null })}
        />
        {THEME_FAMILY_KEYS.map((key: ThemeFamilyKey) => {
          const family = THEME_FAMILIES[key];
          const mode = theme.mode;
          return (
            <ChoiceRow
              key={key}
              label={family.label}
              description={family.description}
              selected={appearance.themeFamily === key}
              onPress={() => save({ ...appearance, themeFamily: key })}
              accessory={
                <Swatches
                  radius={Math.min(family.radii.card / 2, 9)}
                  colors={[family.colors[mode].background, family.colors[mode].textPrimary, family.gradients[0].stops[0]]}
                />
              }
            />
          );
        })}
      </View>

      <Text style={[styles.section, fonts.bodyStrong, { color: c.textSecondary }]}>{t('mAccount.appearance.section.colorScheme')}</Text>
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
