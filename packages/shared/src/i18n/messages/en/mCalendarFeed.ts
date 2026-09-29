import type { trMCalendarFeed } from '../tr/mCalendarFeed';

export const enMCalendarFeed: Record<keyof typeof trMCalendarFeed, string> = {
  'mCalendarFeed.title': 'Calendar subscription',
  'mCalendarFeed.description':
    'You can automatically sync your bookings by subscribing to them from your phone or computer calendar app. The link is shown only when created; you can regenerate it if you lose it.',
  'mCalendarFeed.subscriptionUrl': 'Subscription link',
  'mCalendarFeed.copied': 'Copied',
  'mCalendarFeed.copyUrl': 'Copy link',
  'mCalendarFeed.openInCalendarApp': 'Open in calendar app',
  'mCalendarFeed.cancelSubscription': 'Cancel subscription',
  'mCalendarFeed.createSubscription': 'Create calendar subscription',
  'mCalendarFeed.regenerateHint': 'Regenerating (rotating) invalidates the previous link.',
  'mCalendarFeed.refreshUrl': 'Refresh link',
  'mCalendarFeed.errors.createFailed': 'Calendar subscription could not be created.',
  'mCalendarFeed.errors.revokeFailed': 'Subscription could not be cancelled.',
};
