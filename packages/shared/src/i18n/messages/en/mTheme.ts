import type { trMTheme } from '../tr/mTheme';

export const enMTheme: Record<keyof typeof trMTheme, string> = {
  'mTheme.lead':
    'The logo and primary color appear in the app of your members and staff. Light, dark or system is each user\'s own choice; the logo and primary color always stay yours.',
  'mTheme.logoUrl': 'Logo URL',
  'mTheme.primaryColorLabel': 'Primary color',
  'mTheme.colorFormatError': 'The color must be in #RRGGBB format.',
  'mTheme.saved': 'Theme saved.',
  'mTheme.save': 'Save',
  'mTheme.errors.loadFailed': 'Theme could not be loaded.',
  'mTheme.errors.saveFailed': 'Theme could not be saved.',
};
