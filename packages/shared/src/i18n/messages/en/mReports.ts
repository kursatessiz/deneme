import type { trMReports } from '../tr/mReports';

export const enMReports: Record<keyof typeof trMReports, string> = {
  'mReports.period': 'Last 30 days',
  'mReports.occupancy': 'Occupancy',
  'mReports.revenue': 'Revenue',
  'mReports.activeMembers': 'Active members',
  'mReports.newMembers': 'New members',
  'mReports.churnedMembers': 'Lost members',
  'mReports.arpu': 'Revenue per member',
  'mReports.renewalRate': 'Renewal rate',
  'mReports.packagesRenewed': '{renewed} of {expired} packages renewed',
  'mReports.topTrainers': 'Top 5 busiest trainers',
  'mReports.sessions.one': '{count} session',
  'mReports.sessions.other': '{count} sessions',
  'mReports.loadFailed': 'Reports could not be loaded.',
};
