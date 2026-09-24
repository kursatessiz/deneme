import * as Clipboard from 'expo-clipboard';
import { Redirect } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { API_KEY_SCOPES } from '@platform/shared';
import type { ApiKeyScope, WebhookEvent } from '@platform/shared';

import { PrimaryButton } from '../../../src/components/PrimaryButton';
import { ScreenContainer } from '../../../src/components/ScreenContainer';
import { ApiError, apiRequest } from '../../../src/lib/api';
import { useSession } from '../../../src/lib/session';
import { palette, radii, spacing, typography, useThemeColors } from '../../../src/theme';

interface ApiKeySummary {
  id: string;
  name: string;
  prefix: string;
  scopes: ApiKeyScope[];
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

interface WebhookEndpointSummary {
  id: string;
  url: string;
  events: WebhookEvent[];
  isActive: boolean;
  failureCount: number;
}

const SCOPE_KEYS = Object.keys(API_KEY_SCOPES) as ApiKeyScope[];

function ScopeToggle({ scope, selected, onToggle }: { scope: ApiKeyScope; selected: boolean; onToggle: () => void }) {
  const colors = useThemeColors();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      onPress={onToggle}
      style={[
        styles.scopeChip,
        { borderColor: selected ? colors.primary : colors.border, backgroundColor: selected ? colors.primary : 'transparent' },
      ]}
    >
      <Text style={[styles.scopeChipText, { color: selected ? colors.onPrimary : colors.textSecondary }]}>
        {API_KEY_SCOPES[scope]}
      </Text>
    </Pressable>
  );
}

/**
 * Owner screen for W18 (open platform): API keys and webhooks for the
 * studio's own integrations. New key secrets and rotated webhook secrets
 * are shown exactly once, matching the takvim.tsx calendar-feed pattern.
 */
export default function EntegrasyonlarScreen() {
  const colors = useThemeColors();
  const { activeMembership } = useSession();
  const studioId = activeMembership?.studioId;
  const canManage = activeMembership?.permissions.includes('integrations.manage') ?? false;

  const [apiKeys, setApiKeys] = useState<ApiKeySummary[] | null>(null);
  const [webhooks, setWebhooks] = useState<WebhookEndpointSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | undefined>();

  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyScopes, setNewKeyScopes] = useState<Set<ApiKeyScope>>(new Set());
  const [creating, setCreating] = useState(false);
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [formError, setFormError] = useState<string | undefined>();

  const load = useCallback(async () => {
    if (!studioId) return;
    setLoadError(undefined);
    try {
      const [keys, hooks] = await Promise.all([
        apiRequest<ApiKeySummary[]>('/integrations/api-keys', { studioId }),
        apiRequest<WebhookEndpointSummary[]>('/integrations/webhooks', { studioId }),
      ]);
      setApiKeys(keys);
      setWebhooks(hooks);
    } catch (error) {
      setLoadError(error instanceof ApiError ? error.message : 'Entegrasyonlar yüklenemedi.');
    }
  }, [studioId]);

  useEffect(() => {
    load();
  }, [load]);

  if (!canManage) return <Redirect href="/(app)/hesabim" />;

  const toggleScope = (scope: ApiKeyScope) => {
    setNewKeyScopes((current) => {
      const next = new Set(current);
      if (next.has(scope)) next.delete(scope);
      else next.add(scope);
      return next;
    });
  };

  const createKey = async () => {
    if (!studioId || newKeyName.trim().length < 2 || newKeyScopes.size === 0) {
      setFormError('Anahtar adı ve en az bir yetki alanı gerekli.');
      return;
    }
    setCreating(true);
    setFormError(undefined);
    setCopied(false);
    try {
      const result = await apiRequest<ApiKeySummary & { plaintext: string }>('/integrations/api-keys', {
        method: 'POST',
        studioId,
        body: { name: newKeyName.trim(), scopes: Array.from(newKeyScopes) },
      });
      setCreatedSecret(result.plaintext);
      setNewKeyName('');
      setNewKeyScopes(new Set());
      await load();
    } catch (error) {
      setFormError(error instanceof ApiError ? error.message : 'Anahtar oluşturulamadı.');
    } finally {
      setCreating(false);
    }
  };

  const revokeKey = async (id: string) => {
    if (!studioId) return;
    try {
      await apiRequest(`/integrations/api-keys/${id}`, { method: 'DELETE', studioId });
      await load();
    } catch (error) {
      setLoadError(error instanceof ApiError ? error.message : 'Anahtar iptal edilemedi.');
    }
  };

  const copySecret = async () => {
    if (!createdSecret) return;
    await Clipboard.setStringAsync(createdSecret);
    setCopied(true);
  };

  return (
    <ScreenContainer>
      <Text style={[styles.title, { color: colors.textPrimary }]}>Entegrasyonlar</Text>
      <Text style={[styles.description, { color: colors.textSecondary }]}>
        Herkese açık rezervasyon API'sini kullanacak entegrasyonlar için API anahtarı oluşturun ve webhook uç
        noktalarınızın durumunu görüntüleyin. Ayrıntılar için docs/PUBLIC_API.md dosyasına bakın.
      </Text>

      {loadError ? <Text style={styles.errorText}>{loadError}</Text> : null}

      <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>API anahtarları</Text>

      {createdSecret ? (
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.primary }]}>
          <Text style={[styles.secretLabel, { color: colors.textSecondary }]}>
            Bu anahtar yalnızca şimdi gösterilir, tekrar görüntülenemez.
          </Text>
          <Text style={[styles.secretValue, { color: colors.textPrimary }]} selectable>
            {createdSecret}
          </Text>
          <PrimaryButton label={copied ? 'Kopyalandı' : 'Anahtarı kopyala'} onPress={copySecret} variant="secondary" />
        </View>
      ) : null}

      {!apiKeys && !loadError ? <ActivityIndicator color={colors.textPrimary} /> : null}

      {apiKeys?.map((key) => (
        <View key={key.id} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.cardHeader}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>{key.name}</Text>
              <Text style={[styles.cardSubtitle, { color: colors.textMuted }]}>
                pk_live_{key.prefix}_**** · {key.scopes.length} yetki alanı
              </Text>
              {key.revokedAt ? <Text style={[styles.badge, { color: palette.danger }]}>İptal edildi</Text> : null}
            </View>
            {!key.revokedAt ? (
              <Pressable accessibilityRole="button" onPress={() => revokeKey(key.id)}>
                <Text style={{ color: palette.danger, fontSize: typography.size.sm }}>İptal et</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      ))}

      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.cardTitle, { color: colors.textPrimary, marginBottom: spacing[2] }]}>Yeni anahtar</Text>
        <TextInput
          value={newKeyName}
          onChangeText={setNewKeyName}
          placeholder="Anahtar adı (ör. Web sitesi widget'ı)"
          placeholderTextColor={colors.textMuted}
          style={[styles.input, { borderColor: colors.border, color: colors.textPrimary }]}
        />
        <View style={styles.scopeList}>
          {SCOPE_KEYS.map((scope) => (
            <ScopeToggle key={scope} scope={scope} selected={newKeyScopes.has(scope)} onToggle={() => toggleScope(scope)} />
          ))}
        </View>
        {formError ? <Text style={styles.errorText}>{formError}</Text> : null}
        <PrimaryButton label="Anahtar oluştur" onPress={createKey} loading={creating} />
      </View>

      <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>Webhook uç noktaları</Text>
      {webhooks?.length === 0 ? (
        <Text style={[styles.description, { color: colors.textSecondary }]}>
          Henüz webhook uç noktası tanımlanmamış. Webhook eklemek için işletme panelini kullanın.
        </Text>
      ) : null}
      {webhooks?.map((hook) => (
        <View key={hook.id} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.cardTitle, { color: colors.textPrimary }]} numberOfLines={1}>
            {hook.url}
          </Text>
          <Text style={[styles.cardSubtitle, { color: colors.textMuted }]}>{hook.events.length} olay</Text>
          <Text
            style={[
              styles.badge,
              { color: hook.isActive ? palette.success : palette.danger },
            ]}
          >
            {hook.isActive ? 'Aktif' : 'Pasif'}
            {hook.failureCount > 0 ? ` · ${hook.failureCount} ardışık hata` : ''}
          </Text>
        </View>
      ))}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: typography.size.xl,
    fontWeight: typography.weight.bold,
    marginBottom: spacing[2],
  },
  description: {
    fontSize: typography.size.sm,
    marginBottom: spacing[4],
  },
  sectionTitle: {
    fontSize: typography.size.md,
    fontWeight: typography.weight.semibold,
    marginTop: spacing[4],
    marginBottom: spacing[2],
  },
  errorText: {
    color: palette.danger,
    fontSize: typography.size.sm,
    marginBottom: spacing[3],
  },
  card: {
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing[4],
    marginBottom: spacing[3],
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  cardTitle: {
    fontSize: typography.size.md,
    fontWeight: typography.weight.semibold,
  },
  cardSubtitle: {
    fontSize: typography.size.xs,
    marginTop: spacing[1],
  },
  badge: {
    fontSize: typography.size.xs,
    fontWeight: typography.weight.medium,
    marginTop: spacing[1],
  },
  secretLabel: {
    fontSize: typography.size.xs,
    marginBottom: spacing[1],
  },
  secretValue: {
    fontSize: typography.size.sm,
    fontFamily: 'monospace',
    marginBottom: spacing[3],
  },
  input: {
    borderWidth: 1,
    borderRadius: radii.sm,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    fontSize: typography.size.sm,
    marginBottom: spacing[3],
  },
  scopeList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[2],
    marginBottom: spacing[3],
  },
  scopeChip: {
    borderWidth: 1,
    borderRadius: radii.sm,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
  },
  scopeChipText: {
    fontSize: typography.size.xs,
    fontWeight: typography.weight.medium,
  },
});
