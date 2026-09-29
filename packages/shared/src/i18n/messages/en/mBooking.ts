import type { trMBooking } from '../tr/mBooking';

export const enMBooking: Record<keyof typeof trMBooking, string> = {
  'mBooking.status.confirmed': 'Confirmed',
  'mBooking.status.attended': 'Attended',
  'mBooking.status.cancelledEarly': 'Cancelled',
  'mBooking.status.cancelledLate': 'Late cancel',
  'mBooking.status.noShow': 'No-show',
  'mBooking.status.waitlist': 'Waitlist',
  'mBooking.genericMember': 'Member',
};
