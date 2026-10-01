import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { useLocale, useT } from '../i18n';
import { ApiError, apiRequest } from '../lib/api';
import {
  bookingMemberName,
  bookingStatusLabel,
  rosterOf,
  trainerName,
  type ScheduleRow,
  type TrainerRow,
} from '../lib/scheduleTypes';
import { useSession } from '../lib/session';
import { palette, radii, spacing, typography, useThemeColors, useThemeFonts } from '../theme';
import { Button } from './Button';
import { Chip } from './Chip';
import { PrimaryButton } from './PrimaryButton';
import { Text } from './Text';

interface SessionDetailProps {
  scheduleId: string;
  /** ISO start time, when the caller already knows it (from a list row), to narrow the lookup window. */
  hintStartTime?: string;
  onChanged?: () => void;
}

/**
 * Staff session detail: roster with check-in/no-show, substitution request
 * (trainer picker, schedule.manage), cancel session. Reused by trainer
 * "Programım" and reception "Bugünün seansları" (both tablet-pane and
 * phone-push contexts).
 */
export function SessionDetail({ scheduleId, hintStartTime, onChanged }: SessionDetailProps) {
  const router = useRouter();
  const colors = useThemeColors();
  const fonts = useThemeFonts();
  const { locale } = useLocale();
  const t = useT();
  const BOOKING_STATUS_LABEL = bookingStatusLabel(t);
  const { activeMembership } = useSession();
  const studioId = activeMembership?.studioId;
  const permissions = activeMembership?.permissions ?? [];
  const canCheckIn = permissions.includes('attendance.manage');
  const canManageSchedule = permissions.includes('schedule.manage');

  const [schedule, setSchedule] = useState<ScheduleRow | null>(null);
  const [trainers, setTrainers] = useState<TrainerRow[]>([]);
  const [error, setError] = useState<string | undefined>();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [substituteId, setSubstituteId] = useState('');

  const load = useCallback(async () => {
    if (!studioId) return;
    setError(undefined);
    try {
      const anchor = hintStartTime ? new Date(hintStartTime) : new Date();
      const start = new Date(anchor.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString();
      const end = new Date(anchor.getTime() + 2 * 24 * 60 * 60 * 1000).toISOString();
      const rows = await apiRequest<ScheduleRow[]>(
        `/schedules/studio/${studioId}?startDate=${start}&endDate=${end}`,
        { studioId },
      );
      const found = rows.find((r) => r.id === scheduleId);
      setSchedule(found ?? null);
      if (!found) setError(t('mSession.notFound'));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('mSession.errors.loadFailed'));
    }
  }, [scheduleId, studioId, hintStartTime]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!studioId || !canManageSchedule) return;
    apiRequest<TrainerRow[]>(`/trainers/studio/${studioId}`, { studioId })
      .then(setTrainers)
      .catch(() => setTrainers([]));
  }, [studioId, canManageSchedule]);

  const run = async (id: string, action: () => Promise<unknown>) => {
    setBusyId(id);
    setError(undefined);
    try {
      await action();
      await load();
      onChanged?.();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('mSession.errors.actionFailed'));
    } finally {
      setBusyId(null);
    }
  };

  if (!schedule && !error) return <ActivityIndicator style={styles.loader} />;
  if (!schedule) return <Text style={[styles.error, { color: palette.danger }]}>{error}</Text>;

  const roster = rosterOf(schedule);
  const start = new Date(schedule.startTime);
  const end = new Date(schedule.endTime);

  return (
    <View>
      <Text style={[styles.title, fonts.display, { color: colors.textPrimary }]}>
        {schedule.title || schedule.serviceType?.name || t('mSession.session')}
      </Text>
      <Text style={[styles.subtitle, fonts.body, { color: colors.textSecondary }]}>
        {start.toLocaleDateString(locale, { weekday: 'long', day: '2-digit', month: 'long' })} ·{' '}
        {start.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}-
        {end.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}
      </Text>
      {trainerName(schedule.trainer) ? (
        <Text style={[styles.subtitle, fonts.body, { color: colors.textSecondary }]}>
          {t('mSession.trainerLabel', { name: trainerName(schedule.trainer) ?? '' })}
          {schedule.originalTrainerId ? t('mSession.substituteSuffix') : ''}
        </Text>
      ) : null}
      {schedule.resource?.name ? (
        <Text style={[styles.subtitle, fonts.body, { color: colors.textSecondary }]}>
          {t('mSession.resourceLabel', { name: schedule.resource.name })}
        </Text>
      ) : null}
      <Text style={[styles.subtitle, fonts.body, { color: colors.textSecondary }]}>
        {t('mSession.capacityLabel', { booked: schedule.bookedCount, capacity: schedule.capacity })}
      </Text>
      {schedule.isCancelled ? (
        <Text style={[styles.notice, { color: palette.danger }]}>
          {t('mSession.cancelledNotice')}
          {schedule.cancellationReason ? t('mSession.cancelledReasonSuffix', { reason: schedule.cancellationReason }) : ''}
        </Text>
      ) : null}
      {error ? <Text style={[styles.notice, { color: palette.danger }]}>{error}</Text> : null}

      {!schedule.isCancelled && canManageSchedule ? (
        <View style={styles.actionsRow}>
          <PrimaryButton
            label={t('mSession.editSession')}
            variant="secondary"
            onPress={() =>
              router.push({
                pathname: '/(app)/hesabim/programim/duzenle/[scheduleId]',
                params: {
                  scheduleId: schedule.id,
                  title: schedule.title,
                  startTime: schedule.startTime,
                  endTime: schedule.endTime,
                  capacity: String(schedule.capacity),
                },
              })
            }
          />
          <PrimaryButton
            label={t('mSession.cancelSession')}
            variant="danger"
            loading={busyId === 'cancel-session'}
            onPress={() =>
              run('cancel-session', () =>
                apiRequest(`/schedules/${schedule.id}/cancel-session`, {
                  method: 'POST',
                  studioId,
                  body: { notifyMembers: true },
                }),
              )
            }
          />
        </View>
      ) : null}

      {!schedule.isCancelled && canManageSchedule && trainers.length > 0 ? (
        <View style={styles.substituteRow}>
          <Text style={[styles.sectionTitle, fonts.bodyStrong, { color: colors.textPrimary }]}>{t('mSession.substituteRequest')}</Text>
          <View style={styles.chipRow}>
            {trainers.map((trainer) => (
              <Chip
                key={trainer.id}
                label={`${trainer.firstName} ${trainer.lastName}`}
                selected={substituteId === trainer.id}
                onPress={() => setSubstituteId(trainer.id)}
              />
            ))}
          </View>
          <PrimaryButton
            label={t('mSession.changeTrainer')}
            variant="secondary"
            disabled={!substituteId}
            loading={busyId === 'substitute'}
            onPress={() =>
              run('substitute', () =>
                apiRequest(`/schedules/${schedule.id}/substitute`, {
                  method: 'POST',
                  studioId,
                  body: { trainerId: substituteId },
                }),
              )
            }
          />
        </View>
      ) : null}

      <Text style={[styles.sectionTitle, fonts.bodyStrong, { color: colors.textPrimary, marginTop: spacing[4] }]}>
        {t('mSession.participants', { count: roster.length })}
      </Text>
      {roster.length === 0 ? (
        <Text style={[styles.notice, { color: colors.textMuted }]}>{t('mSession.noBookingsYet')}</Text>
      ) : null}
      {roster.map((b) => (
        <View key={b.id} style={[styles.bookingRow, { backgroundColor: colors.surfaceMuted }]}>
          <View style={styles.bookingInfo}>
            <Text style={[fonts.bodyStrong, { color: colors.textPrimary }]} numberOfLines={1}>
              {bookingMemberName(b, t)}
            </Text>
            <Text style={[styles.statusLabel, fonts.body, { color: colors.textSecondary }]}>
              {BOOKING_STATUS_LABEL[b.status] ?? b.status}
            </Text>
          </View>
          {b.status === 'CONFIRMED' && !schedule.isCancelled && canCheckIn ? (
            <View style={styles.bookingActions}>
              <Button
                compact
                variant="outline"
                label={t('mSession.checkIn')}
                disabled={busyId === b.id}
                onPress={() => run(b.id, () => apiRequest(`/schedules/check-in/${b.id}`, { method: 'PATCH', studioId }))}
              />
              <Button
                compact
                variant="outline"
                tone="surface"
                label={t('mSession.noShow')}
                disabled={busyId === b.id}
                onPress={() =>
                  run(b.id, () => apiRequest(`/schedules/no-show/${b.id}`, { method: 'PATCH', studioId, body: {} }))
                }
              />
            </View>
          ) : null}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  loader: { marginTop: spacing[8] },
  title: { fontSize: typography.size.xl, marginBottom: spacing[1] },
  subtitle: { fontSize: typography.size.sm, marginBottom: spacing[1] / 2 },
  notice: { fontSize: typography.size.sm, marginTop: spacing[2] },
  actionsRow: { marginTop: spacing[3], gap: spacing[2] },
  substituteRow: { marginTop: spacing[4], gap: spacing[2] },
  sectionTitle: { fontSize: typography.size.md, marginBottom: spacing[2] },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
  bookingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderRadius: radii.md,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    marginBottom: spacing[2],
  },
  bookingInfo: { flex: 1, marginRight: spacing[2] },
  statusLabel: { fontSize: typography.size.xs },
  bookingActions: { flexDirection: 'row', gap: spacing[2] },
  error: { fontSize: typography.size.sm },
});
