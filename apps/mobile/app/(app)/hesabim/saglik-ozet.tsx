import type { HealthDailySummaryDTO } from '@platform/shared';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { ScreenContainer } from '../../../src/components/ScreenContainer';
import { ApiError, apiRequest } from '../../../src/lib/api';
import { useSession } from '../../../src/lib/session';
import { palette, radii, spacing, typography, useThemeColors } from '../../../src/theme';

type RangeDays = 7 | 30;

function lastNDates(days: number): string[] {
  const out: string[] = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

function shortDayLabel(iso: string): string {
  return new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'numeric' }).format(new Date(iso));
}

/** One vertical bar built purely from Views, no chart library. */
function DailyBar({ value, maxValue, label, color, trackColor }: { value: number; maxValue: number; label: string; color: string; trackColor: string }) {
  const ratio = maxValue > 0 ? Math.max(0, Math.min(1, value / maxValue)) : 0;
  return (
    <View style={styles.barColumn}>
      <View style={[styles.barTrack, { backgroundColor: trackColor }]}>
        <View style={[styles.barFill, { height: `${ratio * 100}%`, backgroundColor: color }]} />
      </View>
      <Text style={[styles.barLabel, { color: trackColor }]}>{label}</Text>
    </View>
  );
}

/** Member self-service: "Sağlık" screen with 7/30-day step, energy and resting HR bars. */
export default function SaglikOzetScreen() {
  const colors = useThemeColors();
  const { activeMembership } = useSession();
  const studioId = activeMembership?.studioId;

  const [range, setRange] = useState<RangeDays>(7);
  const [summaries, setSummaries] = useState<HealthDailySummaryDTO[] | null>(null);
  const [error, setError] = useState<string | undefined>();

  const load = useCallback(async () => {
    if (!studioId) return;
    setError(undefined);
    try {
      const data = await apiRequest<HealthDailySummaryDTO[]>('/me/health/summaries', { studioId });
      setSummaries(data);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Sağlık verileri yüklenemedi.');
    }
  }, [studioId]);

  useEffect(() => {
    load();
  }, [load]);

  const byDate = useMemo(() => new Map((summaries ?? []).map((s) => [s.date, s])), [summaries]);
  const dates = useMemo(() => lastNDates(range), [range]);
  const steps = dates.map((d) => byDate.get(d)?.steps ?? 0);
  const energy = dates.map((d) => byDate.get(d)?.activeEnergyKcal ?? 0);
  const maxSteps = Math.max(1, ...steps);
  const maxEnergy = Math.max(1, ...energy);
  const latestRestingHr = [...(summaries ?? [])].reverse().find((s) => s.restingHeartRate != null)?.restingHeartRate ?? null;

  if (!summaries && !error) {
    return (
      <ScreenContainer>
        <ActivityIndicator color={colors.textPrimary} />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer>
      <View style={styles.rangeSwitch}>
        {([7, 30] as RangeDays[]).map((r) => (
          <Pressable
            key={r}
            accessibilityRole="button"
            accessibilityLabel={`Son ${r} gün`}
            onPress={() => setRange(r)}
            style={[
              styles.rangeButton,
              { borderColor: colors.border, backgroundColor: range === r ? colors.primary : 'transparent' },
            ]}
          >
            <Text style={{ color: range === r ? colors.onPrimary ?? colors.textPrimary : colors.textPrimary, fontSize: typography.size.sm }}>
              Son {r} gün
            </Text>
          </Pressable>
        ))}
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {summaries && summaries.length === 0 ? (
        <Text style={[styles.empty, { color: colors.textMuted }]}>
          Henüz sağlık verisi paylaşılmamış. Hesabım {'>'} Sağlık entegrasyonu ekranından açabilirsiniz.
        </Text>
      ) : null}

      {summaries && summaries.length > 0 ? (
        <>
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>Adım</Text>
            <View style={styles.chart}>
              {dates.map((d, i) => (
                <DailyBar key={d} value={steps[i]} maxValue={maxSteps} label={shortDayLabel(d)} color={palette.info} trackColor={colors.border} />
              ))}
            </View>
          </View>

          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>Aktif enerji (kcal)</Text>
            <View style={styles.chart}>
              {dates.map((d, i) => (
                <DailyBar key={d} value={energy[i]} maxValue={maxEnergy} label={shortDayLabel(d)} color={palette.success} trackColor={colors.border} />
              ))}
            </View>
          </View>

          {latestRestingHr != null ? (
            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>Dinlenme nabzı</Text>
              <Text style={[styles.bigValue, { color: colors.textPrimary }]}>{latestRestingHr} bpm</Text>
            </View>
          ) : null}
        </>
      ) : null}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  rangeSwitch: {
    flexDirection: 'row',
    gap: spacing[2],
    marginBottom: spacing[4],
  },
  rangeButton: {
    borderWidth: 1,
    borderRadius: radii.md,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    minHeight: 44,
    justifyContent: 'center',
  },
  card: {
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing[4],
    marginBottom: spacing[4],
  },
  cardTitle: {
    fontSize: typography.size.md,
    fontWeight: typography.weight.semibold,
    marginBottom: spacing[3],
  },
  chart: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: 120,
    gap: spacing[1],
  },
  barColumn: {
    flex: 1,
    alignItems: 'center',
  },
  barTrack: {
    width: '100%',
    height: 96,
    borderRadius: radii.sm,
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  barFill: {
    width: '100%',
    borderRadius: radii.sm,
  },
  barLabel: {
    fontSize: typography.size.xs,
    marginTop: spacing[1],
  },
  bigValue: {
    fontSize: typography.size.xl,
    fontWeight: typography.weight.bold,
  },
  empty: {
    fontSize: typography.size.sm,
  },
  error: {
    color: palette.danger,
    fontSize: typography.size.sm,
    marginBottom: spacing[3],
  },
});
