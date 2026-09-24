import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { PayrollLineDTO } from '@platform/shared';

import { ApiError, apiRequest } from '../../../src/lib/api';
import { useSession } from '../../../src/lib/session';
import { palette, spacing, typography, useTheme, useThemeFonts } from '../../../src/theme';

const money = (v: string) =>
  new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 2 }).format(Number(v));

/** Trainer's own approved/paid commission lines, by payroll period (W14). */
export default function HakedisimScreen() {
  const { activeMembership } = useSession();
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
      setError(e instanceof ApiError ? e.message : 'Hakediş bilgisi yüklenemedi.');
    }
  }, [studioId]);

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
      <Text style={[styles.caption, fonts.body, { color: c.textSecondary }]}>
        Onaylanmış ve ödenmiş bordro dönemlerindeki hakedişiniz.
      </Text>
      {!lines && !error ? <ActivityIndicator /> : null}
      {error ? <Text style={{ color: palette.danger }}>{error}</Text> : null}
      {lines && lines.length === 0 ? (
        <Text style={[styles.empty, fonts.body, { color: c.textMuted }]}>Henüz onaylanmış bir hakediş kaydınız yok.</Text>
      ) : null}

      {lines?.map((line) => (
        <View key={line.id} style={[styles.card, card, theme.family.cardBorder && styles.bordered]}>
          <Text style={[styles.net, fonts.display, { color: c.textPrimary }]}>{money(line.netAmount)}</Text>
          <View style={styles.metrics}>
            <Metric label="Seans" value={String(line.sessions)} />
            <Metric label="Katılımcı" value={String(line.attendees)} />
            <Metric label="Brüt" value={money(line.grossAmount)} />
            {line.adjustments !== '0.00' ? <Metric label="Düzeltme" value={money(line.adjustments)} /> : null}
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
  bordered: { borderWidth: 1 },
  net: { fontSize: typography.size.xl, fontVariant: ['tabular-nums'] },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', rowGap: spacing[3] },
  metric: { width: '33%' },
  metricValue: { fontSize: typography.size.lg, fontVariant: ['tabular-nums'] },
  metricLabel: { fontSize: typography.size.xs, marginTop: 2 },
  note: { fontSize: typography.size.sm },
});
