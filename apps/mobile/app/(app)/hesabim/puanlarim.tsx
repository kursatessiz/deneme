import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { LOYALTY_ERROR_CODES, onGradient } from '@platform/shared';
import type { LoyaltyMemberSummaryDTO, LoyaltyRedeemResultDTO } from '@platform/shared';

import { GradientSurface } from '../../../src/components/GradientSurface';
import { withAlpha } from '../../../src/components/tones';
import { PrimaryButton } from '../../../src/components/PrimaryButton';
import { formatDate, useLocale, useT } from '../../../src/i18n';
import { ApiError, apiRequest } from '../../../src/lib/api';
import { useSession } from '../../../src/lib/session';
import { borderWidth, palette, radii, spacing, typography, useTheme, useThemeFonts } from '../../../src/theme';
import { Text } from '../../../src/components/Text';
import { showNotice } from '../../../src/lib/notice';

/** A fresh key per redemption attempt: a retried request never spends twice. */
function newKey(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** Member self-service loyalty screen (G3a): balance, rewards (redeem when the tenant allows it) and history. */
export default function PuanlarimScreen() {
  const t = useT();
  const { locale } = useLocale();
  const { activeMembership } = useSession();
  const { theme } = useTheme();
  const onBrand = onGradient(theme.gradient);
  const fonts = useThemeFonts();
  const c = theme.colors;
  const studioId = activeMembership?.studioId;

  const [summary, setSummary] = useState<LoyaltyMemberSummaryDTO | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [refreshing, setRefreshing] = useState(false);
  const [busyRewardId, setBusyRewardId] = useState<string | null>(null);

  const errorText = useCallback(
    (e: unknown) => {
      if (e instanceof ApiError && e.code && (LOYALTY_ERROR_CODES as readonly string[]).includes(e.code)) return t(`mLoyalty.error.${e.code}`);
      return t('mLoyalty.error.generic');
    },
    [t],
  );

  const load = useCallback(async () => {
    if (!studioId) return;
    setError(undefined);
    try {
      setSummary(await apiRequest<LoyaltyMemberSummaryDTO>(`/studios/${studioId}/loyalty/me`, { studioId }));
    } catch {
      setError(t('mLoyalty.loadFailed'));
    }
  }, [studioId, t]);

  useEffect(() => {
    load();
  }, [load]);

  const redeem = async (rewardId: string) => {
    if (!studioId) return;
    setBusyRewardId(rewardId);
    try {
      const result = await apiRequest<LoyaltyRedeemResultDTO>(`/studios/${studioId}/loyalty/me/redeem`, {
        method: 'POST',
        studioId,
        body: { rewardId, idempotencyKey: newKey() },
      });
      const code = result.redemption.promoCode;
      showNotice(t, t('mLoyalty.redeemed'), code ? t('mLoyalty.promoCode', { code }) : result.redemption.rewardName);
      await load();
    } catch (e) {
      showNotice(t, t('mLoyalty.redeemConfirmTitle'), errorText(e));
    } finally {
      setBusyRewardId(null);
    }
  };

  const confirmRedeem = (reward: LoyaltyMemberSummaryDTO['rewards'][number]) => {
    Alert.alert(t('mLoyalty.redeemConfirmTitle'), t('mLoyalty.redeemConfirmBody', { reward: reward.name, points: reward.costPoints }), [
      { text: t('mLoyalty.cancel'), style: 'cancel' },
      { text: t('mLoyalty.redeem'), onPress: () => redeem(reward.id) },
    ]);
  };

  const card = { backgroundColor: c.surface, borderColor: c.border, borderRadius: radii.md };

  return (
    <ScrollView
      style={{ backgroundColor: c.background }}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={async () => {
            setRefreshing(true);
            await load();
            setRefreshing(false);
          }}
        />
      }
    >
      {!summary && !error ? <ActivityIndicator /> : null}
      {error ? <Text style={[styles.error, { color: palette.danger }]}>{error}</Text> : null}

      {summary ? (
        <>
          <GradientSurface slot="memberCard" style={[styles.balanceCard, { borderRadius: radii.md }]}>
            <Text style={[styles.balanceLabel, fonts.body, { color: withAlpha(onBrand, 0.85) }]}>{t('mLoyalty.balance')}</Text>
            <Text style={[styles.balanceValue, fonts.display, { color: onBrand }]} accessibilityRole="header">
              {t('mLoyalty.points', { count: summary.balance })}
            </Text>
            {summary.nextExpiry ? (
              <Text style={[styles.balanceLabel, fonts.body, { color: withAlpha(onBrand, 0.85) }]}>
                {t('mLoyalty.nextExpiry', { points: summary.nextExpiry.points, date: formatDate(summary.nextExpiry.expiresAt, locale) })}
              </Text>
            ) : null}
          </GradientSurface>

          {!summary.enabled ? <Text style={[styles.note, fonts.body, { color: c.textMuted }]}>{t('mLoyalty.disabled')}</Text> : null}

          {summary.enabled ? (
            <View style={[styles.card, card, styles.bordered]}>
              <Text style={[styles.title, fonts.display, { color: c.textPrimary }]}>{t('mLoyalty.rewards')}</Text>
              {!summary.memberRedeemEnabled ? <Text style={[styles.note, fonts.body, { color: c.textMuted }]}>{t('mLoyalty.redeemAtDesk')}</Text> : null}
              {summary.rewards.length === 0 ? <Text style={[styles.note, fonts.body, { color: c.textMuted }]}>{t('mLoyalty.noRewards')}</Text> : null}
              {summary.rewards.map((reward) => (
                <View key={reward.id} style={[styles.rewardRow, { borderColor: c.border }]}>
                  <View style={styles.rewardText}>
                    <Text style={[fonts.bodyStrong, { color: c.textPrimary }]}>{reward.name}</Text>
                    <Text style={[styles.meta, fonts.body, { color: c.textMuted }]}>
                      {reward.affordable
                        ? t('mLoyalty.points', { count: reward.costPoints })
                        : t('mLoyalty.notEnough', { points: reward.costPoints - summary.balance })}
                    </Text>
                  </View>
                  {summary.memberRedeemEnabled && reward.affordable ? (
                    <PrimaryButton label={t('mLoyalty.redeem')} variant="secondary" loading={busyRewardId === reward.id} onPress={() => confirmRedeem(reward)} />
                  ) : null}
                </View>
              ))}
            </View>
          ) : null}

          <View style={[styles.card, card, styles.bordered]}>
            <Text style={[styles.title, fonts.display, { color: c.textPrimary }]}>{t('mLoyalty.history')}</Text>
            {summary.ledger.length === 0 ? <Text style={[styles.note, fonts.body, { color: c.textMuted }]}>{t('mLoyalty.noHistory')}</Text> : null}
            {summary.ledger.map((row) => (
              <View key={row.id} style={[styles.historyRow, { borderColor: c.border }]}>
                <View style={styles.rewardText}>
                  <Text style={[fonts.body, { color: c.textPrimary }]}>{t(`mLoyalty.reason.${row.reason}`)}</Text>
                  <Text style={[styles.meta, fonts.body, { color: c.textMuted }]}>{formatDate(row.createdAt, locale)}</Text>
                </View>
                <Text style={[fonts.bodyStrong, { color: row.delta < 0 ? palette.danger : c.textPrimary }]}>{row.delta > 0 ? `+${row.delta}` : String(row.delta)}</Text>
              </View>
            ))}
          </View>
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing[4], gap: spacing[4] },
  balanceCard: { padding: spacing[4], gap: spacing[1] },
  balanceLabel: { fontSize: typography.size.sm },
  balanceValue: { fontSize: typography.size.xl },
  card: { padding: spacing[4], gap: spacing[2] },
  bordered: { borderWidth: borderWidth },
  title: { fontSize: typography.size.lg, marginBottom: spacing[1] },
  note: { fontSize: typography.size.sm },
  rewardRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing[2], borderBottomWidth: borderWidth, paddingVertical: spacing[2] },
  rewardText: { flex: 1, gap: 2 },
  meta: { fontSize: typography.size.xs },
  historyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: borderWidth, paddingVertical: spacing[2] },
  error: { fontSize: typography.size.sm },
});
