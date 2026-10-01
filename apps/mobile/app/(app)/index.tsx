import type { MeUpcomingBookingsDTO, PendingRatingPromptDTO, UpcomingBookingDTO } from '@platform/shared';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { Button } from '../../src/components/Button';
import { Card } from '../../src/components/Card';
import { EmptyState } from '../../src/components/EmptyState';
import { ScreenContainer } from '../../src/components/ScreenContainer';
import { SectionTitle } from '../../src/components/SectionTitle';
import { useLocale, useT } from '../../src/i18n';
import { ApiError, apiRequest } from '../../src/lib/api';
import { addBookingToDeviceCalendar, CalendarSyncError } from '../../src/lib/calendarSync';
import { syncAllPendingWorkouts, syncTodayAggregatesIfOptedIn } from '../../src/health';
import { useSession } from '../../src/lib/session';
import { borderWidth, palette, radii, spacing, typography, useTheme, useThemeFonts } from '../../src/theme';
import { refreshWidgets } from '../../src/widgets';
import { Text } from '../../src/components/Text';

function formatBookingTime(booking: UpcomingBookingDTO, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(booking.startTime));
}

function UpcomingBookingCard({ booking }: { booking: UpcomingBookingDTO }) {
  const { theme } = useTheme();
  const fonts = useThemeFonts();
  const { locale } = useLocale();
  const t = useT();
  const c = theme.colors;
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | undefined>();

  const handleAddToCalendar = async () => {
    setStatus('saving');
    setErrorMessage(undefined);
    try {
      await addBookingToDeviceCalendar(booking, t);
      setStatus('saved');
    } catch (error) {
      setStatus('error');
      setErrorMessage(error instanceof CalendarSyncError ? error.message : t('mHome.errors.calendarAddFailed'));
    }
  };

  return (
    <Card style={styles.card}>
      <Text style={[styles.cardTitle, fonts.bodyStrong, { color: c.textPrimary }]}>{booking.serviceName}</Text>
      <Text style={[styles.cardSubtitle, fonts.body, { color: c.textSecondary }]}>{formatBookingTime(booking, locale)}</Text>
      <Text style={[styles.cardSubtitle, fonts.body, { color: c.textSecondary }]}>
        {booking.studioName}
        {booking.branchName ? `, ${booking.branchName}` : ''}
      </Text>
      {booking.trainerName ? (
        <Text style={[styles.cardSubtitle, fonts.body, { color: c.textMuted }]}>{t('mHome.trainerLabel', { name: booking.trainerName })}</Text>
      ) : null}

      <Button
        compact
        variant="soft"
        label={status === 'saved' ? t('mHome.addedToCalendar') : status === 'saving' ? t('mHome.addingToCalendar') : t('mHome.addToCalendar')}
        onPress={handleAddToCalendar}
        disabled={status === 'saving' || status === 'saved'}
        style={styles.calendarButton}
      />
      {errorMessage ? <Text style={[styles.errorText, { color: theme.roles.error }]}>{errorMessage}</Text> : null}
    </Card>
  );
}

function PendingRatingCard({ prompt }: { prompt: PendingRatingPromptDTO }) {
  const { theme } = useTheme();
  const fonts = useThemeFonts();
  const c = theme.colors;
  const router = useRouter();
  const t = useT();

  return (
    <Card
      onPress={() => router.push(`/(app)/seans/degerlendir/${prompt.bookingId}`)}
      accessibilityLabel={t('mHome.a11y.rateSession', { service: prompt.serviceTypeName })}
      style={styles.card}
    >
      <Text style={[styles.cardTitle, fonts.bodyStrong, { color: c.textPrimary }]}>{t('mHome.howWasYourSession')}</Text>
      <Text style={[styles.cardSubtitle, fonts.body, { color: c.textSecondary }]}>
        {prompt.serviceTypeName}
        {prompt.trainerName ? ` - ${prompt.trainerName}` : ''}
      </Text>
      <Text style={[styles.rateText, fonts.bodyMedium, { color: c.primaryText }]}>{t('mHome.rate')}</Text>
    </Card>
  );
}

export default function HomeScreen() {
  const { theme } = useTheme();
  const fonts = useThemeFonts();
  const c = theme.colors;
  const router = useRouter();
  const { user, activeMembership } = useSession();
  const t = useT();
  const isMember = Boolean(activeMembership?.memberProfileId);
  const [bookings, setBookings] = useState<UpcomingBookingDTO[] | null>(null);
  const [pendingRatings, setPendingRatings] = useState<PendingRatingPromptDTO[]>([]);
  const [loadError, setLoadError] = useState<string | undefined>();
  const onBand = theme.colors.onPrimary;

  const loadBookings = useCallback(async () => {
    setLoadError(undefined);
    try {
      const data = await apiRequest<MeUpcomingBookingsDTO>('/me/bookings/upcoming');
      setBookings(data.items);
      // Widgets show the same "next session"; keep them in sync opportunistically.
      refreshWidgets();
    } catch (error) {
      setLoadError(error instanceof ApiError ? error.message : t('mHome.errors.bookingsLoadFailed'));
    }
  }, []);

  const loadPendingRatings = useCallback(async () => {
    if (!isMember || !activeMembership?.studioId) return;
    try {
      const data = await apiRequest<PendingRatingPromptDTO[]>(`/ratings/studio/${activeMembership.studioId}/me/pending`);
      setPendingRatings(data);
    } catch {
      // Non-critical: the home screen still works without the prompt card.
    }
  }, [isMember, activeMembership?.studioId]);

  useEffect(() => {
    loadBookings();
    loadPendingRatings();
    // Health sync (W21): best-effort, silent, privacy-gated entirely
    // server-side (writeWorkouts/readAggregates/shareWithStudio + consent).
    // A no-op everywhere except a real device build with the member opted in.
    if (isMember && activeMembership?.studioId && activeMembership.memberProfileId) {
      const studioId = activeMembership.studioId;
      const memberId = activeMembership.memberProfileId;
      syncAllPendingWorkouts(studioId, memberId).catch(() => undefined);
      syncTodayAggregatesIfOptedIn(studioId).catch(() => undefined);
    }
  }, [loadBookings, loadPendingRatings, isMember, activeMembership?.studioId, activeMembership?.memberProfileId]);

  return (
    <ScreenContainer>
      <View style={[styles.band, { borderRadius: radii.md, backgroundColor: theme.colors.primary }]}>
        {activeMembership ? (
          <Text style={[styles.studio, fonts.bodyStrong, { color: onBand }]}>{activeMembership.studioName}</Text>
        ) : null}
        <Text style={[styles.name, fonts.display, { color: onBand }]}>{t('mHome.greeting', { name: user?.firstName ?? '' })}</Text>
      </View>

      {pendingRatings.map((prompt) => (
        <PendingRatingCard key={prompt.bookingId} prompt={prompt} />
      ))}

      {isMember ? (
        <Card onPress={() => router.push('/(app)/seans')} accessibilityLabel={t('mHome.a11y.viewThisWeeksSessions')} style={styles.link}>
          <Text style={[styles.linkTitle, fonts.bodyStrong, { color: c.textPrimary }]}>{t('mHome.thisWeeksSessions')}</Text>
          <Text style={[styles.linkSubtitle, fonts.body, { color: c.textSecondary }]}>{t('mHome.pickSessionToBook')}</Text>
        </Card>
      ) : null}

      {isMember ? (
        <Card onPress={() => router.push('/(app)/hesabim/basarilarim')} accessibilityLabel={t('mHome.a11y.viewMyAchievements')} style={styles.link}>
          <Text style={[styles.linkTitle, fonts.bodyStrong, { color: c.textPrimary }]}>{t('mHome.myAchievements')}</Text>
          <Text style={[styles.linkSubtitle, fonts.body, { color: c.textSecondary }]}>{t('mHome.achievementsSubtitle')}</Text>
        </Card>
      ) : null}

      <SectionTitle title={t('mHome.upcomingBookings')} />

      {bookings === null && !loadError ? <ActivityIndicator color={c.textPrimary} /> : null}
      {loadError ? <Text style={[styles.errorText, { color: theme.roles.error }]}>{loadError}</Text> : null}
      {bookings?.length === 0 ? <EmptyState title={t('mHome.noUpcomingBookings')} /> : null}
      {bookings?.map((booking) => (
        <UpcomingBookingCard key={booking.bookingId} booking={booking} />
      ))}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  band: {
    padding: spacing[5],
    marginBottom: spacing[5],
  },
  studio: {
    fontSize: typography.size.sm,
    marginBottom: spacing[1],
    opacity: 0.9,
  },
  name: {
    fontSize: typography.size.xl,
  },
  link: {
    marginBottom: spacing[4],
  },
  linkTitle: {
    fontSize: typography.size.md,
    marginBottom: spacing[1] / 2,
  },
  linkSubtitle: {
    fontSize: typography.size.sm,
  },
  card: {
    marginBottom: spacing[3],
    gap: 0,
  },
  rateText: {
    fontSize: typography.size.sm,
    marginTop: spacing[2],
  },
  cardTitle: {
    fontSize: typography.size.md,
    marginBottom: spacing[1],
  },
  cardSubtitle: {
    fontSize: typography.size.sm,
    marginBottom: spacing[1],
  },
  calendarButton: {
    marginTop: spacing[2],
    alignSelf: 'flex-start',
  },
  errorText: {
    fontSize: typography.size.xs,
    marginTop: spacing[1],
  },
});
