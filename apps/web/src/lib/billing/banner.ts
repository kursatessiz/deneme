import { trialDaysLeft } from '@platform/shared';
import type { MembershipBillingSummary } from '@platform/shared';

export type BillingBanner =
  | { kind: 'trial'; daysLeft: number }
  | { kind: 'trialEndsToday' }
  | { kind: 'restricted' }
  | { kind: 'pastDue' }
  | { kind: 'cancelled' };

/**
 * What the dashboard banner shows for the active studio's platform
 * billing (G5c-1). Nothing for an ACTIVE studio or when the API sent no
 * billing summary (an older API). A trial with less than a day left, or a
 * past end the heartbeat has not processed yet, reads "ends today".
 */
export function billingBannerFor(billing: MembershipBillingSummary | undefined, now: Date = new Date()): BillingBanner | null {
  if (!billing) return null;
  switch (billing.status) {
    case 'TRIALING': {
      const days = trialDaysLeft(billing.trialEndsAt, now);
      if (days === null) return null;
      const msLeft = billing.trialEndsAt ? new Date(billing.trialEndsAt).getTime() - now.getTime() : 0;
      if (days <= 0 || msLeft < 24 * 60 * 60 * 1000) return { kind: 'trialEndsToday' };
      return { kind: 'trial', daysLeft: days };
    }
    case 'RESTRICTED':
      return { kind: 'restricted' };
    case 'PAST_DUE':
      return { kind: 'pastDue' };
    case 'CANCELLED':
      return { kind: 'cancelled' };
    default:
      return null;
  }
}
