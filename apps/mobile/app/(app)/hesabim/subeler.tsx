import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { BranchSummaryDTO, PortfolioSummaryDTO } from '@platform/shared';

import { ApiError, apiRequest } from '../../../src/lib/api';
import { useSession } from '../../../src/lib/session';
import { palette, spacing, typography, useTheme, useThemeFonts } from '../../../src/theme';

const percent = (v: number) => `%${Math.round(v * 100)}`;
const money = (v: string) =>
  new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 0 }).format(Number(v));

/** Last 30 days per branch, and across businesses when the user runs more than one. */
export default function SubelerScreen() {
  const { activeMembership, memberships } = useSession();
  const { theme } = useTheme();
  const fonts = useThemeFonts();
  const c = theme.colors;
  const studioId = activeMembership?.studioId;

  const [rows, setRows] = useState<BranchSummaryDTO[] | null>(null);
  const [portfolio, setPortfolio] = useState<PortfolioSummaryDTO | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!studioId) return;
    setError(undefined);
    try {
      const [summary, all] = await Promise.all([
        apiRequest<BranchSummaryDTO[]>(`/branches/studio/${studioId}/summary`),
        memberships.length > 1 ? apiRequest<PortfolioSummaryDTO>('/portfolio/summary') : Promise.resolve(null),
      ]);
      setRows(summary);
      setPortfolio(all && all.studios.length > 1 ? all : null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Özet yüklenemedi.');
    }
  }, [studioId, memberships.length]);

  useEffect(() => {
    load();
  }, [load]);

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
      <Text style={[styles.caption, fonts.body, { color: c.textSecondary }]}>Son 30 gün</Text>
      {!rows && !error ? <ActivityIndicator /> : null}
      {error ? <Text style={{ color: palette.danger }}>{error}</Text> : null}

      {rows?.map((r) => (
        <View key={r.branchId ?? 'none'} style={[styles.card, card, theme.family.cardBorder && styles.bordered]}>
          <Text style={[styles.title, fonts.display, { color: c.textPrimary }]}>{r.branchName}</Text>
          <View style={styles.metrics}>
            <Metric label="Doluluk" value={percent(r.occupancy)} />
            <Metric label="Seans" value={String(r.sessions)} />
            <Metric label="Katılım" value={String(r.attended)} />
            <Metric label="Gelmedi" value={String(r.noShows)} />
            <Metric label="Gelir" value={money(r.revenue)} />
            <Metric label="Üye" value={String(r.homeMembers)} />
          </View>
        </View>
      ))}

      {portfolio ? (
        <>
          <Text style={[styles.section, fonts.bodyStrong, { color: c.textSecondary }]}>Tüm işletmelerim</Text>
          {portfolio.studios.map((s) => (
            <View key={s.studioId} style={[styles.card, card, theme.family.cardBorder && styles.bordered]}>
              <Text style={[styles.title, fonts.display, { color: c.textPrimary }]}>{s.studioName}</Text>
              <View style={styles.metrics}>
                <Metric label="Şube" value={String(s.branchCount)} />
                <Metric label="Aktif üye" value={String(s.activeMembers)} />
                <Metric label="Doluluk" value={percent(s.occupancy)} />
                <Metric label="Gelir" value={money(s.revenue)} />
              </View>
            </View>
          ))}
        </>
      ) : null}
    </ScrollView>
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
  section: { fontSize: typography.size.sm, marginTop: spacing[4] },
  card: { padding: spacing[4] },
  bordered: { borderWidth: 1 },
  title: { fontSize: typography.size.lg, marginBottom: spacing[3] },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', rowGap: spacing[3] },
  metric: { width: '33%' },
  metricValue: { fontSize: typography.size.lg, fontVariant: ['tabular-nums'] },
  metricLabel: { fontSize: typography.size.xs, marginTop: 2 },
});
