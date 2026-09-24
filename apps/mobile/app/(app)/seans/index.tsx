import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import type { SessionScheduleSummaryDTO } from '@platform/shared';

import { ScreenContainer } from '../../../src/components/ScreenContainer';
import { ApiError, apiRequest } from '../../../src/lib/api';
import { useSession } from '../../../src/lib/session';
import { palette, radii, spacing, typography, useThemeColors, useThemeFonts } from '../../../src/theme';

function formatDayTime(startTime: string, endTime: string): string {
  const start = new Date(startTime);
  const end = new Date(endTime);
  const day = start.toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' });
  const startHour = start.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  const endHour = end.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  return `${day}, ${startHour} - ${endHour}`;
}

/** This week's sessions for the active studio; taps open the booking screen. */
export default function SeanslarScreen() {
  const router = useRouter();
  const colors = useThemeColors();
  const fonts = useThemeFonts();
  const { activeMembership } = useSession();
  const studioId = activeMembership?.studioId;

  const [schedules, setSchedules] = useState<SessionScheduleSummaryDTO[] | null>(null);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    if (!studioId) return;
    const start = new Date();
    const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
    apiRequest<SessionScheduleSummaryDTO[]>(
      `/schedules/self/week?startDate=${start.toISOString()}&endDate=${end.toISOString()}`,
      { studioId },
    )
      .then(setSchedules)
      .catch((e: unknown) => setError(e instanceof ApiError ? e.message : 'Seanslar yüklenemedi.'));
  }, [studioId]);

  const openSchedule = (item: SessionScheduleSummaryDTO) => {
    router.push({
      pathname: '/(app)/seans/[scheduleId]',
      params: {
        scheduleId: item.id,
        title: item.title,
        serviceTypeName: item.serviceTypeName,
        serviceTypeId: item.serviceTypeId,
        trainerName: item.trainerName ?? '',
        startTime: item.startTime,
        endTime: item.endTime,
        capacity: String(item.capacity),
        bookedCount: String(item.bookedCount),
        deliveryMode: item.deliveryMode,
      },
    });
  };

  return (
    <ScreenContainer>
      <Text style={[styles.lead, fonts.body, { color: colors.textSecondary }]}>Bu haftanın seansları</Text>
      {!schedules && !error ? <ActivityIndicator /> : null}
      {error ? <Text style={[styles.error, { color: palette.danger }]}>{error}</Text> : null}
      {schedules?.length === 0 ? (
        <Text style={[styles.empty, fonts.body, { color: colors.textSecondary }]}>Bu hafta planlanmış seans yok.</Text>
      ) : null}
      {schedules?.map((item) => (
        <Pressable
          key={item.id}
          accessibilityRole="button"
          accessibilityLabel={`${item.serviceTypeName}, ${formatDayTime(item.startTime, item.endTime)}`}
          onPress={() => openSchedule(item)}
          style={[styles.row, { borderColor: colors.border, backgroundColor: colors.surface }]}
        >
          <View style={styles.rowText}>
            <Text style={[styles.title, fonts.bodyStrong, { color: colors.textPrimary }]}>{item.serviceTypeName}</Text>
            <Text style={[styles.subtitle, fonts.body, { color: colors.textSecondary }]}>
              {formatDayTime(item.startTime, item.endTime)}
            </Text>
            {item.trainerName ? (
              <Text style={[styles.subtitle, fonts.body, { color: colors.textSecondary }]}>{item.trainerName}</Text>
            ) : null}
            {item.deliveryMode !== 'IN_PERSON' ? (
              <Text style={[styles.subtitle, fonts.bodyStrong, { color: colors.primary }]}>
                {item.deliveryMode === 'ONLINE' ? 'Çevrimiçi' : 'Hibrit (yüz yüze + çevrimiçi)'}
              </Text>
            ) : null}
          </View>
          <Text style={[styles.capacity, fonts.body, { color: colors.textSecondary }]}>
            {item.bookedCount}/{item.capacity}
          </Text>
        </Pressable>
      ))}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  lead: { fontSize: typography.size.sm, marginBottom: spacing[3] },
  empty: { fontSize: typography.size.sm },
  error: { fontSize: typography.size.sm, marginTop: spacing[3] },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 56,
    padding: spacing[3],
    borderRadius: radii.md,
    borderWidth: 1,
    marginBottom: spacing[3],
  },
  rowText: { flex: 1, gap: 2 },
  title: { fontSize: typography.size.md },
  subtitle: { fontSize: typography.size.sm },
  capacity: { fontSize: typography.size.sm },
});
