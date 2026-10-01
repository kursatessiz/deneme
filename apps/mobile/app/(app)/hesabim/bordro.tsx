import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import type { PayrollRunDTO } from '@platform/shared';

import { PrimaryButton } from '../../../src/components/PrimaryButton';
import { ApiError, apiRequest } from '../../../src/lib/api';
import { useSession } from '../../../src/lib/session';
import { formatCurrency, useLocale, useT } from '../../../src/i18n';
import { borderWidth, palette, radii, spacing, typography, useTheme, useThemeFonts } from '../../../src/theme';
import type { Translate } from '@platform/shared';
import { Text } from '../../../src/components/Text';


const dateRange = (isoStart: string, isoEnd: string, locale: string) => {
  const fmt = new Intl.DateTimeFormat(locale, { day: '2-digit', month: 'long', year: 'numeric' });
  const end = new Date(new Date(isoEnd).getTime() - 24 * 3600_000);
  return `${fmt.format(new Date(isoStart))} - ${fmt.format(end)}`;
};

function statusLabels(t: Translate): Record<PayrollRunDTO['status'], string> {
  return {
    DRAFT: t('mPayroll.status.draft'),
    APPROVED: t('mPayroll.status.approved'),
    PAID: t('mPayroll.status.paid'),
  };
}

/** Owner/reception: payroll runs for the studio, with approve and mark-paid actions (W14). */
export default function BordroScreen() {
  const { activeMembership } = useSession();
  const { locale } = useLocale();
  const t = useT();
  const STATUS_LABEL = statusLabels(t);
  const currency = activeMembership?.currency ?? 'USD';
  const money = (v: string) => formatCurrency(Number(v), locale, currency, { maximumFractionDigits: 2 });
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
      setError(e instanceof ApiError ? e.message : t('mPayroll.errors.loadFailed'));
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
      setError(e instanceof ApiError ? e.message : t('mPayroll.errors.approveFailed'));
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
      setError(e instanceof ApiError ? e.message : t('mPayroll.errors.markPaidFailed'));
    } finally {
      setBusyRunId(null);
    }
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
      <Text style={[styles.caption, fonts.body, { color: c.textSecondary }]}>{t('mPayroll.caption')}</Text>
      {!runs && !error ? <ActivityIndicator /> : null}
      {error ? <Text style={{ color: palette.danger }}>{error}</Text> : null}
      {runs && runs.length === 0 ? (
        <Text style={[styles.empty, fonts.body, { color: c.textMuted }]}>{t('mPayroll.noRunsYet')}</Text>
      ) : null}

      {runs?.map((run) => (
        <View key={run.id} style={[styles.card, card, styles.bordered]}>
          <View style={styles.headerRow}>
            <Text style={[styles.period, fonts.display, { color: c.textPrimary }]}>{dateRange(run.periodStart, run.periodEnd, locale)}</Text>
            <Text style={[styles.status, fonts.bodyStrong, { color: statusColor(run.status, c) }]}>{STATUS_LABEL[run.status]}</Text>
          </View>
          <Text style={[styles.net, fonts.display, { color: c.textPrimary }]}>{money(run.totalNet)}</Text>

          {canManage && run.status === 'DRAFT' ? (
            <PrimaryButton label={t('mPayroll.approve')} onPress={() => approve(run.id)} loading={busyRunId === run.id} />
          ) : null}

          {canManage && run.status === 'APPROVED' ? (
            <PrimaryButton label={t('mPayroll.markPaid')} onPress={() => markPaid(run.id)} loading={busyRunId === run.id} />
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
  bordered: { borderWidth: borderWidth },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  period: { fontSize: typography.size.md },
  status: { fontSize: typography.size.sm },
  net: { fontSize: typography.size.xl, fontVariant: ['tabular-nums'] },
});
