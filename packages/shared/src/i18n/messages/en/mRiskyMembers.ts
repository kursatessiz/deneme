import type { trMRiskyMembers } from '../tr/mRiskyMembers';

export const enMRiskyMembers: Record<keyof typeof trMRiskyMembers, string> = {
  'mRiskyMembers.level.high': 'High',
  'mRiskyMembers.level.medium': 'Medium',
  'mRiskyMembers.level.low': 'Low',
  'mRiskyMembers.neverAttended': 'Never attended',
  'mRiskyMembers.caption': 'High and medium risk members',
  'mRiskyMembers.noRiskyMembers': 'No risky members.',
  'mRiskyMembers.levelScore': '{level} - {score}',
  'mRiskyMembers.lastAttended': 'Last attended: {date}',
  'mRiskyMembers.a11y.markContacted': 'Mark {name} as contacted',
  'mRiskyMembers.contactedToday': 'Contacted today',
  'mRiskyMembers.markContacted': 'Contacted',
  'mRiskyMembers.defaultContactNote': 'Contacted by phone',
  'mRiskyMembers.errors.loadFailed': 'Risky members could not be loaded.',
  'mRiskyMembers.errors.markContactedFailed': 'Could not mark as contacted.',
};
