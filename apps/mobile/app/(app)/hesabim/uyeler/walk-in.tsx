import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { BookSessionSchema } from '@platform/shared';

import { PermissionGate } from '../../../../src/components/PermissionGate';
import { PrimaryButton } from '../../../../src/components/PrimaryButton';
import { ScreenContainer } from '../../../../src/components/ScreenContainer';
import { ApiError, apiRequest } from '../../../../src/lib/api';
import { weekRange } from '../../../../src/lib/dateRange';
import { trainerName, type ScheduleRow } from '../../../../src/lib/scheduleTypes';
import { useSession } from '../../../../src/lib/session';
import { palette, radii, spacing, typography, useThemeColors, useThemeFonts } from '../../../../src/theme';

function formatDayTime(startTime: string, endTime: string): string {
  const start = new Date(startTime);
  const end = new Date(endTime);
  const day = start.toLocaleDateString('tr-TR', { weekday: 'short', day: 'numeric', month: 'short' });
  const startHour = start.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  const endHour = end.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  return `${day}, ${startHour}-${endHour}`;
}

function WalkInContent() {
  const router = useRouter();
  const colors = useThemeColors();
  const fonts = useThemeFonts();
  const { memberId } = useLocalSearchParams<{ memberId: string }>();
  const { activeMembership } = useSession();
  const studioId = activeMembership?.studioId;

  const [schedules, setSchedules] = useState<ScheduleRow[] | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!studioId) return;
    const { start, end } = weekRange(new Date());
    try {
      const data = await apiRequest<ScheduleRow[]>(
        `/schedules/studio/${studioId}?startDate=${start.toISOString()}&endDate=${end.toISOString()}`,
        { studioId },
      );
      setSchedules(data.filter((s) => !s.isCancelled && s.bookedCount < s.capacity));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Seanslar yüklenemedi.');
    }
  }, [studioId]);

  useEffect(() => {
    load();
  }, [load]);

  const book = async (scheduleId: string) => {
    if (!studioId) return;
    setBusyId(scheduleId);
    setError(undefined);
    const parsed = BookSessionSchema.safeParse({ studioId, scheduleId, memberId, resourceIds: [] });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Rezervasyon yapılamadı.');
      setBusyId(null);
      return;
    }
    try {
      await apiRequest('/schedules/book', { method: 'POST', studioId, body: parsed.data });
      setDone(scheduleId);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Rezervasyon yapılamadı.');
    } finally {
      setBusyId(null);
    }
  };

  if (done) {
    return (
      <ScreenContainer>
        <Text style={[styles.title, { color: colors.textPrimary }]}>Rezervasyon oluşturuldu</Text>
        <PrimaryButton label="Üye kartına dön" onPress={() => router.back()} />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer>
      <Text style={[styles.title, { color: colors.textPrimary }]}>Seansa ekle (walk-in)</Text>
      <Text style={[styles.lead, fonts.body, { color: colors.textSecondary }]}>Önümüzdeki 7 gün, boş kontenjanı olan seanslar</Text>
      {!schedules && !error ? <ActivityIndicator /> : null}
      {error ? <Text style={[styles.error, { color: palette.danger }]}>{error}</Text> : null}
      {schedules?.length === 0 ? (
        <Text style={[styles.empty, fonts.body, { color: colors.textSecondary }]}>Uygun seans bulunamadı.</Text>
      ) : null}
      {schedules?.map((item) => (
        <View key={item.id} style={[styles.row, { borderColor: colors.border, backgroundColor: colors.surface }]}>
          <View style={styles.rowText}>
            <Text style={[styles.rowTitle, fonts.bodyStrong, { color: colors.textPrimary }]}>
              {item.serviceType?.name ?? item.title}
            </Text>
            <Text style={[styles.rowMeta, fonts.body, { color: colors.textSecondary }]}>
              {formatDayTime(item.startTime, item.endTime)}
            </Text>
            {trainerName(item.trainer) ? (
              <Text style={[styles.rowMeta, fonts.body, { color: colors.textSecondary }]}>{trainerName(item.trainer)}</Text>
            ) : null}
          </View>
          <Pressable
            accessibilityRole="button"
            disabled={busyId === item.id}
            onPress={() => book(item.id)}
            style={[styles.bookButton, { borderColor: colors.primary }]}
          >
            <Text style={{ color: colors.primary, fontSize: typography.size.sm }}>Ekle</Text>
          </Pressable>
        </View>
      ))}
    </ScreenContainer>
  );
}

/** Reception walk-in booking from the member card, against the existing POST /schedules/book (bookings.manage). */
export default function WalkInScreen() {
  return (
    <PermissionGate anyOf={['bookings.manage']}>
      <WalkInContent />
    </PermissionGate>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: typography.size.xl, fontWeight: typography.weight.bold, marginBottom: spacing[1] },
  lead: { fontSize: typography.size.sm, marginBottom: spacing[4] },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing[3],
    borderRadius: radii.md,
    borderWidth: 1,
    marginBottom: spacing[2],
  },
  rowText: { flex: 1, gap: 2, marginRight: spacing[2] },
  rowTitle: { fontSize: typography.size.md },
  rowMeta: { fontSize: typography.size.sm },
  bookButton: { minHeight: 40, paddingHorizontal: spacing[3], justifyContent: 'center', borderRadius: radii.md, borderWidth: 1 },
  empty: { fontSize: typography.size.sm },
  error: { fontSize: typography.size.sm, marginBottom: spacing[3] },
});
