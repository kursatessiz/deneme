import type { MeUpcomingBookingsDTO, PendingRatingPromptDTO, UpcomingBookingDTO } from '@platform/shared';
import { onColor } from '@platform/shared';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { GradientSurface } from '../../src/components/GradientSurface';
import { ScreenContainer } from '../../src/components/ScreenContainer';
import { ApiError, apiRequest } from '../../src/lib/api';
import { addBookingToDeviceCalendar, CalendarSyncError } from '../../src/lib/calendarSync';
import { useSession } from '../../src/lib/session';
import { palette, spacing, typography, useTheme, useThemeFonts } from '../../src/theme';
import { refreshWidgets } from '../../src/widgets';

function formatBookingTime(booking: UpcomingBookingDTO): string {
  return new Intl.DateTimeFormat('tr-TR', {
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
  const c = theme.colors;
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | undefined>();

  const handleAddToCalendar = async () => {
    setStatus('saving');
    setErrorMessage(undefined);
    try {
      await addBookingToDeviceCalendar(booking);
      setStatus('saved');
    } catch (error) {
      setStatus('error');
      setErrorMessage(error instanceof CalendarSyncError ? error.message : 'Takvime eklenemedi, tekrar deneyin.');
    }
  };

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: c.surface,
          borderColor: c.border,
          borderRadius: theme.family.radii.card,
          borderWidth: theme.family.cardBorder ? 1 : 0,
        },
      ]}
    >
      <Text style={[styles.cardTitle, fonts.bodyStrong, { color: c.textPrimary }]}>{booking.serviceName}</Text>
      <Text style={[styles.cardSubtitle, fonts.body, { color: c.textSecondary }]}>{formatBookingTime(booking)}</Text>
      <Text style={[styles.cardSubtitle, fonts.body, { color: c.textSecondary }]}>
        {booking.studioName}
        {booking.branchName ? `, ${booking.branchName}` : ''}
      </Text>
      {booking.trainerName ? (
        <Text style={[styles.cardSubtitle, fonts.body, { color: c.textMuted }]}>Eğitmen: {booking.trainerName}</Text>
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Takvime ekle"
        onPress={handleAddToCalendar}
        disabled={status === 'saving' || status === 'saved'}
        style={styles.calendarButton}
      >
        <Text style={[styles.calendarButtonText, fonts.bodyStrong, { color: c.textPrimary }]}>
          {status === 'saved' ? 'Takvime eklendi' : status === 'saving' ? 'Ekleniyor...' : 'Takvime ekle'}
        </Text>
      </Pressable>
      {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}
    </View>
  );
}

function PendingRatingCard({ prompt }: { prompt: PendingRatingPromptDTO }) {
  const { theme } = useTheme();
  const fonts = useThemeFonts();
  const c = theme.colors;
  const router = useRouter();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${prompt.serviceTypeName} seansını değerlendir`}
      onPress={() => router.push(`/(app)/seans/degerlendir/${prompt.bookingId}`)}
      style={[
        styles.card,
        {
          backgroundColor: c.surface,
          borderColor: c.border,
          borderRadius: theme.family.radii.card,
          borderWidth: theme.family.cardBorder ? 1 : 0,
        },
      ]}
    >
      <Text style={[styles.cardTitle, fonts.bodyStrong, { color: c.textPrimary }]}>Seansını nasıl buldun?</Text>
      <Text style={[styles.cardSubtitle, fonts.body, { color: c.textSecondary }]}>
        {prompt.serviceTypeName}
        {prompt.trainerName ? ` - ${prompt.trainerName}` : ''}
      </Text>
      <Text style={[styles.calendarButtonText, fonts.bodyStrong, { color: c.textPrimary }]}>Değerlendir</Text>
    </Pressable>
  );
}

export default function HomeScreen() {
  const { theme } = useTheme();
  const fonts = useThemeFonts();
  const c = theme.colors;
  const router = useRouter();
  const { user, activeMembership } = useSession();
  const isMember = Boolean(activeMembership?.memberProfileId);
  const [bookings, setBookings] = useState<UpcomingBookingDTO[] | null>(null);
  const [pendingRatings, setPendingRatings] = useState<PendingRatingPromptDTO[]>([]);
  const [loadError, setLoadError] = useState<string | undefined>();
  const onBand = onColor(theme.gradient.stops[0]);

  const loadBookings = useCallback(async () => {
    setLoadError(undefined);
    try {
      const data = await apiRequest<MeUpcomingBookingsDTO>('/me/bookings/upcoming');
      setBookings(data.items);
      // Widgets show the same "next session"; keep them in sync opportunistically.
      refreshWidgets();
    } catch (error) {
      setLoadError(error instanceof ApiError ? error.message : 'Rezervasyonlar yüklenemedi.');
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
  }, [loadBookings, loadPendingRatings]);

  return (
    <ScreenContainer>
      <GradientSurface slot="appHeaderBand" style={[styles.band, { borderRadius: theme.family.radii.card }]}>
        {activeMembership ? (
          <Text style={[styles.studio, fonts.bodyStrong, { color: onBand }]}>{activeMembership.studioName}</Text>
        ) : null}
        <Text style={[styles.name, fonts.display, { color: onBand }]}>Merhaba, {user?.firstName ?? ''}</Text>
      </GradientSurface>

      {pendingRatings.map((prompt) => (
        <PendingRatingCard key={prompt.bookingId} prompt={prompt} />
      ))}

      {isMember ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Bu haftanın seanslarını gör"
          onPress={() => router.push('/(app)/seans')}
          style={[
            styles.link,
            {
              borderColor: c.border,
              backgroundColor: c.surface,
              borderRadius: theme.family.radii.card,
              borderWidth: theme.family.cardBorder ? 1 : 0,
            },
          ]}
        >
          <Text style={[styles.linkTitle, fonts.bodyStrong, { color: c.textPrimary }]}>Bu haftanın seansları</Text>
          <Text style={[styles.linkSubtitle, fonts.body, { color: c.textSecondary }]}>Seans seçip yerinizi ayırın</Text>
        </Pressable>
      ) : null}

      <Text style={[styles.sectionTitle, fonts.bodyStrong, { color: c.textSecondary }]}>Yaklaşan rezervasyonlarım</Text>

      {bookings === null && !loadError ? <ActivityIndicator color={c.textPrimary} /> : null}
      {loadError ? <Text style={styles.errorText}>{loadError}</Text> : null}
      {bookings?.length === 0 ? (
        <Text style={[styles.emptyText, fonts.body, { color: c.textMuted }]}>Yaklaşan rezervasyonunuz yok.</Text>
      ) : null}
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
    fontSize: typography.size['2xl'],
  },
  link: {
    minHeight: 56,
    padding: spacing[4],
    justifyContent: 'center',
    marginBottom: spacing[5],
  },
  linkTitle: {
    fontSize: typography.size.md,
    marginBottom: 2,
  },
  linkSubtitle: {
    fontSize: typography.size.sm,
  },
  sectionTitle: {
    fontSize: typography.size.sm,
    marginBottom: spacing[2],
  },
  emptyText: {
    fontSize: typography.size.sm,
  },
  card: {
    padding: spacing[4],
    marginBottom: spacing[3],
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
    minHeight: 44,
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  calendarButtonText: {
    fontSize: typography.size.sm,
    textDecorationLine: 'underline',
  },
  errorText: {
    color: palette.danger,
    fontSize: typography.size.xs,
    marginTop: spacing[1],
  },
});
