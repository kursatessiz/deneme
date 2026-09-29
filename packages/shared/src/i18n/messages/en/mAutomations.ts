import type { trMAutomations } from '../tr/mAutomations';

export const enMAutomations: Record<keyof typeof trMAutomations, string> = {
  'mAutomations.type.winBack': 'Win-back lost members',
  'mAutomations.type.packageExpiring': 'Package expiry reminder',
  'mAutomations.type.birthday': 'Birthday message',
  'mAutomations.type.firstClassFollowUp': 'First-session follow-up',
  'mAutomations.type.bookingReminder': 'Session reminder',
  'mAutomations.type.noShowFollowUp': 'No-show follow-up',
  'mAutomations.intro':
    'Automated messages are sent to members under certain conditions. Marketing messages (win-back, birthday) are sent only to members who gave explicit consent.',
  'mAutomations.marketingSuffix': ' · Marketing (requires consent)',
  'mAutomations.activeLabel': '{name} active',
  'mAutomations.last30Days': 'Last 30 days:',
  'mAutomations.sentCount': '{count} sent',
  'mAutomations.skippedCount': '{count} skipped',
  'mAutomations.failedCount': '{count} failed',
  'mAutomations.errors.loadFailed': 'Automation rules could not be loaded.',
  'mAutomations.errors.toggleFailed': 'Change could not be saved, try again.',
};
