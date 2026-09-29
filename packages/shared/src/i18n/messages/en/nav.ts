import type { trNav } from '../tr/nav';

export const enNav = {
  'nav.dashboard': 'Overview',
  'nav.calendar': 'Calendar',
  'nav.attendance': 'Attendance',
  'nav.members': 'Members',
  'nav.packages': 'Package Definitions',
  'nav.trainers': 'Trainers',
  'nav.finance': 'Finance',
  'nav.payroll': 'Payroll',
  'nav.reports': 'Reports',
  'nav.leads': 'Leads',
  'nav.ads': 'Ad performance',
  'nav.churn': 'At-Risk Members',
  'nav.contacts': 'Contacts',
  'nav.segments': 'Segments',
  'nav.campaigns': 'Campaigns',
  'nav.journeys': 'Journeys',
  'nav.inbox': 'Inbox',
  'nav.settings': 'Settings',
} as const satisfies Record<keyof typeof trNav, string>;
