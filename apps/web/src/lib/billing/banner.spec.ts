import { billingBannerFor } from './banner';

const NOW = new Date('2026-10-10T12:00:00Z');
const inDays = (d: number) => new Date(NOW.getTime() + d * 24 * 60 * 60 * 1000).toISOString();

describe('billingBannerFor', () => {
  it('shows nothing for an active studio or a missing summary', () => {
    expect(billingBannerFor({ status: 'ACTIVE', trialEndsAt: null }, NOW)).toBeNull();
    expect(billingBannerFor(undefined, NOW)).toBeNull();
  });

  it('counts whole days left in a trial, rounded up', () => {
    expect(billingBannerFor({ status: 'TRIALING', trialEndsAt: inDays(14) }, NOW)).toEqual({ kind: 'trial', daysLeft: 14 });
    expect(billingBannerFor({ status: 'TRIALING', trialEndsAt: inDays(2.5) }, NOW)).toEqual({ kind: 'trial', daysLeft: 3 });
  });

  it('reads "ends today" in the last day and after an unprocessed end', () => {
    expect(billingBannerFor({ status: 'TRIALING', trialEndsAt: inDays(0.5) }, NOW)).toEqual({ kind: 'trialEndsToday' });
    expect(billingBannerFor({ status: 'TRIALING', trialEndsAt: inDays(-1) }, NOW)).toEqual({ kind: 'trialEndsToday' });
  });

  it('maps restricted, past due and cancelled', () => {
    expect(billingBannerFor({ status: 'RESTRICTED', trialEndsAt: inDays(-1) }, NOW)).toEqual({ kind: 'restricted' });
    expect(billingBannerFor({ status: 'PAST_DUE', trialEndsAt: null }, NOW)).toEqual({ kind: 'pastDue' });
    expect(billingBannerFor({ status: 'CANCELLED', trialEndsAt: null }, NOW)).toEqual({ kind: 'cancelled' });
  });
});
