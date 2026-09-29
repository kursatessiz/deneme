import type { trAdminSmsPackages } from '../tr/admin-sms-packages';

export const enAdminSmsPackages = {
  'adminSmsPackages.title': 'SMS Packages',
  'adminSmsPackages.subtitle': 'SMS credit packages for sale and manual credit top-ups',
  'adminSmsPackages.topUp.title': 'Manual credit top-up',
  'adminSmsPackages.topUp.studioId': 'Tenant (studio) ID',
  'adminSmsPackages.topUp.credits': 'Credits (negative = deduct)',
  'adminSmsPackages.topUp.note': 'Note (optional)',
  'adminSmsPackages.topUp.submit': 'Top Up Credits',
  'adminSmsPackages.topUp.submitting': 'Topping up...',
  'adminSmsPackages.topUp.newBalance': 'New balance: {balance} credits',
  'adminSmsPackages.topUp.failed': 'Top-up failed',
  'adminSmsPackages.form.title': 'Create / update package',
  'adminSmsPackages.form.key': 'Key',
  'adminSmsPackages.form.name': 'Name',
  'adminSmsPackages.form.credits': 'Credits',
  'adminSmsPackages.form.price': 'Price (TRY)',
  'adminSmsPackages.form.submit': 'Save',
  'adminSmsPackages.form.submitting': 'Saving...',
  'adminSmsPackages.form.saveFailed': 'Could not save',
  'adminSmsPackages.accessDenied': 'No access',
  'adminSmsPackages.cardSummary': '{credits} credits · {price} TRY',
} as const satisfies Record<keyof typeof trAdminSmsPackages, string>;
