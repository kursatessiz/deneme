import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { PermissionGate } from '../../../../src/components/PermissionGate';
import { ScreenContainer } from '../../../../src/components/ScreenContainer';
import { SessionDetail } from '../../../../src/components/SessionDetail';
import { ApiError, apiRequest } from '../../../../src/lib/api';
import { dayRange, weekRange } from '../../../../src/lib/dateRange';
import { isTabletWidth } from '../../../../src/lib/layout';
import { trainerName, type ScheduleRow } from '../../../../src/lib/scheduleTypes';
import { useSession } from '../../../../src/lib/session';
import { palette, radii, spacing, typography, useThemeColors, useThemeFonts } from '../../../../src/theme';

function formatDayTime(startTime: string, endTime: string): string {
  const start = new Date(startTime);
  const end = new Date(endTime);
  const day = start.toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' });
  const startHour = start.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  const endHour = end.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  return `${day}, ${startHour} - ${endHour}`;
}

function ProgramimContent() {
  const router = useRouter();
  const colors = useThemeColors();
  const fonts = useThemeFonts();
  const { width } = useWindowDimensions();
  const isTablet = isTabletWidth(width);
  const { activeMembership } = useSession();
  const studioId = activeMembership?.studioId;
  const trainerId = activeMembership?.trainerProfileId ?? undefined;

  const [mode, setMode] = useState<'day' | 'week'>('day');
  const [schedules, setSchedules] = useState<ScheduleRow[] | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedStart, setSelectedStart] = useState<string | undefined>();

  const load = useCallback(async () => {
    if (!studioId || !trainerId) return;
    setError(undefined);
    const { start, end } = mode === 'day' ? dayRange(new Date()) : weekRange(new Date());
    try {
      const data = await apiRequest<ScheduleRow[]>(
        `/schedules/studio/${studioId}?startDate=${start.toISOString()}&endDate=${end.toISOString()}&trainerId=${trainerId}`,
        { studioId },
      );
      setSchedules(data);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Seanslar yüklenemedi.');
    }
  }, [studioId, trainerId, mode]);

  useEffect(() => {
    load();
  }, [load]);

  const openSchedule = (id: string, startTime: string) => {
    if (isTablet) {
      setSelectedId(id);
      setSelectedStart(startTime);
    } else {
      router.push({ pathname: '/(app)/hesabim/programim/[scheduleId]', params: { scheduleId: id, startTime } });
    }
  };

  const list = (
    <View>
      <View style={styles.toggleRow}>
        {(['day', 'week'] as const).map((m) => (
          <Pressable
            key={m}
            accessibilityRole="button"
            accessibilityState={{ selected: mode === m }}
            onPress={() => setMode(m)}
            style={[
              styles.toggle,
              { borderColor: colors.border, backgroundColor: mode === m ? colors.primary : colors.surface },
            ]}
          >
            <Text style={[fonts.bodyStrong, { color: mode === m ? colors.onPrimary : colors.textPrimary }]}>
              {m === 'day' ? 'Bugün' : 'Bu hafta'}
            </Text>
          </Pressable>
        ))}
      </View>
      {!schedules && !error ? <ActivityIndicator /> : null}
      {error ? <Text style={[styles.error, { color: palette.danger }]}>{error}</Text> : null}
      {schedules?.length === 0 ? (
        <Text style={[styles.empty, fonts.body, { color: colors.textSecondary }]}>Bu aralıkta seans yok.</Text>
      ) : null}
      {schedules?.map((item) => (
        <Pressable
          key={item.id}
          accessibilityRole="button"
          onPress={() => openSchedule(item.id, item.startTime)}
          style={[
            styles.row,
            {
              borderColor: colors.border,
              backgroundColor: selectedId === item.id ? colors.surfaceMuted : colors.surface,
            },
          ]}
        >
          <Text style={[styles.title, fonts.bodyStrong, { color: colors.textPrimary }]}>
            {item.serviceType?.name ?? item.title}
          </Text>
          <Text style={[styles.subtitle, fonts.body, { color: colors.textSecondary }]}>
            {formatDayTime(item.startTime, item.endTime)}
          </Text>
          {trainerName(item.trainer) ? (
            <Text style={[styles.subtitle, fonts.body, { color: colors.textSecondary }]}>{trainerName(item.trainer)}</Text>
          ) : null}
          <Text style={[styles.capacity, fonts.body, { color: colors.textSecondary }]}>
            {item.bookedCount}/{item.capacity}
          </Text>
        </Pressable>
      ))}
    </View>
  );

  if (!isTablet) {
    return <ScreenContainer>{list}</ScreenContainer>;
  }

  return (
    <View style={styles.tabletWrap}>
      <ScreenContainer>{list}</ScreenContainer>
      <View style={[styles.detailPane, { borderColor: colors.border }]}>
        {selectedId ? (
          <ScreenContainer>
            <SessionDetail scheduleId={selectedId} hintStartTime={selectedStart} onChanged={load} />
          </ScreenContainer>
        ) : (
          <View style={styles.placeholder}>
            <Text style={[fonts.body, { color: colors.textSecondary }]}>Bir seans seçin.</Text>
          </View>
        )}
      </View>
    </View>
  );
}

/** Trainer's own sessions, day or week, with a roster/check-in detail (tablet: two-pane). */
export default function ProgramimScreen() {
  return (
    <PermissionGate anyOf={['schedule.view']}>
      <ProgramimContent />
    </PermissionGate>
  );
}

const styles = StyleSheet.create({
  tabletWrap: { flex: 1, flexDirection: 'row' },
  detailPane: { flex: 1, borderLeftWidth: 1 },
  placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  toggleRow: { flexDirection: 'row', gap: spacing[2], marginBottom: spacing[4] },
  toggle: { minHeight: 44, paddingHorizontal: spacing[4], justifyContent: 'center', borderRadius: radii.md, borderWidth: 1 },
  row: { padding: spacing[3], borderRadius: radii.md, borderWidth: 1, marginBottom: spacing[3], gap: 2 },
  title: { fontSize: typography.size.md },
  subtitle: { fontSize: typography.size.sm },
  capacity: { fontSize: typography.size.sm, marginTop: 2 },
  empty: { fontSize: typography.size.sm },
  error: { fontSize: typography.size.sm, marginBottom: spacing[3] },
});
