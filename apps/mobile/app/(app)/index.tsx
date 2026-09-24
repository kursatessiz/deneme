import type { MeUpcomingBookingsDTO, UpcomingBookingDTO } from '@platform/shared';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { ScreenContainer } from '../../src/components/ScreenContainer';
import { ApiError, apiRequest } from '../../src/lib/api';
import { addBookingToDeviceCalendar, CalendarSyncError } from '../../src/lib/calendarSync';
import { useSession } from '../../src/lib/session';
import { palette, radii, spacing, typography, useThemeColors } from '../../src/theme';
import { refreshWidgets } from '../../src/widgets';

function formatBookingTime(booking: UpcomingBookingDTO): string {
  const start = new Date(booking.startTime);
  return new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(
    start,
  );
}

function UpcomingBookingCard({ booking }: { booking: UpcomingBookingDTO }) {
  const colors = useThemeColors();
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
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>{booking.serviceName}</Text>
      <Text style={[styles.cardSubtitle, { color: colors.textSecondary }]}>
        {booking.studioName}
        {booking.branchName ? ` - ${booking.branchName}` : ''}
      </Text>
      <Text style={[styles.cardSubtitle, { color: colors.textSecondary }]}>{formatBookingTime(booking)}</Text>
      {booking.trainerName ? (
        <Text style={[styles.cardSubtitle, { color: colors.textMuted }]}>Egitmen: {booking.trainerName}</Text>
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Takvime ekle"
        onPress={handleAddToCalendar}
        disabled={status === 'saving' || status === 'saved'}
        style={styles.calendarButton}
      >
        <Text style={styles.calendarButtonText}>
          {status === 'saved' ? 'Takvime eklendi' : status === 'saving' ? 'Ekleniyor...' : 'Takvime ekle'}
        </Text>
      </Pressable>
      {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}
    </View>
  );
}

export default function HomeScreen() {
  const colors = useThemeColors();
  const { user, activeMembership } = useSession();
  const [bookings, setBookings] = useState<UpcomingBookingDTO[] | null>(null);
  const [loadError, setLoadError] = useState<string | undefined>();

  const loadBookings = useCallback(async () => {
    setLoadError(undefined);
    try {
      const data = await apiRequest<MeUpcomingBookingsDTO>('/me/bookings/upcoming');
      setBookings(data.items);
      // Widgets show the same "next session"; keep them in sync opportunistically.
      refreshWidgets();
    } catch (error) {
      setLoadError(error instanceof ApiError ? error.message : 'Rezervasyonlar yuklenemedi.');
    }
  }, []);

  useEffect(() => {
    loadBookings();
  }, [loadBookings]);

  return (
    <ScreenContainer>
      <Text style={[styles.greeting, { color: colors.textSecondary }]}>Merhaba,</Text>
      <Text style={[styles.name, { color: colors.textPrimary }]}>
        {user?.firstName ?? ''} {user?.lastName ?? ''}
      </Text>

      {activeMembership ? (
        <Text style={[styles.studio, { color: colors.textSecondary }]}>{activeMembership.studioName} stüdyosundasınız</Text>
      ) : null}

      <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>Yaklasan rezervasyonlarim</Text>

      {bookings === null && !loadError ? <ActivityIndicator color={colors.textPrimary} /> : null}
      {loadError ? <Text style={styles.errorText}>{loadError}</Text> : null}
      {bookings?.length === 0 ? (
        <Text style={[styles.emptyText, { color: colors.textMuted }]}>Yaklasan rezervasyonunuz yok.</Text>
      ) : null}
      {bookings?.map((booking) => (
        <UpcomingBookingCard key={booking.bookingId} booking={booking} />
      ))}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  greeting: {
    fontSize: typography.size.sm,
    marginBottom: spacing[1],
  },
  name: {
    fontSize: typography.size['2xl'],
    fontWeight: typography.weight.bold,
    marginBottom: spacing[4],
  },
  studio: {
    fontSize: typography.size.md,
    marginBottom: spacing[4],
  },
  sectionTitle: {
    fontSize: typography.size.sm,
    fontWeight: typography.weight.medium,
    marginBottom: spacing[2],
  },
  emptyText: {
    fontSize: typography.size.sm,
  },
  card: {
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing[4],
    marginBottom: spacing[3],
  },
  cardTitle: {
    fontSize: typography.size.md,
    fontWeight: typography.weight.semibold,
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
  },
  calendarButtonText: {
    color: palette.info,
    fontSize: typography.size.sm,
    fontWeight: typography.weight.semibold,
  },
  errorText: {
    color: palette.danger,
    fontSize: typography.size.xs,
    marginTop: spacing[1],
  },
});
