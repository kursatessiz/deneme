import type { trMTheme } from '../tr/mTheme';

export const enMTheme: Record<keyof typeof trMTheme, string> = {
  'mTheme.lead':
    'The theme you choose is the default for your members and staff. Users can pick a different theme on their own device; the logo, primary color and gradient always stay yours.',
  'mTheme.family': 'Theme family',
  'mTheme.recommendedFor': 'Recommended for: {recommendedFor}.',
  'mTheme.gradient': 'Gradient',
  'mTheme.primaryColor': 'Primary color: {color}',
  'mTheme.saved': 'Theme saved.',
  'mTheme.save': 'Save',
  'mTheme.errors.loadFailed': 'Theme could not be loaded.',
  'mTheme.errors.saveFailed': 'Theme could not be saved.',
};
