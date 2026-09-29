import type { trMApiErrors } from '../tr/mApiErrors';

export const enMApiErrors: Record<keyof typeof trMApiErrors, string> = {
  'mApiErrors.networkUnreachable': 'Could not connect to the server. Check your connection and try again.',
  'mApiErrors.sessionExpired': 'Your session has expired, please sign in again.',
  'mApiErrors.tooManyAttempts': 'Too many attempts. Please try again in a while.',
  'mApiErrors.unexpectedError': 'An unexpected error occurred.',
  'mApiErrors.kioskNotPaired': 'This device is not paired',
};
