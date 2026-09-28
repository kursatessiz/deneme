import type { trLayout } from '../tr/layout';

export const enLayout = {
  'layout.managementPanel': 'Management Panel',
  'layout.activeStudio': 'Active Business',
  'layout.allBranches': 'All branches',
  'layout.signOut': 'Sign out',
} as const satisfies Record<keyof typeof trLayout, string>;
