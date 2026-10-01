import type { trLayout } from '../tr/layout';

export const enLayout = {
  'layout.managementPanel': 'Management Panel',
  'layout.activeStudio': 'Active Business',
  'layout.allBranches': 'All branches',
  'layout.signOut': 'Sign out',
  'layout.activeBranch': 'Active branch',
  'layout.userMenu': 'User menu',
  'layout.darkMode': 'Dark mode',
  'layout.appearanceSettings': 'Appearance settings',
  'layout.appearanceSaveFailed': 'Appearance preference could not be saved.',
} as const satisfies Record<keyof typeof trLayout, string>;
