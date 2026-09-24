import { Redirect } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import type { PartnerConnectionConfig, PartnerProviderName } from '@platform/shared';

import { PrimaryButton } from '../../../src/components/PrimaryButton';
import { ScreenContainer } from '../../../src/components/ScreenContainer';
import { SwitchRow } from '../../../src/components/SwitchRow';
import { TextField } from '../../../src/components/TextField';
import { ApiError, apiRequest } from '../../../src/lib/api';
import { useSession } from '../../../src/lib/session';
import { palette, radii, spacing, typography, useThemeColors } from '../../../src/theme';

interface PartnerConnectionDTO {
  id: string;
  provider: PartnerProviderName;
  label: string;
  status: 'ACTIVE' | 'PAUSED' | 'DISABLED';
  config: PartnerConnectionConfig;
  hasCredentials: boolean;
  lastSyncAt: string | null;
  consecutiveFailures: number;
}

const PROVIDER_LABELS: Record<PartnerProviderName, string> = {
  MOCK: 'Test (Mock)',
  CLASSPASS: 'ClassPass',
  URBAN_SPORTS: 'Urban Sports Club',
  WELLHUB: 'Wellhub (Gympass)',
  OTHER: 'Diğer',
};
const PROVIDERS: PartnerProviderName[] = ['CLASSPASS', 'URBAN_SPORTS', 'WELLHUB', 'OTHER', 'MOCK'];

/**
 * Owner screen: partner/marketplace platform connections (ClassPass, Urban
 * Sports Club, Wellhub/Gympass, local equivalents). Credentials are
 * write-only - the form never pre-fills them and the list never shows them,
 * only whether a connection has one on file.
 */
export default function PartnerPlatformlarScreen() {
  const colors = useThemeColors();
  const { activeMembership } = useSession();
  const studioId = activeMembership?.studioId;
  const canManage = activeMembership?.permissions.includes('integrations.partners.manage') ?? false;

  const [connections, setConnections] = useState<PartnerConnectionDTO[] | null>(null);
  const [loadError, setLoadError] = useState<string | undefined>();
  const [saveError, setSaveError] = useState<string | undefined>();
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [provider, setProvider] = useState<PartnerProviderName>('CLASSPASS');
  const [label, setLabel] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [spotsPerSession, setSpotsPerSession] = useState('1');
  const [payoutRate, setPayoutRate] = useState('0.00');
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    if (!studioId) return;
    setLoadError(undefined);
    try {
      const res = await apiRequest<PartnerConnectionDTO[]>('/partners/connections');
      setConnections(res);
    } catch (error) {
      setLoadError(error instanceof ApiError ? error.message : 'Partner bağlantıları yüklenemedi.');
    }
  }, [studioId]);

  useEffect(() => {
    load();
  }, [load]);

  if (!canManage) return <Redirect href="/(app)/hesabim" />;

  const handleToggle = async (connection: PartnerConnectionDTO, active: boolean) => {
    setSaveError(undefined);
    setTogglingId(connection.id);
    const previous = connections;
    const nextStatus = active ? 'ACTIVE' : 'PAUSED';
    setConnections((cur) => cur?.map((c) => (c.id === connection.id ? { ...c, status: nextStatus } : c)) ?? cur);
    try {
      await apiRequest(`/partners/connections/${connection.id}`, { method: 'PATCH', body: { status: nextStatus } });
    } catch (error) {
      setConnections(previous);
      setSaveError(error instanceof ApiError ? error.message : 'Değişiklik kaydedilemedi, tekrar deneyin.');
    } finally {
      setTogglingId(null);
    }
  };

  const handleCreate = async () => {
    setSaveError(undefined);
    if (!label.trim() || !webhookSecret.trim()) {
      setSaveError('Etiket ve webhook sırrı zorunludur.');
      return;
    }
    setCreating(true);
    try {
      await apiRequest('/partners/connections', {
        method: 'POST',
        body: {
          provider,
          label: label.trim(),
          credentials: { webhookSecret: webhookSecret.trim(), apiKey: apiKey.trim() || undefined },
          config: {
            spotsPerSession: Number(spotsPerSession) || 1,
            payoutRatePerVisit: payoutRate.trim() || '0.00',
          },
        },
      });
      setLabel('');
      setWebhookSecret('');
      setApiKey('');
      setSpotsPerSession('1');
      setPayoutRate('0.00');
      setShowForm(false);
      await load();
    } catch (error) {
      setSaveError(error instanceof ApiError ? error.message : 'Bağlantı oluşturulamadı.');
    } finally {
      setCreating(false);
    }
  };

  return (
    <ScreenContainer>
      <Text style={[styles.intro, { color: colors.textSecondary }]}>
        ClassPass, Urban Sports Club, Wellhub (Gympass) ve benzeri toplayıcı/pazaryeri platformlarını buradan
        bağlayın. Kimlik bilgileri yalnızca burada girilir, hiçbir zaman görüntülenmez.
      </Text>

      {loadError ? <Text style={styles.error}>{loadError}</Text> : null}
      {saveError ? <Text style={styles.error}>{saveError}</Text> : null}
      {!connections && !loadError ? <ActivityIndicator color={colors.textPrimary} /> : null}

      {connections?.map((connection) => (
        <View key={connection.id} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.cardHeader}>
            <View style={styles.cardHeaderText}>
              <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>{connection.label}</Text>
              <Text style={[styles.cardSubtitle, { color: colors.textMuted }]}>
                {PROVIDER_LABELS[connection.provider]}
                {connection.hasCredentials ? '' : ' · Kimlik bilgisi eksik'}
                {connection.consecutiveFailures > 0 ? ` · ${connection.consecutiveFailures} ardışık senkronizasyon hatası` : ''}
              </Text>
            </View>
            <SwitchRow
              label={`${connection.label} aktif`}
              value={connection.status === 'ACTIVE'}
              onValueChange={(value) => handleToggle(connection, value)}
              disabled={togglingId === connection.id}
            />
          </View>
          <View style={[styles.statsRow, { borderTopColor: colors.border }]}>
            <Text style={[styles.statText, { color: colors.textSecondary }]}>
              Seans başına kontenjan: {connection.config.spotsPerSession}
            </Text>
            <Text style={[styles.statText, { color: colors.textSecondary }]}>
              Ziyaret başı ödeme: {connection.config.payoutRatePerVisit} TRY
            </Text>
          </View>
        </View>
      ))}

      {showForm ? (
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.cardTitle, { color: colors.textPrimary, marginBottom: spacing[3] }]}>Yeni bağlantı</Text>

          <Text style={[styles.label, { color: colors.textSecondary }]}>Sağlayıcı</Text>
          <View style={styles.providerRow}>
            {PROVIDERS.map((p) => (
              <Text
                key={p}
                accessibilityRole="button"
                onPress={() => setProvider(p)}
                style={[
                  styles.providerChip,
                  {
                    borderColor: p === provider ? colors.textPrimary : colors.border,
                    color: p === provider ? colors.textPrimary : colors.textMuted,
                  },
                ]}
              >
                {PROVIDER_LABELS[p]}
              </Text>
            ))}
          </View>

          <TextField label="Etiket" value={label} onChangeText={setLabel} placeholder="Örn. ClassPass - Ana şube" />
          <TextField
            label="Webhook sırrı"
            value={webhookSecret}
            onChangeText={setWebhookSecret}
            secureTextEntry
            placeholder="Partnerin verdiği webhook imza sırrı"
          />
          <TextField label="API anahtarı (opsiyonel)" value={apiKey} onChangeText={setApiKey} secureTextEntry />
          <TextField
            label="Seans başına kontenjan"
            value={spotsPerSession}
            onChangeText={setSpotsPerSession}
            keyboardType="number-pad"
          />
          <TextField label="Ziyaret başı ödeme (TRY)" value={payoutRate} onChangeText={setPayoutRate} keyboardType="decimal-pad" />

          <PrimaryButton label="Bağlantıyı kaydet" onPress={handleCreate} loading={creating} />
        </View>
      ) : (
        <PrimaryButton label="Yeni partner bağlantısı ekle" onPress={() => setShowForm(true)} variant="secondary" />
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  intro: { fontSize: typography.size.sm, marginBottom: spacing[4] },
  error: { color: palette.danger, fontSize: typography.size.sm, marginBottom: spacing[3] },
  card: { borderWidth: 1, borderRadius: radii.md, padding: spacing[4], marginBottom: spacing[3] },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  cardHeaderText: { flex: 1, marginRight: spacing[3] },
  cardTitle: { fontSize: typography.size.md, fontWeight: typography.weight.semibold, marginBottom: spacing[1] },
  cardSubtitle: { fontSize: typography.size.xs },
  statsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2], marginTop: spacing[3], paddingTop: spacing[3], borderTopWidth: 1 },
  statText: { fontSize: typography.size.xs },
  label: { fontSize: typography.size.sm, fontWeight: typography.weight.medium, marginBottom: spacing[2] },
  providerRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2], marginBottom: spacing[3] },
  providerChip: {
    borderWidth: 1,
    borderRadius: radii.md,
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[3],
    fontSize: typography.size.xs,
    minHeight: 44,
    textAlignVertical: 'center',
  },
});
