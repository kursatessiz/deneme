import type { trMWalkIn } from '../tr/mWalkIn';

export const enMWalkIn: Record<keyof typeof trMWalkIn, string> = {
  'mWalkIn.bookingCreated': 'Booking created',
  'mWalkIn.backToMemberCard': 'Back to member card',
  'mWalkIn.title': 'Add to session (walk-in)',
  'mWalkIn.lead': 'Sessions with open spots in the next 7 days',
  'mWalkIn.noAvailableSessions': 'No available sessions found.',
  'mWalkIn.add': 'Add',
  'mWalkIn.errors.sessionsLoadFailed': 'Sessions could not be loaded.',
  'mWalkIn.errors.bookingFailed': 'Booking could not be made.',
};
