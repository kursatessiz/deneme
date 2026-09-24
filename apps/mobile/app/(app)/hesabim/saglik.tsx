import type { HealthConsentStatusDTO, HealthSettingsDTO } from '@platform/shared';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '../../../src/components/PrimaryButton';
import { ScreenContainer } from '../../../src/components/ScreenContainer';
import { SwitchRow } from '../../../src/components/SwitchRow';
import { ApiError, apiRequest } from '../../../src/lib/api';
import { useSession } from '../../../src/lib/session';
import { palette, radii, spacing, typography, useThemeColors } from '../../../src/theme';

/**
 * Hesabım > Sağlık entegrasyonu (W21). Privacy-first: every toggle defaults
 * to off, an explicit consent must be accepted before anything can be
 * turned on, and the member can delete every server-side row at any time.
 */
export default function SaglikEntegrasyonuScreen() {
  const colors = useThemeColors();
  const router = useRouter();
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
      setError(e instanceof ApiError ? e.message : 'Sağlık ayarları yüklenemedi.');
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
      setError(e instanceof ApiError ? e.message : 'Onay kaydedilemedi.');
    } finally {
      setBusy(false);
    }
  };

  const handleToggle = async (key: keyof Pick<HealthSettingsDTO, 'writeWorkouts' | 'readAggregates' | 'shareWithStudio'>, value: boolean) => {
    if (!studioId || !settings) return;
    if (value && !consent?.hasActiveConsent) {
      setError('Önce sağlık verisi paylaşımı için onay vermelisiniz.');
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
      setError(e instanceof ApiError ? e.message : 'Ayar kaydedilemedi.');
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
      setError(e instanceof ApiError ? e.message : 'Veriler silinemedi.');
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
      <Text style={[styles.lead, { color: colors.textSecondary }]}>
        Apple Health veya Health Connect ile katıldığınız seansları ve isterseniz günlük adım, aktif enerji ve dinlenme
        nabzı verilerinizi bu uygulamayla paylaşabilirsiniz. Sağlık verisi özel nitelikli kişisel veridir: hiçbir şey
        açık onayınız olmadan paylaşılmaz ve dilediğiniz zaman tamamen silinebilir.
      </Text>

      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>Onay</Text>
        <Text style={[styles.cardDescription, { color: colors.textSecondary }]}>
          {consent.hasActiveConsent
            ? 'Sağlık verisi paylaşımı için onayınız var.'
            : 'Ayarları açmak için önce sağlık verisi paylaşımı açık rıza metnini onaylamalısınız.'}
        </Text>
        {!consent.hasActiveConsent ? (
          <PrimaryButton label="Onaylıyorum" onPress={handleAcceptConsent} loading={busy} />
        ) : null}
      </View>

      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>Seanslarımı sağlığa yaz</Text>
        <Text style={[styles.cardDescription, { color: colors.textSecondary }]}>
          Katıldığınız bir seans bittiğinde, seans türü ve süresi (girdiyseniz kalori) cihazınızın sağlık uygulamasına
          antrenman olarak yazılır. Aynı seans asla iki kez yazılmaz.
        </Text>
        <SwitchRow label="Aç" value={settings.writeWorkouts} onValueChange={(v) => handleToggle('writeWorkouts', v)} />
      </View>

      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>Adım ve nabız verimi oku</Text>
        <Text style={[styles.cardDescription, { color: colors.textSecondary }]}>
          Günlük adım, aktif enerji ve dinlenme nabzı özetleriniz yalnızca cihazınızda, "Sağlık" ekranınızda gösterilir.
        </Text>
        <SwitchRow label="Aç" value={settings.readAggregates} onValueChange={(v) => handleToggle('readAggregates', v)} />
      </View>

      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>İşletmeyle paylaş</Text>
        <Text style={[styles.cardDescription, { color: colors.textSecondary }]}>
          Ayrı bir onay: açarsanız günlük özetleriniz (asla ham veri değil) işletmenizle paylaşılır, eğitmeniniz üye
          kartınızda eğilimi görebilir. Bu ayar yalnızca "Adım ve nabız verimi oku" açıkken çalışır.
        </Text>
        <SwitchRow
          label="Aç"
          value={settings.shareWithStudio}
          onValueChange={(v) => handleToggle('shareWithStudio', v)}
          disabled={!settings.readAggregates}
        />
      </View>

      <View style={styles.link}>
        <PrimaryButton label="Sağlık ekranımı gör" variant="secondary" onPress={() => router.push('/(app)/hesabim/saglik-ozet')} />
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>Verilerimi sil</Text>
        <Text style={[styles.cardDescription, { color: colors.textSecondary }]}>
          Sunucuda saklanan tüm sağlık verileriniz (günlük özetler ve senkronizasyon kayıtları) kalıcı olarak silinir,
          tüm ayarlar kapatılır ve onayınız geri alınır. Cihazınızın kendi sağlık uygulamasındaki veriler bu işlemden
          etkilenmez.
        </Text>
        {confirmingDelete ? (
          <>
            <Text style={[styles.cardDescription, { color: palette.danger }]}>Emin misiniz? Bu işlem geri alınamaz.</Text>
            <PrimaryButton label="Evet, verilerimi sil" variant="danger" onPress={handleDelete} loading={deleting} />
            <PrimaryButton label="Vazgeç" variant="secondary" onPress={() => setConfirmingDelete(false)} />
          </>
        ) : (
          <PrimaryButton label="Verilerimi sil" variant="danger" onPress={() => setConfirmingDelete(true)} />
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
    borderWidth: 1,
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
