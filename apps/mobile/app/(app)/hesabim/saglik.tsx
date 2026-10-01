import type { HealthConsentStatusDTO, HealthSettingsDTO } from '@platform/shared';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { PrimaryButton } from '../../../src/components/PrimaryButton';
import { ScreenContainer } from '../../../src/components/ScreenContainer';
import { SwitchRow } from '../../../src/components/SwitchRow';
import { useT } from '../../../src/i18n';
import { ApiError, apiRequest } from '../../../src/lib/api';
import { useSession } from '../../../src/lib/session';
import { borderWidth, palette, radii, spacing, typography, useThemeColors } from '../../../src/theme';
import { Text } from '../../../src/components/Text';

/**
 * Hesabım > Sağlık entegrasyonu (W21). Privacy-first: every toggle defaults
 * to off, an explicit consent must be accepted before anything can be
 * turned on, and the member can delete every server-side row at any time.
 */
export default function SaglikEntegrasyonuScreen() {
  const colors = useThemeColors();
  const router = useRouter();
  const t = useT();
  const { activeMembership } = useSession();
  const studioId = activeMembership?.studioId;

  const [settings, setSettings] = useState<HealthSettingsDTO | null>(null);
  const [consent, setConsent] = useState<HealthConsentStatusDTO | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const load = useCallback(async () => {
    if (!studioId) return;
    setError(undefined);
    try {
      const [s, c] = await Promise.all([
        apiRequest<HealthSettingsDTO>('/me/health/settings', { studioId }),
        apiRequest<HealthConsentStatusDTO>('/me/health/consent', { studioId }),
      ]);
      setSettings(s);
      setConsent(c);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('mHealth.errors.settingsLoadFailed'));
    }
  }, [studioId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleAcceptConsent = async () => {
    if (!studioId) return;
    setBusy(true);
    setError(undefined);
    try {
      const updated = await apiRequest<HealthConsentStatusDTO>('/me/health/consent', { method: 'POST', studioId, body: {} });
      setConsent(updated);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('mHealth.errors.consentSaveFailed'));
    } finally {
      setBusy(false);
    }
  };

  const handleToggle = async (key: keyof Pick<HealthSettingsDTO, 'writeWorkouts' | 'readAggregates' | 'shareWithStudio'>, value: boolean) => {
    if (!studioId || !settings) return;
    if (value && !consent?.hasActiveConsent) {
      setError(t('mHealth.errors.consentRequired'));
      return;
    }
    const previous = settings;
    const next = { ...settings, [key]: value };
    setSettings(next);
    setError(undefined);
    try {
      const updated = await apiRequest<HealthSettingsDTO>('/me/health/settings', {
        method: 'PUT',
        studioId,
        body: { writeWorkouts: next.writeWorkouts, readAggregates: next.readAggregates, shareWithStudio: next.shareWithStudio },
      });
      setSettings(updated);
    } catch (e) {
      setSettings(previous);
      setError(e instanceof ApiError ? e.message : t('mHealth.errors.settingSaveFailed'));
    }
  };

  const handleDelete = async () => {
    if (!studioId) return;
    setDeleting(true);
    setError(undefined);
    try {
      await apiRequest('/me/health/data', { method: 'DELETE', studioId });
      setConfirmingDelete(false);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('mHealth.errors.dataDeleteFailed'));
    } finally {
      setDeleting(false);
    }
  };

  if (!settings || !consent) {
    return (
      <ScreenContainer>
        {error ? <Text style={styles.error}>{error}</Text> : <ActivityIndicator color={colors.textPrimary} />}
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer>
      <Text style={[styles.lead, { color: colors.textSecondary }]}>{t('mHealth.lead')}</Text>

      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>{t('mHealth.consent.title')}</Text>
        <Text style={[styles.cardDescription, { color: colors.textSecondary }]}>
          {consent.hasActiveConsent ? t('mHealth.consent.granted') : t('mHealth.consent.notGranted')}
        </Text>
        {!consent.hasActiveConsent ? (
          <PrimaryButton label={t('mHealth.consent.accept')} onPress={handleAcceptConsent} loading={busy} />
        ) : null}
      </View>

      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>{t('mHealth.writeWorkouts.title')}</Text>
        <Text style={[styles.cardDescription, { color: colors.textSecondary }]}>{t('mHealth.writeWorkouts.description')}</Text>
        <SwitchRow label={t('mHealth.toggleOn')} value={settings.writeWorkouts} onValueChange={(v) => handleToggle('writeWorkouts', v)} />
      </View>

      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>{t('mHealth.readAggregates.title')}</Text>
        <Text style={[styles.cardDescription, { color: colors.textSecondary }]}>{t('mHealth.readAggregates.description')}</Text>
        <SwitchRow label={t('mHealth.toggleOn')} value={settings.readAggregates} onValueChange={(v) => handleToggle('readAggregates', v)} />
      </View>

      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>{t('mHealth.shareWithStudio.title')}</Text>
        <Text style={[styles.cardDescription, { color: colors.textSecondary }]}>{t('mHealth.shareWithStudio.description')}</Text>
        <SwitchRow
          label={t('mHealth.toggleOn')}
          value={settings.shareWithStudio}
          onValueChange={(v) => handleToggle('shareWithStudio', v)}
          disabled={!settings.readAggregates}
        />
      </View>

      <View style={styles.link}>
        <PrimaryButton label={t('mHealth.viewHealthScreen')} variant="secondary" onPress={() => router.push('/(app)/hesabim/saglik-ozet')} />
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>{t('mHealth.deleteData.title')}</Text>
        <Text style={[styles.cardDescription, { color: colors.textSecondary }]}>{t('mHealth.deleteData.description')}</Text>
        {confirmingDelete ? (
          <>
            <Text style={[styles.cardDescription, { color: palette.danger }]}>{t('mHealth.deleteData.confirm')}</Text>
            <PrimaryButton label={t('mHealth.deleteData.confirmYes')} variant="danger" onPress={handleDelete} loading={deleting} />
            <PrimaryButton label={t('mHealth.deleteData.cancel')} variant="secondary" onPress={() => setConfirmingDelete(false)} />
          </>
        ) : (
          <PrimaryButton label={t('mHealth.deleteData.action')} variant="danger" onPress={() => setConfirmingDelete(true)} />
        )}
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  lead: {
    fontSize: typography.size.sm,
    marginBottom: spacing[4],
    lineHeight: 20,
  },
  card: {
    borderWidth: borderWidth,
    borderRadius: radii.md,
    padding: spacing[4],
    marginBottom: spacing[4],
    gap: spacing[2],
  },
  cardTitle: {
    fontSize: typography.size.md,
    fontWeight: typography.weight.semibold,
  },
  cardDescription: {
    fontSize: typography.size.sm,
    lineHeight: 18,
  },
  link: {
    marginBottom: spacing[4],
  },
  error: {
    color: palette.danger,
    fontSize: typography.size.sm,
    marginBottom: spacing[3],
  },
});
