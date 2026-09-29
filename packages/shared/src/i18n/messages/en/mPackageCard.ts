import type { trMPackageCard } from '../tr/mPackageCard';

export const enMPackageCard: Record<keyof typeof trMPackageCard, string> = {
  'mPackageCard.unlimitedDuration': 'Unlimited duration',
  'mPackageCard.creditsRemaining': '{remaining}/{total} credits left',
  'mPackageCard.sessionsRemaining': '{remaining}/{total} sessions left',
  'mPackageCard.status.active': 'Active',
  'mPackageCard.status.frozen': 'Frozen',
  'mPackageCard.status.expired': 'Expired',
  'mPackageCard.status.depleted': 'Depleted',
  'mPackageCard.endDate': 'Ends: {date}',
  'mPackageCard.frozenUntil': 'Frozen until: {date}',
};
