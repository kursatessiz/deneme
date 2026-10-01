import { Redirect } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { THEME_FAMILIES, THEME_FAMILY_KEYS, getThemeFamily, onColor } from '@platform/shared';
import type { TenantTheme, ThemeFamilyKey } from '@platform/shared';

import { ChoiceRow } from '../../../src/components/ChoiceRow';
import { PrimaryButton } from '../../../src/components/PrimaryButton';
import { ScreenContainer } from '../../../src/components/ScreenContainer';
import { Swatches } from '../../../src/components/Swatches';
import { useT } from '../../../src/i18n';
import { ApiError, apiRequest } from '../../../src/lib/api';
import { useSession } from '../../../src/lib/session';
import { palette, spacing, typography, useTheme, useThemeFonts } from '../../../src/theme';

/** Owner/manager screen: the studio's default theme family, gradient and primary color. */
export default function IsletmeTemasiScreen() {
  const { activeMembership, refreshUser } = useSession();
  const { theme } = useTheme();
  const fonts = useThemeFonts();
  const t = useT();
  const c = theme.colors;
  const studioId = activeMembership?.studioId;
  const canManage = activeMembership?.permissions.includes('studio.settings.manage') ?? false;

  const [draft, setDraft] = useState<TenantTheme | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [saved, setSaved] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!studioId || !canManage) return;
    apiRequest<TenantTheme>(`/studios/${studioId}/theme`)
      .then(setDraft)
      .catch((e: unknown) => setError(e instanceof ApiError ? e.message : t('mTheme.errors.loadFailed')));
  }, [studioId, canManage]);

  if (!canManage) return <Redirect href="/(app)/hesabim" />;
  if (!draft) {
    return (
      <ScreenContainer>
        {error ? <Text style={{ color: palette.danger }}>{error}</Text> : <ActivityIndicator />}
      </ScreenContainer>
    );
  }

  const family = getThemeFamily(draft.themeFamily);

  const pickFamily = (key: ThemeFamilyKey) => {
    const next = THEME_FAMILIES[key];
    setSaved(false);
    setDraft({ ...draft, themeFamily: key, gradientPresetKey: next.gradients[0].key, themePrimary: next.gradients[0].stops[0] });
  };

  const save = async () => {
    setIsSaving(true);
    setError(undefined);
    try {
      const result = await apiRequest<TenantTheme>(`/studios/${studioId}/theme`, { method: 'PUT', body: draft });
      setDraft(result);
      await refreshUser();
      setSaved(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('mTheme.errors.saveFailed'));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <ScreenContainer>
      <Text style={[styles.lead, fonts.body, { color: c.textSecondary }]}>{t('mTheme.lead')}</Text>

      <Text style={[styles.section, fonts.bodyStrong, { color: c.textSecondary }]}>{t('mTheme.family')}</Text>
      {THEME_FAMILY_KEYS.map((key) => {
        const f = THEME_FAMILIES[key];
        return (
          <ChoiceRow
            key={key}
            label={f.label}
            description={`${f.description} ${t('mTheme.recommendedFor', { recommendedFor: f.recommendedFor })}`}
            selected={draft.themeFamily === key}
            onPress={() => pickFamily(key)}
          />
        );
      })}

      <Text style={[styles.section, fonts.bodyStrong, { color: c.textSecondary }]}>{t('mTheme.gradient')}</Text>
      <View style={styles.grid}>
        {family.gradients.map((g) => {
          const selected = draft.gradientPresetKey === g.key;
          return (
            <Pressable
              key={g.key}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={g.label}
              onPress={() => {
                setSaved(false);
                // Since T1 the stored preset key is ignored; a choice only sets the primary color.
                setDraft({ ...draft, themePrimary: g.stops[0] });
              }}
              style={[styles.gradientChoice, { borderColor: selected ? c.textPrimary : c.border }]}
            >
              <Swatches colors={g.stops} size={22} radius={family.radii.chip > 20 ? 11 : family.radii.chip} />
              <Text style={[styles.gradientLabel, fonts.body, { color: c.textPrimary }]}>{g.label}</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={[styles.preview, { backgroundColor: draft.themePrimary, borderRadius: family.radii.button }]}>
        <Text style={[fonts.bodyStrong, { color: onColor(draft.themePrimary) }]}>{t('mTheme.primaryColor', { color: draft.themePrimary })}</Text>
      </View>

      {error ? <Text style={[styles.message, { color: palette.danger }]}>{error}</Text> : null}
      {saved ? <Text style={[styles.message, { color: c.textSecondary }]}>{t('mTheme.saved')}</Text> : null}
      <PrimaryButton label={t('mTheme.save')} onPress={save} loading={isSaving} />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  lead: { fontSize: typography.size.sm, marginBottom: spacing[3] },
  section: { fontSize: typography.size.sm, marginTop: spacing[4], marginBottom: spacing[1] },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2], marginBottom: spacing[4] },
  gradientChoice: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  gradientLabel: { fontSize: typography.size.sm },
  preview: { minHeight: 44, alignItems: 'center', justifyContent: 'center', marginBottom: spacing[4] },
  message: { fontSize: typography.size.sm, marginBottom: spacing[3] },
});
