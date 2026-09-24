import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { THEME_FAMILIES, THEME_FAMILY_KEYS } from '@platform/shared';
import type { AppearancePreference, ColorSchemePreference, ThemeFamilyKey } from '@platform/shared';

import { ChoiceRow } from '../../../src/components/ChoiceRow';
import { ScreenContainer } from '../../../src/components/ScreenContainer';
import { Swatches } from '../../../src/components/Swatches';
import { ApiError } from '../../../src/lib/api';
import { useSession } from '../../../src/lib/session';
import { palette, spacing, typography, useTheme, useThemeFonts } from '../../../src/theme';

const SCHEMES: { key: ColorSchemePreference; label: string; description: string }[] = [
  { key: 'SYSTEM', label: 'Sistem', description: 'Telefonun açık veya koyu ayarını izler' },
  { key: 'LIGHT', label: 'Açık', description: 'Her zaman açık zemin' },
  { key: 'DARK', label: 'Koyu', description: 'Her zaman koyu zemin' },
];

/** The user's own theme family and light/dark choice. The studio's brand colors stay as they are. */
export default function GorunumScreen() {
  const { theme, appearance, setAppearance } = useTheme();
  const fonts = useThemeFonts();
  const { activeMembership } = useSession();
  const [error, setError] = useState<string | undefined>();
  const c = theme.colors;

  const save = async (next: AppearancePreference) => {
    setError(undefined);
    try {
      await setAppearance(next);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Görünüm kaydedilemedi.');
    }
  };

  const studioFamily = activeMembership?.theme.themeFamily;
  const studioLabel = studioFamily ? THEME_FAMILIES[studioFamily].label : null;

  return (
    <ScreenContainer>
      <Text style={[styles.section, fonts.bodyStrong, { color: c.textSecondary }]}>Tema</Text>
      <View style={styles.group}>
        <ChoiceRow
          label="İşletmenin teması"
          description={studioLabel ? `${studioLabel}, işletmenin seçtiği tema` : 'İşletmenin seçtiği tema'}
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

      <Text style={[styles.section, fonts.bodyStrong, { color: c.textSecondary }]}>Açık veya koyu</Text>
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

      <Text style={[styles.note, fonts.body, { color: c.textMuted }]}>
        Logo, ana renk ve gradyan işletmeye aittir; burada yalnızca yazı tipi, köşe yapısı ve zemin renkleri değişir.
      </Text>
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
