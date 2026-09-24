import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { MembersReportDTO, OccupancyReportDTO, RenewalReportDTO, TrainerReportDTO } from '@platform/shared';

import { ApiError, apiRequest } from '../../../src/lib/api';
import { useSession } from '../../../src/lib/session';
import { palette, spacing, typography, useTheme, useThemeFonts } from '../../../src/theme';

const DAY = 24 * 60 * 60 * 1000;
const percent = (v: number) => `%${Math.round(v * 100)}`;
const money = (v: string) =>
  new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 0 }).format(Number(v));

/** Owner-only: last 30 days occupancy, revenue, renewal rate and top trainers. */
export default function RaporlarScreen() {
  const { activeMembership } = useSession();
  const { theme } = useTheme();
  const fonts = useThemeFonts();
  const c = theme.colors;
  const studioId = activeMembership?.studioId;

  const [occupancy, setOccupancy] = useState<OccupancyReportDTO | null>(null);
  const [members, setMembers] = useState<MembersReportDTO | null>(null);
  const [renewal, setRenewal] = useState<RenewalReportDTO | null>(null);
  const [trainers, setTrainers] = useState<TrainerReportDTO | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!studioId) return;
    setError(undefined);
    const to = new Date();
    const from = new Date(to.getTime() - 30 * DAY);
    const qs = `from=${from.toISOString()}&to=${to.toISOString()}`;
    try {
      const [occ, mem, ren, tr] = await Promise.all([
        apiRequest<OccupancyReportDTO>(`/reports/studio/${studioId}/occupancy?${qs}`),
        apiRequest<MembersReportDTO>(`/reports/studio/${studioId}/members?${qs}`),
        apiRequest<RenewalReportDTO>(`/reports/studio/${studioId}/renewal?${qs}`),
        apiRequest<TrainerReportDTO>(`/reports/studio/${studioId}/trainers?${qs}`),
      ]);
      setOccupancy(occ);
      setMembers(mem);
      setRenewal(ren);
      setTrainers(tr);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Raporlar yuklenemedi.');
    }
  }, [studioId]);

  useEffect(() => {
    load();
  }, [load]);

  const card = { backgroundColor: c.surface, borderColor: c.border, borderRadius: theme.family.radii.card };
  const avgOccupancy =
    occupancy && occupancy.byDay.length > 0
      ? occupancy.byDay.reduce((sum, d) => sum + d.occupancy, 0) / occupancy.byDay.length
      : 0;
  const topTrainers = trainers ? [...trainers.trainers].sort((a, b) => b.sessions - a.sessions).slice(0, 5) : [];

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
      <Text style={[styles.caption, fonts.body, { color: c.textSecondary }]}>Son 30 gun</Text>
      {!occupancy && !error ? <ActivityIndicator /> : null}
      {error ? <Text style={{ color: palette.danger }}>{error}</Text> : null}

      {occupancy ? (
        <View style={[styles.card, card, theme.family.cardBorder && styles.bordered]}>
          <Text style={[styles.title, fonts.display, { color: c.textPrimary }]}>Doluluk</Text>
          <Text style={[styles.bigValue, fonts.display, { color: c.textPrimary }]}>{percent(avgOccupancy)}</Text>
          <Bar ratio={avgOccupancy} />
        </View>
      ) : null}

      {members ? (
        <View style={[styles.card, card, theme.family.cardBorder && styles.bordered]}>
          <Text style={[styles.title, fonts.display, { color: c.textPrimary }]}>Gelir</Text>
          <Text style={[styles.bigValue, fonts.display, { color: c.textPrimary }]}>{money(members.revenue)}</Text>
          <View style={styles.metrics}>
            <Metric label="Aktif uye" value={String(members.activeMembers)} />
            <Metric label="Yeni uye" value={String(members.newMembers)} />
            <Metric label="Kaybedilen" value={String(members.churnedMembers)} />
            <Metric label="ARPU" value={money(members.arpu)} />
          </View>
        </View>
      ) : null}

      {renewal ? (
        <View style={[styles.card, card, theme.family.cardBorder && styles.bordered]}>
          <Text style={[styles.title, fonts.display, { color: c.textPrimary }]}>Yenileme orani</Text>
          <Text style={[styles.bigValue, fonts.display, { color: c.textPrimary }]}>{percent(renewal.renewalRate)}</Text>
          <Bar ratio={renewal.renewalRate} />
          <Text style={[styles.caption, fonts.body, { color: c.textMuted, marginTop: spacing[2] }]}>
            {renewal.renewedPackages} / {renewal.expiredPackages} paket yenilendi
          </Text>
        </View>
      ) : null}

      {topTrainers.length > 0 ? (
        <View style={[styles.card, card, theme.family.cardBorder && styles.bordered]}>
          <Text style={[styles.title, fonts.display, { color: c.textPrimary }]}>En yogun 5 egitmen</Text>
          {topTrainers.map((t) => (
            <View key={t.trainerProfileId} style={styles.trainerRow}>
              <Text style={[fonts.bodyStrong, styles.trainerName, { color: c.textPrimary }]} numberOfLines={1}>
                {t.trainerName}
              </Text>
              <View style={styles.trainerBarWrap}>
                <Bar ratio={t.occupancy} />
              </View>
              <Text style={[fonts.body, styles.trainerValue, { color: c.textSecondary }]}>{t.sessions} seans</Text>
            </View>
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}

/** Simple bar sized by ratio (0..1), no chart library. */
function Bar({ ratio }: { ratio: number }) {
  const { theme } = useTheme();
  const c = theme.colors;
  const clamped = Math.max(0, Math.min(1, ratio));
  return (
    <View style={[styles.barTrack, { backgroundColor: c.border }]}>
      <View style={[styles.barFill, { width: `${clamped * 100}%`, backgroundColor: c.primary }]} />
    </View>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  const { theme } = useTheme();
  const fonts = useThemeFonts();
  return (
    <View style={styles.metric}>
      <Text style={[styles.metricValue, fonts.bodyStrong, { color: theme.colors.textPrimary }]}>{value}</Text>
      <Text style={[styles.metricLabel, fonts.body, { color: theme.colors.textMuted }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing[4], gap: spacing[3] },
  caption: { fontSize: typography.size.sm },
  card: { padding: spacing[4] },
  bordered: { borderWidth: 1 },
  title: { fontSize: typography.size.lg, marginBottom: spacing[2] },
  bigValue: { fontSize: typography.size.xl, marginBottom: spacing[2], fontVariant: ['tabular-nums'] },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', rowGap: spacing[3], marginTop: spacing[3] },
  metric: { width: '50%' },
  metricValue: { fontSize: typography.size.lg, fontVariant: ['tabular-nums'] },
  metricLabel: { fontSize: typography.size.xs, marginTop: 2 },
  barTrack: { height: 8, borderRadius: 4, overflow: 'hidden' },
  barFill: { height: 8, borderRadius: 4 },
  trainerRow: { marginTop: spacing[3] },
  trainerName: { fontSize: typography.size.sm, marginBottom: spacing[1] },
  trainerBarWrap: { marginBottom: spacing[1] },
  trainerValue: { fontSize: typography.size.xs },
});
