import type { trMErrors } from '../tr/mErrors';

export const enMErrors: Record<keyof typeof trMErrors, string> = {
  'mErrors.boundary.title': 'Something went wrong',
  'mErrors.boundary.description': 'The app ran into an unexpected error. It has been recorded; you can try again.',
  'mErrors.boundary.code': 'Error code: {code}',
  'mErrors.boundary.codeHint': 'If you contact support, share this code.',
  'mErrors.boundary.retry': 'Try again',
  'mErrors.feedback.label': 'What were you doing? (optional)',
  'mErrors.feedback.placeholder': 'Briefly describe what you did before you saw the error. Do not include an e-mail address or phone number.',
  'mErrors.feedback.counter': '{count} / {max}',
  'mErrors.feedback.submit': 'Send',
  'mErrors.feedback.sent': 'Thank you, your note was sent.',
  'mErrors.feedback.failed': 'Your note could not be sent. You can try again in a moment.',
};
