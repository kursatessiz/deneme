import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { PayrollRunDTO } from '@platform/shared';

import { PrimaryButton } from '../../../src/components/PrimaryButton';
import { ApiError, apiRequest } from '../../../src/lib/api';
import { useSession } from '../../../src/lib/session';
import { palette, spacing, typography, useTheme, useThemeFonts } from '../../../src/theme';

const money = (v: string) =>
  new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 2 }).format(Number(v));

const dateRange = (isoStart: string, isoEnd: string) => {
  const fmt = new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: 'long', year: 'numeric' });
  const end = new Date(new Date(isoEnd).getTime() - 24 * 3600_000);
  return `${fmt.format(new Date(isoStart))} - ${fmt.format(end)}`;
};

const STATUS_LABEL: Record<PayrollRunDTO['status'], string> = {
  DRAFT: 'Taslak',
  APPROVED: 'Onaylandı',
  PAID: 'Ödendi',
};

/** Owner/reception: payroll runs for the studio, with approve and mark-paid actions (W14). */
export default function BordroScreen() {
  const { activeMembership } = useSession();
  const { theme } = useTheme();
  const fonts = useThemeFonts();
  const c = theme.colors;
  const studioId = activeMembership?.studioId;
  const canManage = activeMembership?.permissions.includes('payroll.manage') ?? false;

  const [runs, setRuns] = useState<PayrollRunDTO[] | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [refreshing, setRefreshing] = useState(false);
  const [busyRunId, setBusyRunId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!studioId) return;
    setError(undefined);
    try {
      const rows = await apiRequest<PayrollRunDTO[]>(`/payroll/studio/${studioId}/runs`);
      setRuns(rows);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Bordro dönemleri yüklenemedi.');
    }
  }, [studioId]);

  useEffect(() => {
    load();
  }, [load]);

  const approve = async (runId: string) => {
    if (!studioId) return;
    setBusyRunId(runId);
    try {
      await apiRequest(`/payroll/studio/${studioId}/runs/${runId}/approve`, { method: 'POST' });
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Bordro onaylanamadı.');
    } finally {
      setBusyRunId(null);
    }
  };

  const markPaid = async (runId: string) => {
    if (!studioId) return;
    setBusyRunId(runId);
    try {
      await apiRequest(`/payroll/studio/${studioId}/runs/${runId}/mark-paid`, { method: 'POST' });
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Bordro ödendi olarak işaretlenemedi.');
    } finally {
      setBusyRunId(null);
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
      <Text style={[styles.caption, fonts.body, { color: c.textSecondary }]}>Eğitmen hakediş bordro dönemleri.</Text>
      {!runs && !error ? <ActivityIndicator /> : null}
      {error ? <Text style={{ color: palette.danger }}>{error}</Text> : null}
      {runs && runs.length === 0 ? (
        <Text style={[styles.empty, fonts.body, { color: c.textMuted }]}>Henüz bir bordro dönemi oluşturulmadı.</Text>
      ) : null}

      {runs?.map((run) => (
        <View key={run.id} style={[styles.card, card, theme.family.cardBorder && styles.bordered]}>
          <View style={styles.headerRow}>
            <Text style={[styles.period, fonts.display, { color: c.textPrimary }]}>{dateRange(run.periodStart, run.periodEnd)}</Text>
            <Text style={[styles.status, fonts.bodyStrong, { color: statusColor(run.status, c) }]}>{STATUS_LABEL[run.status]}</Text>
          </View>
          <Text style={[styles.net, fonts.display, { color: c.textPrimary }]}>{money(run.totalNet)}</Text>

          {canManage && run.status === 'DRAFT' ? (
            <PrimaryButton label="Onayla" onPress={() => approve(run.id)} loading={busyRunId === run.id} />
          ) : null}

          {canManage && run.status === 'APPROVED' ? (
            <PrimaryButton label="Ödendi olarak işaretle" onPress={() => markPaid(run.id)} loading={busyRunId === run.id} />
          ) : null}
        </View>
      ))}
    </ScrollView>
  );
}

function statusColor(status: PayrollRunDTO['status'], c: { textMuted: string; textPrimary: string }): string {
  if (status === 'PAID') return palette.success;
  if (status === 'APPROVED') return c.textPrimary;
  return c.textMuted;
}

const styles = StyleSheet.create({
  content: { padding: spacing[4], gap: spacing[3] },
  caption: { fontSize: typography.size.sm },
  empty: { fontSize: typography.size.md, marginTop: spacing[4] },
  card: { padding: spacing[4], gap: spacing[3] },
  bordered: { borderWidth: 1 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  period: { fontSize: typography.size.md },
  status: { fontSize: typography.size.sm },
  net: { fontSize: typography.size.xl, fontVariant: ['tabular-nums'] },
});
