import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, Share, StyleSheet, Text, View } from 'react-native';

import type { ReferralCodeDTO, ReferralDTO } from '@platform/shared';

import { PrimaryButton } from '../../../src/components/PrimaryButton';
import { ApiError, apiRequest } from '../../../src/lib/api';
import { useSession } from '../../../src/lib/session';
import { palette, spacing, typography, useTheme, useThemeFonts } from '../../../src/theme';

const STATUS_LABELS: Record<ReferralDTO['status'], string> = {
  PENDING: 'Beklemede',
  QUALIFIED: 'Onaylandı',
  REWARDED: 'Ödül verildi',
  VOIDED: 'İptal edildi',
};

function statusColor(status: ReferralDTO['status']): string {
  switch (status) {
    case 'REWARDED':
      return palette.success;
    case 'QUALIFIED':
      return palette.warning;
    case 'VOIDED':
      return palette.danger;
    default:
      return palette.ink[500];
  }
}

/** "Arkadaşını getir": own code, share action and referral status list. */
export default function ArkadasiniGetirScreen() {
  const { activeMembership } = useSession();
  const { theme } = useTheme();
  const fonts = useThemeFonts();
  const c = theme.colors;
  const studioId = activeMembership?.studioId;

  const [code, setCode] = useState<ReferralCodeDTO | null>(null);
  const [referrals, setReferrals] = useState<ReferralDTO[] | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!studioId) return;
    setError(undefined);
    try {
      const [codeRes, referralsRes] = await Promise.all([
        apiRequest<ReferralCodeDTO>(`/referrals/studio/${studioId}/me/code`),
        apiRequest<ReferralDTO[]>(`/referrals/studio/${studioId}/me`),
      ]);
      setCode(codeRes);
      setReferrals(referralsRes);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Tavsiye bilgisi yüklenemedi.');
    }
  }, [studioId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleShare = async () => {
    if (!code) return;
    try {
      await Share.share({ message: code.shareText });
    } catch {
      // Share sheet dismissed or unavailable: nothing to do.
    }
  };

  const card = { backgroundColor: c.surface, borderColor: c.border, borderRadius: theme.family.radii.card };

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
      <Text style={[styles.title, fonts.display, { color: c.textPrimary }]}>Arkadaşını getir</Text>
      <Text style={[styles.subtitle, fonts.body, { color: c.textSecondary }]}>
        Kodunu arkadaşlarınla paylaş; kaydolduklarında ikiniz de kazanırsınız.
      </Text>

      {!code && !error ? <ActivityIndicator /> : null}
      {error ? <Text style={{ color: palette.danger }}>{error}</Text> : null}

      {code ? (
        <View style={[styles.card, card, theme.family.cardBorder && styles.bordered]}>
          <Text style={[styles.codeLabel, fonts.body, { color: c.textSecondary }]}>Kodunuz</Text>
          <Text style={[styles.code, fonts.display, { color: c.textPrimary }]}>{code.code}</Text>
          <PrimaryButton label="Paylaş" onPress={handleShare} />
        </View>
      ) : null}

      <Text style={[styles.sectionTitle, fonts.bodyStrong, { color: c.textSecondary }]}>Tavsiyelerim</Text>
      {referrals && referrals.length === 0 ? (
        <Text style={[styles.empty, fonts.body, { color: c.textMuted }]}>Henüz bir tavsiyeniz yok.</Text>
      ) : null}
      {referrals?.map((r) => (
        <View key={r.id} style={[styles.referralRow, card, theme.family.cardBorder && styles.bordered]}>
          <View style={styles.referralInfo}>
            <Text style={[styles.referralName, fonts.bodyStrong, { color: c.textPrimary }]}>{r.referredName}</Text>
            <Text style={[styles.referralDate, fonts.body, { color: c.textMuted }]}>
              {new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(r.createdAt))}
            </Text>
          </View>
          <Text style={[styles.statusBadge, fonts.bodyStrong, { color: statusColor(r.status) }]}>{STATUS_LABELS[r.status]}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing[4], gap: spacing[3] },
  title: { fontSize: typography.size.xl, marginBottom: spacing[1] },
  subtitle: { fontSize: typography.size.sm, marginBottom: spacing[2] },
  card: { padding: spacing[4], gap: spacing[3], alignItems: 'center' },
  bordered: { borderWidth: 1 },
  codeLabel: { fontSize: typography.size.sm },
  code: { fontSize: typography.size['2xl'], letterSpacing: 4, fontVariant: ['tabular-nums'] },
  sectionTitle: { fontSize: typography.size.sm, marginTop: spacing[3] },
  empty: { fontSize: typography.size.md },
  referralRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: spacing[4] },
  referralInfo: { flex: 1 },
  referralName: { fontSize: typography.size.md },
  referralDate: { fontSize: typography.size.xs, marginTop: 2 },
  statusBadge: { fontSize: typography.size.sm },
});
