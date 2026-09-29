import type { trPackages } from '../tr/packages';

/** English text for the `packages.*` namespace. Keep keys in sync with tr/packages.ts. */
export const enPackages = {
  'packages.title': 'Package Definitions',
  'packages.subtitle': 'Session/credit packages available for sale',
  'packages.empty.title': 'No package defined yet',
  'packages.empty.description': 'A new package will show up here once you define one in business settings.',
  'packages.units.one': '{count} unit',
  'packages.units.other': '{count} units',
  'packages.unlimited': 'Unlimited',
  'packages.validity.one': 'Valid {count} day',
  'packages.validity.other': 'Valid {count} days',
  'packages.freezeDays.one': '{count} day of freeze allowance',
  'packages.freezeDays.other': '{count} days of freeze allowance',
} as const satisfies Record<keyof typeof trPackages, string>;
