import type { trMErrors } from '../tr/mErrors';

export const enMErrors: Record<keyof typeof trMErrors, string> = {
  'mErrors.boundary.title': 'Something went wrong',
  'mErrors.boundary.description': 'The app ran into an unexpected error. It has been recorded; you can try again.',
  'mErrors.boundary.code': 'Error code: {code}',
  'mErrors.boundary.codeHint': 'If you contact support, share this code.',
  'mErrors.boundary.retry': 'Try again',
};
