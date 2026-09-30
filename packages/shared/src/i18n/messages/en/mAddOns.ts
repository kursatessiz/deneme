import type { trMAddOns } from '../tr/mAddOns';

export const enMAddOns: Record<keyof typeof trMAddOns, string> = {
  'mAddOns.title': 'Apps',
  'mAddOns.intro': 'The apps that are active or being tried in your business. Use the web panel to buy, activate or cancel.',
  'mAddOns.loadFailed': 'Apps could not be loaded',
  'mAddOns.empty': 'There are no active or trialing apps right now.',
  'mAddOns.state.TRIALING': 'Trial',
  'mAddOns.state.ACTIVE': 'Active',
  'mAddOns.state.CANCELLED': 'Cancelled',
  'mAddOns.trialLeft.one': '{count} day left',
  'mAddOns.trialLeft.other': '{count} days left',
  'mAddOns.accessUntil': 'Access until {date}',
  'mAddOns.renews': 'Renews: {date}',
  'mAddOns.openWeb': 'Manage in the web panel',
};
