import type { trMBranches } from '../tr/mBranches';

export const enMBranches: Record<keyof typeof trMBranches, string> = {
  'mBranches.homeBranchLead': 'This branch is shown first in the calendar and notifications. You can still book at other branches.',
  'mBranches.noPreference': "I don't want to specify",
  'mBranches.errors.loadFailed': 'Branches could not be loaded.',
  'mBranches.errors.homeBranchSaveFailed': 'Home branch could not be saved.',
};
