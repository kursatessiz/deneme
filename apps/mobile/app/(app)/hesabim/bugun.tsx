import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { PermissionGate } from '../../../src/components/PermissionGate';
import { PrimaryButton } from '../../../src/components/PrimaryButton';
import { ScreenContainer } from '../../../src/components/ScreenContainer';
import { SessionDetail } from '../../../src/components/SessionDetail';
import { ApiError, apiRequest } from '../../../src/lib/api';
import { dayRange } from '../../../src/lib/dateRange';
import { isTabletWidth } from '../../../src/lib/layout';
import { trainerName, type ScheduleRow } from '../../../src/lib/scheduleTypes';
import { useSession } from '../../../src/lib/session';
import { palette, radii, spacing, typography, useThemeColors, useThemeFonts } from '../../../src/theme';

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
}

function BugunContent() {
  const router = useRouter();
  const colors = useThemeColors();
  const fonts = useThemeFonts();
  const { width } = useWindowDimensions();
  const isTablet = isTabletWidth(width);
  const { activeMembership } = useSession();
  const studioId = activeMembership?.studioId;
  const canScan = activeMembership?.permissions.includes('attendance.manage') ?? false;
  const canViewMembers = activeMembership?.permissions.includes('members.view') ?? false;

  const [schedules, setSchedules] = useState<ScheduleRow[] | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedStart, setSelectedStart] = useState<string | undefined>();

  const load = useCallback(async () => {
    if (!studioId) return;
    setError(undefined);
    const { start, end } = dayRange(new Date());
    try {
      const data = await apiRequest<ScheduleRow[]>(
        `/schedules/studio/${studioId}?startDate=${start.toISOString()}&endDate=${end.toISOString()}`,
        { studioId },
      );
      setSchedules(data);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Bugünün seansları yüklenemedi.');
    }
  }, [studioId]);

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
      <View style={styles.quickLinks}>
        {canScan ? (
          <PrimaryButton
            label="Üye QR tarama"
            variant="secondary"
            onPress={() => router.push('/(app)/hesabim/resepsiyon-tarama')}
          />
        ) : null}
        {canViewMembers ? (
          <PrimaryButton
            label="Üye ara / walk-in"
            variant="secondary"
            onPress={() => router.push('/(app)/hesabim/uyeler')}
          />
        ) : null}
      </View>
      {!schedules && !error ? <ActivityIndicator /> : null}
      {error ? <Text style={[styles.error, { color: palette.danger }]}>{error}</Text> : null}
      {schedules?.length === 0 ? (
        <Text style={[styles.empty, fonts.body, { color: colors.textSecondary }]}>Bugün planlanmış seans yok.</Text>
      ) : null}
      {schedules?.map((item) => (
        <Pressable
          key={item.id}
          accessibilityRole="button"
          onPress={() => openSchedule(item.id, item.startTime)}
          style={[
            styles.row,
            { borderColor: colors.border, backgroundColor: selectedId === item.id ? colors.surfaceMuted : colors.surface },
          ]}
        >
          <Text style={[styles.time, fonts.bodyStrong, { color: colors.textPrimary }]}>{formatTime(item.startTime)}</Text>
          <View style={styles.rowText}>
            <Text style={[styles.title, fonts.bodyStrong, { color: colors.textPrimary }]}>
              {item.serviceType?.name ?? item.title}
            </Text>
            {trainerName(item.trainer) ? (
              <Text style={[styles.subtitle, fonts.body, { color: colors.textSecondary }]}>{trainerName(item.trainer)}</Text>
            ) : null}
          </View>
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

/** Reception: today's sessions with quick check-in (reuses schedules/check-in), plus links to the W17 member-QR scanner and member search/walk-in. */
export default function BugunScreen() {
  return (
    <PermissionGate anyOf={['attendance.manage', 'bookings.manage']}>
      <BugunContent />
    </PermissionGate>
  );
}

const styles = StyleSheet.create({
  tabletWrap: { flex: 1, flexDirection: 'row' },
  detailPane: { flex: 1, borderLeftWidth: 1 },
  placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  quickLinks: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2], marginBottom: spacing[4] },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing[3],
    borderRadius: radii.md,
    borderWidth: 1,
    marginBottom: spacing[2],
    gap: spacing[3],
  },
  time: { fontSize: typography.size.md, width: 48 },
  rowText: { flex: 1, gap: 2 },
  title: { fontSize: typography.size.md },
  subtitle: { fontSize: typography.size.sm },
  capacity: { fontSize: typography.size.sm },
  empty: { fontSize: typography.size.sm },
  error: { fontSize: typography.size.sm, marginBottom: spacing[3] },
});
