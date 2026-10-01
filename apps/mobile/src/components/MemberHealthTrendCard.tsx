import type { MemberHealthTrendDTO } from '@platform/shared';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { useT } from '../i18n';
import { ApiError, apiRequest } from '../lib/api';
import { useSession } from '../lib/session';
import { palette, spacing, typography, useThemeColors, useThemeFonts } from '../theme';
import { Card } from './Card';
import { Text } from './Text';

interface MemberHealthTrendCardProps {
  memberId: string;
}

/**
 * Staff-facing member card section (W21): the member's opted-in health
 * trend, gated server-side by members.health.view AND the member's own
 * shareWithStudio toggle. Renders nothing for staff without the permission,
 * and a plain notice when the member has not chosen to share.
 */
export function MemberHealthTrendCard({ memberId }: MemberHealthTrendCardProps) {
  const colors = useThemeColors();
  const fonts = useThemeFonts();
  const t = useT();
  const { activeMembership } = useSession();
  const canView = activeMembership?.permissions.includes('members.health.view') ?? false;
  const studioId = activeMembership?.studioId;

  const [trend, setTrend] = useState<MemberHealthTrendDTO | null>(null);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    if (!canView || !studioId) return;
    apiRequest<MemberHealthTrendDTO>(`/studios/${studioId}/members/${memberId}/health`, { studioId })
      .then(setTrend)
      .catch((e: unknown) => setError(e instanceof ApiError ? e.message : t('mHealth.errors.trendLoadFailed')));
  }, [canView, studioId, memberId]);

  if (!canView) return null;

  return (
    <Card style={styles.card}>
      <Text style={[styles.title, fonts.bodyStrong, { color: colors.textPrimary }]}>{t('mHealth.trend.title')}</Text>

      {error ? <Text style={styles.error}>{error}</Text> : null}
      {!trend && !error ? <ActivityIndicator color={colors.textPrimary} /> : null}

      {trend && !trend.shareWithStudio ? (
        <Text style={[styles.notice, fonts.body, { color: colors.textMuted }]}>{t('mHealth.trend.notShared')}</Text>
      ) : null}

      {trend && trend.shareWithStudio && trend.summaries.length === 0 ? (
        <Text style={[styles.notice, fonts.body, { color: colors.textMuted }]}>{t('mHealth.trend.noDataYet')}</Text>
      ) : null}

      {trend && trend.shareWithStudio && trend.summaries.length > 0
        ? (() => {
            const last7 = trend.summaries.slice(-7);
            const avgSteps = Math.round(last7.reduce((sum, s) => sum + (s.steps ?? 0), 0) / last7.length);
            const latestHr = [...trend.summaries].reverse().find((s) => s.restingHeartRate != null)?.restingHeartRate;
            return (
              <View style={styles.row}>
                <View style={styles.metric}>
                  <Text style={[styles.metricValue, fonts.display, { color: colors.textPrimary }]}>{avgSteps}</Text>
                  <Text style={[styles.metricLabel, fonts.body, { color: colors.textMuted }]}>{t('mHealth.trend.avgSteps7Days')}</Text>
                </View>
                {latestHr != null ? (
                  <View style={styles.metric}>
                    <Text style={[styles.metricValue, fonts.display, { color: colors.textPrimary }]}>{latestHr}</Text>
                    <Text style={[styles.metricLabel, fonts.body, { color: colors.textMuted }]}>{t('mHealth.trend.lastRestingHeartRate')}</Text>
                  </View>
                ) : null}
              </View>
            );
          })()
        : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    marginBottom: spacing[4],
  },
  title: {
    fontSize: typography.size.md,
  },
  notice: {
    fontSize: typography.size.sm,
  },
  error: {
    color: palette.danger,
    fontSize: typography.size.sm,
  },
  row: {
    flexDirection: 'row',
    gap: spacing[6],
  },
  metric: {
    alignItems: 'flex-start',
  },
  metricValue: {
    fontSize: typography.size.lg,
    fontVariant: ['tabular-nums'],
  },
  metricLabel: {
    fontSize: typography.size.xs,
  },
});
