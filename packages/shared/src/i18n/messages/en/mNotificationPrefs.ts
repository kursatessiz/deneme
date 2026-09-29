import type { trMNotificationPrefs } from '../tr/mNotificationPrefs';

export const enMNotificationPrefs: Record<keyof typeof trMNotificationPrefs, string> = {
  'mNotificationPrefs.pushDeniedBanner': 'Push notifications are not allowed. Grant permission from system settings to receive notifications.',
  'mNotificationPrefs.a11y.openSystemSettings': 'Open system settings',
  'mNotificationPrefs.openSettings': 'Open settings',
  'mNotificationPrefs.marketingNote': 'These notifications are never sent without your explicit consent and are off by default.',
  'mNotificationPrefs.push': 'Push',
  'mNotificationPrefs.sms': 'SMS',
  'mNotificationPrefs.errors.loadFailed': 'Notification settings could not be loaded.',
  'mNotificationPrefs.errors.saveFailed': 'Change could not be saved, try again.',
};
