import type { trMReferral } from '../tr/mReferral';

export const enMReferral: Record<keyof typeof trMReferral, string> = {
  'mReferral.status.pending': 'Pending',
  'mReferral.status.qualified': 'Qualified',
  'mReferral.status.rewarded': 'Rewarded',
  'mReferral.status.voided': 'Voided',
  'mReferral.title': 'Refer a friend',
  'mReferral.subtitle': 'Share your code with friends; you both earn when they sign up.',
  'mReferral.yourCode': 'Your code',
  'mReferral.share': 'Share',
  'mReferral.myReferrals': 'My referrals',
  'mReferral.noReferralsYet': "You don't have any referrals yet.",
  'mReferral.errors.loadFailed': 'Referral info could not be loaded.',
};
