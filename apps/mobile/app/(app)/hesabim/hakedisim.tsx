import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import type { PayrollLineDTO } from '@platform/shared';

import { ApiError, apiRequest } from '../../../src/lib/api';
import { useSession } from '../../../src/lib/session';
import { formatCurrency, useLocale, useT } from '../../../src/i18n';
import { borderWidth, palette, radii, spacing, typography, useTheme, useThemeFonts } from '../../../src/theme';
import { Text } from '../../../src/components/Text';


/** Trainer's own approved/paid commission lines, by payroll period (W14). */
export default function HakedisimScreen() {
  const { activeMembership } = useSession();
  const { locale } = useLocale();
  const t = useT();
  const currency = activeMembership?.currency ?? 'USD';
  const money = (v: string) => formatCurrency(Number(v), locale, currency, { maximumFractionDigits: 2 });
  const { theme } = useTheme();
  const fonts = useThemeFonts();
  const c = theme.colors;
  const studioId = activeMembership?.studioId;

  const [lines, setLines] = useState<PayrollLineDTO[] | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!studioId) return;
    setError(undefined);
    try {
      const rows = await apiRequest<PayrollLineDTO[]>(`/payroll/studio/${studioId}/me/lines`);
      setLines(rows);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('mPayroll.errors.commissionLoadFailed'));
    }
  }, [studioId]);

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
      <Text style={[styles.caption, fonts.body, { color: c.textSecondary }]}>{t('mPayroll.commissionCaption')}</Text>
      {!lines && !error ? <ActivityIndicator /> : null}
      {error ? <Text style={{ color: palette.danger }}>{error}</Text> : null}
      {lines && lines.length === 0 ? (
        <Text style={[styles.empty, fonts.body, { color: c.textMuted }]}>{t('mPayroll.noCommissionRecordsYet')}</Text>
      ) : null}

      {lines?.map((line) => (
        <View key={line.id} style={[styles.card, card, styles.bordered]}>
          <Text style={[styles.net, fonts.display, { color: c.textPrimary }]}>{money(line.netAmount)}</Text>
          <View style={styles.metrics}>
            <Metric label={t('mPayroll.metric.sessions')} value={String(line.sessions)} />
            <Metric label={t('mPayroll.metric.attendees')} value={String(line.attendees)} />
            <Metric label={t('mPayroll.metric.gross')} value={money(line.grossAmount)} />
            {line.adjustments !== '0.00' ? <Metric label={t('mPayroll.metric.adjustment')} value={money(line.adjustments)} /> : null}
          </View>
          {line.note ? <Text style={[styles.note, fonts.body, { color: c.textMuted }]}>{line.note}</Text> : null}
        </View>
      ))}
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
  empty: { fontSize: typography.size.md, marginTop: spacing[4] },
  card: { padding: spacing[4], gap: spacing[3] },
  bordered: { borderWidth: borderWidth },
  net: { fontSize: typography.size.xl, fontVariant: ['tabular-nums'] },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', rowGap: spacing[3] },
  metric: { width: '33%' },
  metricValue: { fontSize: typography.size.lg, fontVariant: ['tabular-nums'] },
  metricLabel: { fontSize: typography.size.xs, marginTop: 2 },
  note: { fontSize: typography.size.sm },
});
