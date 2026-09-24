import type { MemberHealthTrendDTO } from '@platform/shared';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { ApiError, apiRequest } from '../lib/api';
import { useSession } from '../lib/session';
import { palette, radii, spacing, typography, useThemeColors } from '../theme';

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
  const { activeMembership } = useSession();
  const canView = activeMembership?.permissions.includes('members.health.view') ?? false;
  const studioId = activeMembership?.studioId;

  const [trend, setTrend] = useState<MemberHealthTrendDTO | null>(null);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    if (!canView || !studioId) return;
    apiRequest<MemberHealthTrendDTO>(`/studios/${studioId}/members/${memberId}/health`, { studioId })
      .then(setTrend)
      .catch((e: unknown) => setError(e instanceof ApiError ? e.message : 'Sağlık verisi yüklenemedi.'));
  }, [canView, studioId, memberId]);

  if (!canView) return null;

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text style={[styles.title, { color: colors.textPrimary }]}>Sağlık eğilimi</Text>

      {error ? <Text style={styles.error}>{error}</Text> : null}
      {!trend && !error ? <ActivityIndicator color={colors.textPrimary} /> : null}

      {trend && !trend.shareWithStudio ? (
        <Text style={[styles.notice, { color: colors.textMuted }]}>
          Üye sağlık verilerini işletmeyle paylaşmayı seçmedi.
        </Text>
      ) : null}

      {trend && trend.shareWithStudio && trend.summaries.length === 0 ? (
        <Text style={[styles.notice, { color: colors.textMuted }]}>Henüz veri yok.</Text>
      ) : null}

      {trend && trend.shareWithStudio && trend.summaries.length > 0
        ? (() => {
            const last7 = trend.summaries.slice(-7);
            const avgSteps = Math.round(last7.reduce((sum, s) => sum + (s.steps ?? 0), 0) / last7.length);
            const latestHr = [...trend.summaries].reverse().find((s) => s.restingHeartRate != null)?.restingHeartRate;
            return (
              <View style={styles.row}>
                <View style={styles.metric}>
                  <Text style={[styles.metricValue, { color: colors.textPrimary }]}>{avgSteps}</Text>
                  <Text style={[styles.metricLabel, { color: colors.textMuted }]}>Ort. adım (7 gün)</Text>
                </View>
                {latestHr != null ? (
                  <View style={styles.metric}>
                    <Text style={[styles.metricValue, { color: colors.textPrimary }]}>{latestHr}</Text>
                    <Text style={[styles.metricLabel, { color: colors.textMuted }]}>Son dinlenme nabzı</Text>
                  </View>
                ) : null}
              </View>
            );
          })()
        : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing[4],
    marginBottom: spacing[4],
    gap: spacing[2],
  },
  title: {
    fontSize: typography.size.md,
    fontWeight: typography.weight.semibold,
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
    fontWeight: typography.weight.bold,
    fontVariant: ['tabular-nums'],
  },
  metricLabel: {
    fontSize: typography.size.xs,
  },
});
