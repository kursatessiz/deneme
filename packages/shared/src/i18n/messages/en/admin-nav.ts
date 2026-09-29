import type { trAdminNav } from '../tr/admin-nav';

export const enAdminNav = {
  'adminNav.tenants': 'Tenants',
  'adminNav.plans': 'Plans',
  'adminNav.businessTypes': 'Business Types',
  'adminNav.featureFlags': 'Feature Flags',
  'adminNav.smsPackages': 'SMS Packages',
  'adminNav.content': 'Templates and Documents',
  'adminNav.webSitesi': 'Website',
  'adminNav.languages': 'Languages',
  'adminNav.benchmark': 'Benchmark',
  'adminNav.health': 'System Health',
  'adminNav.backups': 'Backups',
  'adminNav.layout.kicker': 'Platform Management',
  'adminNav.layout.title': 'Super Admin Panel',
  'adminNav.layout.signedInAs': 'Signed in as {firstName} {lastName}',
} as const satisfies Record<keyof typeof trAdminNav, string>;
