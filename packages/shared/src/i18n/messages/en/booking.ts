import type { trBooking } from '../tr/booking';

/** English text for the `booking.*` namespace. Keep keys in sync with tr/booking.ts. */
export const enBooking = {
  'booking.backToList': 'Back to studio list',
  'booking.confirmed.title': 'Booking confirmed!',
  'booking.confirmed.summary': 'Your {type} session was booked for {date} at {slot}. 1 credit was deducted from your remaining sessions.',
  'booking.confirmed.cancellationNote': 'Note: cancellations are free up to 4 hours before the session.',
  'booking.confirmed.newBooking': 'Book another session',
  'booking.badge': 'Online booking',
  'booking.intro': 'Please choose a session type and a time that works for you',
  'booking.sessionType': 'Session type',
  'booking.dateSelection': 'Choose a date',
  'booking.availableSlots': 'Available session times',
  'booking.confirm': 'Confirm booking',
} as const satisfies Record<keyof typeof trBooking, string>;
