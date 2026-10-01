import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import type { BranchSummaryDTO, PortfolioSummaryDTO } from '@platform/shared';

import { ApiError, apiRequest } from '../../../src/lib/api';
import { useSession } from '../../../src/lib/session';
import { formatCurrency, useLocale, useT } from '../../../src/i18n';
import { borderWidth, palette, radii, spacing, typography, useTheme, useThemeFonts } from '../../../src/theme';
import { Text } from '../../../src/components/Text';

const percent = (v: number) => `%${Math.round(v * 100)}`;

/** Last 30 days per branch, and across businesses when the user runs more than one. */
export default function SubelerScreen() {
  const { activeMembership, memberships } = useSession();
  const { locale } = useLocale();
  const t = useT();
  const currency = activeMembership?.currency ?? 'USD';
  const money = (v: string) => formatCurrency(Number(v), locale, currency, { maximumFractionDigits: 0 });
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
      setError(e instanceof ApiError ? e.message : t('mBranchSummary.errors.loadFailed'));
    }
  }, [studioId, memberships.length]);

  useEffect(() => {
    load();
  }, [load]);

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
      <Text style={[styles.caption, fonts.body, { color: c.textSecondary }]}>{t('mBranchSummary.last30Days')}</Text>
      {!rows && !error ? <ActivityIndicator /> : null}
      {error ? <Text style={{ color: palette.danger }}>{error}</Text> : null}

      {rows?.map((r) => (
        <View key={r.branchId ?? 'none'} style={[styles.card, card, styles.bordered]}>
          <Text style={[styles.title, fonts.display, { color: c.textPrimary }]}>{r.branchName}</Text>
          <View style={styles.metrics}>
            <Metric label={t('mBranchSummary.metric.occupancy')} value={percent(r.occupancy)} />
            <Metric label={t('mBranchSummary.metric.sessions')} value={String(r.sessions)} />
            <Metric label={t('mBranchSummary.metric.attended')} value={String(r.attended)} />
            <Metric label={t('mBranchSummary.metric.noShows')} value={String(r.noShows)} />
            <Metric label={t('mBranchSummary.metric.revenue')} value={money(r.revenue)} />
            <Metric label={t('mBranchSummary.metric.members')} value={String(r.homeMembers)} />
          </View>
        </View>
      ))}

      {portfolio ? (
        <>
          <Text style={[styles.section, fonts.bodyStrong, { color: c.textSecondary }]}>{t('mBranchSummary.allMyBusinesses')}</Text>
          {portfolio.studios.map((s) => (
            <View key={s.studioId} style={[styles.card, card, styles.bordered]}>
              <Text style={[styles.title, fonts.display, { color: c.textPrimary }]}>{s.studioName}</Text>
              <View style={styles.metrics}>
                <Metric label={t('mBranchSummary.metric.branches')} value={String(s.branchCount)} />
                <Metric label={t('mBranchSummary.metric.activeMembers')} value={String(s.activeMembers)} />
                <Metric label={t('mBranchSummary.metric.occupancy')} value={percent(s.occupancy)} />
                <Metric label={t('mBranchSummary.metric.revenue')} value={money(s.revenue)} />
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
  bordered: { borderWidth: borderWidth },
  title: { fontSize: typography.size.lg, marginBottom: spacing[3] },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', rowGap: spacing[3] },
  metric: { width: '33%' },
  metricValue: { fontSize: typography.size.lg, fontVariant: ['tabular-nums'] },
  metricLabel: { fontSize: typography.size.xs, marginTop: 2 },
});
