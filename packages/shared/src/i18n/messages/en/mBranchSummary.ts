import type { trMBranchSummary } from '../tr/mBranchSummary';

export const enMBranchSummary: Record<keyof typeof trMBranchSummary, string> = {
  'mBranchSummary.last30Days': 'Last 30 days',
  'mBranchSummary.metric.occupancy': 'Occupancy',
  'mBranchSummary.metric.sessions': 'Sessions',
  'mBranchSummary.metric.attended': 'Attended',
  'mBranchSummary.metric.noShows': 'No-shows',
  'mBranchSummary.metric.revenue': 'Revenue',
  'mBranchSummary.metric.members': 'Members',
  'mBranchSummary.metric.branches': 'Branches',
  'mBranchSummary.metric.activeMembers': 'Active members',
  'mBranchSummary.allMyBusinesses': 'All my businesses',
  'mBranchSummary.errors.loadFailed': 'Summary could not be loaded.',
};
