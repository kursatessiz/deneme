import type { trMSession } from '../tr/mSession';

export const enMSession: Record<keyof typeof trMSession, string> = {
  'mSession.notFound': 'Session not found.',
  'mSession.session': 'Session',
  'mSession.trainerLabel': 'Trainer: {name}',
  'mSession.substituteSuffix': ' (substitute)',
  'mSession.resourceLabel': 'Resource: {name}',
  'mSession.capacityLabel': 'Capacity: {booked}/{capacity}',
  'mSession.cancelledNotice': 'Session cancelled',
  'mSession.cancelledReasonSuffix': ': {reason}',
  'mSession.editSession': 'Edit session',
  'mSession.cancelSession': 'Cancel session',
  'mSession.substituteRequest': 'Substitute trainer request',
  'mSession.changeTrainer': 'Change trainer',
  'mSession.participants': 'Participants ({count})',
  'mSession.noBookingsYet': 'No bookings yet.',
  'mSession.checkIn': 'Check in',
  'mSession.noShow': 'No-show',
  'mSession.errors.loadFailed': 'Session could not be loaded.',
  'mSession.errors.actionFailed': 'Action failed.',
};
