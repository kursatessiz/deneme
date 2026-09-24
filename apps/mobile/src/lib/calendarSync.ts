import { Platform } from 'react-native';
import * as Calendar from 'expo-calendar/legacy';
import type { UpcomingBookingDTO } from '@platform/shared';

export class CalendarSyncError extends Error {}

/** Finds a calendar the app can write events into: default on iOS, primary/first writable on Android. */
async function resolveWritableCalendarId(): Promise<string> {
  if (Platform.OS === 'ios') {
    const defaultCalendar = await Calendar.getDefaultCalendarAsync();
    return defaultCalendar.id;
  }

  const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
  const writable = calendars.filter((c) => c.allowsModifications);
  const primary = writable.find((c) => c.isPrimary) ?? writable[0];
  if (!primary) throw new CalendarSyncError('Yazılabilir takvim bulunamadı');
  return primary.id;
}

/**
 * Adds a booking to the device's default calendar with a 60-minute
 * reminder before the session starts. Requests calendar permission first;
 * throws CalendarSyncError with a Turkish message the UI can show directly
 * when permission is denied or no writable calendar exists.
 */
export async function addBookingToDeviceCalendar(booking: UpcomingBookingDTO): Promise<void> {
  const { status } = await Calendar.requestCalendarPermissionsAsync();
  if (status !== 'granted') {
    throw new CalendarSyncError('Takvim izni verilmedi. Ayarlardan izin verip tekrar deneyin.');
  }

  const calendarId = await resolveWritableCalendarId();
  const location = [booking.branchName, booking.studioName].filter(Boolean).join(', ');

  await Calendar.createEventAsync(calendarId, {
    title: `${booking.serviceName} - ${booking.studioName}`,
    startDate: new Date(booking.startTime),
    endDate: new Date(booking.endTime),
    location,
    notes: booking.trainerName ? `Eğitmen: ${booking.trainerName}` : undefined,
    alarms: [{ relativeOffset: -60 }],
  });
}
