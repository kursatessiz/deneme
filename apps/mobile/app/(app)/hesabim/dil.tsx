import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ChoiceRow } from '../../../src/components/ChoiceRow';
import { ScreenContainer } from '../../../src/components/ScreenContainer';
import { useLocale, useT } from '../../../src/i18n';
import { ApiError } from '../../../src/lib/api';
import { useSession } from '../../../src/lib/session';
import { palette, spacing, typography, useThemeColors, useThemeFonts } from '../../../src/theme';
import { Text } from '../../../src/components/Text';

/**
 * The user's own language choice (Hesabım > Dil). Mirrors gorunum.tsx: a
 * "follow the studio" option plus one row per enabled language, saved
 * immediately via PUT /me/locale (see I18nProvider.setLocale), which also
 * switches the running app's language without a restart.
 */
export default function DilScreen() {
  const colors = useThemeColors();
  const fonts = useThemeFonts();
  const t = useT();
  const { user, activeMembership } = useSession();
  const { languages, setLocale, isSettingLocale } = useLocale();
  const [error, setError] = useState<string | undefined>();

  const userChoice = user?.locale ?? null;

  const save = async (next: string | null) => {
    setError(undefined);
    try {
      await setLocale(next);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('mAccount.language.saveError'));
    }
  };

  return (
    <ScreenContainer>
      <Text style={[styles.section, fonts.bodyStrong, { color: colors.textSecondary }]}>
        {t('mAccount.language.section.title')}
      </Text>
      <View style={styles.group}>
        <ChoiceRow
          label={t('language.followStudio')}
          description={activeMembership?.studioName}
          selected={userChoice === null}
          onPress={() => save(null)}
          disabled={isSettingLocale}
        />
        {languages.map((language) => (
          <ChoiceRow
            key={language.code}
            label={language.nativeName}
            selected={userChoice === language.code}
            onPress={() => save(language.code)}
            disabled={isSettingLocale}
          />
        ))}
      </View>

      <Text style={[styles.note, fonts.body, { color: colors.textMuted }]}>{t('mAccount.language.deviceHint')}</Text>
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
