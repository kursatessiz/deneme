import type { trErrors } from '../tr/errors';

export const enErrors: Record<keyof typeof trErrors, string> = {
  'errors.boundary.title': 'Something went wrong',
  'errors.boundary.description': 'This page ran into an unexpected error. It has been recorded; you can try again or go back to the home page.',
  'errors.boundary.code': 'Error code: {code}',
  'errors.boundary.codeHint': 'If you contact support, please share this code.',
  'errors.boundary.retry': 'Try again',
  'errors.boundary.home': 'Back to the home page',

  'errors.hub.title': 'Error reports',
  'errors.hub.description': 'Errors seen in your business and error codes for support',

  'errors.owner.title': 'Error reports',
  'errors.owner.description':
    'Errors seen in your business in the last 30 days. You can share the error code when you contact support; technical details are visible to the platform team only.',
  'errors.owner.empty': 'No errors recorded in the last 30 days.',
  'errors.owner.serverError': 'An unexpected server-side error',
  'errors.owner.col.message': 'Error',
  'errors.owner.col.source': 'Source',
  'errors.owner.col.count': 'Occurrences',
  'errors.owner.col.firstSeen': 'First seen',
  'errors.owner.col.lastSeen': 'Last seen',
  'errors.owner.col.code': 'Error code',
  'errors.owner.col.status': 'Status',

  'errors.source.api': 'Server',
  'errors.source.web': 'Web panel',
  'errors.source.mobile': 'Mobile app',
  'errors.source.job': 'Background job',
  'errors.status.OPEN': 'Open',
  'errors.status.RESOLVED': 'Resolved',
  'errors.status.IGNORED': 'Ignored',

  'errors.feedback.label': 'What were you doing? (optional)',
  'errors.feedback.placeholder': 'Briefly describe what you did before you saw the error. Do not include an e-mail address or phone number.',
  'errors.feedback.counter': '{count} / {max}',
  'errors.feedback.submit': 'Send',
  'errors.feedback.sent': 'Thank you, your note was sent.',
  'errors.feedback.failed': 'Your note could not be sent. You can try again in a moment.',
  'errors.owner.notify.title': 'E-mail notification',
  'errors.owner.notify.description': 'You get an e-mail when a new error group or a sudden increase in errors affects your users. You receive at most one e-mail per error per day.',
  'errors.owner.notify.toggle': 'Receive error notifications by e-mail',
  'errors.owner.notify.saved': 'Your notification preference was saved.',
  'errors.owner.notify.failed': 'The preference could not be saved.',
};
