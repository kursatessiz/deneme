import { Redirect } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { onColor } from '@platform/shared';
import type { TenantTheme } from '@platform/shared';

import { PrimaryButton } from '../../../src/components/PrimaryButton';
import { ScreenContainer } from '../../../src/components/ScreenContainer';
import { Text } from '../../../src/components/Text';
import { TextField } from '../../../src/components/TextField';
import { useT } from '../../../src/i18n';
import { ApiError, apiRequest } from '../../../src/lib/api';
import { useSession } from '../../../src/lib/session';
import { TOUCH_TARGET, palette, radii, spacing, typography, useTheme, useThemeFonts } from '../../../src/theme';

const HEX = /^#[0-9a-fA-F]{6}$/;

/**
 * Owner/manager screen: the studio's logo and primary color. The stored theme
 * family and gradient key are sent back unchanged (since T1 they no longer
 * change what renders).
 */
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

  const colorValid = HEX.test(draft.themePrimary);

  const save = async () => {
    setError(undefined);
    setSaved(false);
    if (!colorValid) {
      setError(t('mTheme.colorFormatError'));
      return;
    }
    setIsSaving(true);
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

      <TextField
        label={t('mTheme.logoUrl')}
        value={draft.logoUrl ?? ''}
        placeholder="https://..."
        keyboardType="url"
        onChangeText={(v) => {
          setSaved(false);
          setDraft({ ...draft, logoUrl: v.trim() === '' ? null : v });
        }}
      />
      <TextField
        label={t('mTheme.primaryColorLabel')}
        value={draft.themePrimary}
        placeholder="#0092CD"
        maxLength={7}
        errorMessage={colorValid ? undefined : t('mTheme.colorFormatError')}
        onChangeText={(v) => {
          setSaved(false);
          setDraft({ ...draft, themePrimary: v });
        }}
      />

      {colorValid ? (
        <View style={[styles.preview, { backgroundColor: draft.themePrimary, borderRadius: radii.sm }]}>
          <Text style={[fonts.bodyMedium, { color: onColor(draft.themePrimary) }]}>{t('mTheme.primaryColor', { color: draft.themePrimary })}</Text>
        </View>
      ) : null}

      {error ? <Text style={[styles.message, { color: palette.danger }]}>{error}</Text> : null}
      {saved ? <Text style={[styles.message, { color: c.textSecondary }]}>{t('mTheme.saved')}</Text> : null}
      <PrimaryButton label={t('mTheme.save')} onPress={save} loading={isSaving} />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  lead: { fontSize: typography.size.sm, marginBottom: spacing[4] },
  preview: { minHeight: TOUCH_TARGET, alignItems: 'center', justifyContent: 'center', marginBottom: spacing[4] },
  message: { fontSize: typography.size.sm, marginBottom: spacing[3] },
});
