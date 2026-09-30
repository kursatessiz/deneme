import { Prisma } from '@platform/database';
import type { AddOn, AddOnPrice, StudioAddOn } from '@platform/database';
import { toTenantDto } from './studio-add-ons.service';

const NOW = new Date('2026-10-30T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const at = (days: number) => new Date(NOW.getTime() + days * DAY);

function addOn(overrides: Partial<AddOn & { studioAddOns: StudioAddOn[] }> = {}): AddOn & { prices: AddOnPrice[]; studioAddOns: StudioAddOn[] } {
  return {
    id: 'a1',
    key: 'video',
    name: { tr: 'Video', en: 'Video' },
    description: { tr: 'Aciklama', en: 'Description' },
    promoVideoUrl: null,
    screenshotUrls: [],
    featureFlagKey: 'video_content',
    trialDays: 14,
    isPublished: true,
    sortOrder: 0,
    createdAt: NOW,
    updatedAt: NOW,
    prices: [
      { id: 'p1', addOnId: 'a1', currency: 'TRY', priceMonthly: new Prisma.Decimal(199), priceYearly: new Prisma.Decimal(1990), createdAt: NOW, updatedAt: NOW },
      { id: 'p2', addOnId: 'a1', currency: 'EUR', priceMonthly: new Prisma.Decimal(9), priceYearly: new Prisma.Decimal(90), createdAt: NOW, updatedAt: NOW },
    ],
    studioAddOns: [],
    ...overrides,
  };
}

function own(overrides: Partial<StudioAddOn>): StudioAddOn {
  return {
    id: 's1',
    studioId: 'st',
    addOnId: 'a1',
    status: 'TRIALING',
    billingInterval: null,
    trialStartedAt: at(-1),
    trialEndsAt: at(13),
    activatedAt: null,
    cancelledAt: null,
    currentPeriodEnd: null,
    priceSnapshot: null,
    trialReminderSentAt: null,
    renewalFailures: 0,
    nextRenewalAttemptAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe('toTenantDto', () => {
  it('shows the price in the tenant currency and offers the trial when never used', () => {
    const dto = toTenantDto(addOn(), 'TRY', NOW);
    expect(dto).toMatchObject({ state: 'AVAILABLE', purchasable: true, trialAvailable: true, price: { currency: 'TRY', priceMonthly: '199.00', priceYearly: '1990.00' } });
    expect(dto.purchaseBlockedReason).toBeNull();
  });

  it('is visible but not purchasable with a stable reason when the currency has no price', () => {
    const dto = toTenantDto(addOn(), 'USD', NOW);
    expect(dto).toMatchObject({ price: null, purchasable: false, trialAvailable: false, purchaseBlockedReason: 'NO_PRICE_IN_CURRENCY', state: 'AVAILABLE' });
  });

  it('an unpublished add-on is not purchasable', () => {
    expect(toTenantDto(addOn({ isPublished: false }), 'TRY', NOW).purchasable).toBe(false);
  });

  it('a trial shows the days left, an ended trial that the heartbeat has not swept yet reads as expired', () => {
    const trialing = toTenantDto(addOn({ studioAddOns: [own({})] }), 'TRY', NOW);
    expect(trialing).toMatchObject({ state: 'TRIALING', hasAccess: true, trialDaysLeft: 13, trialAvailable: false });
    const lapsed = toTenantDto(addOn({ studioAddOns: [own({ trialEndsAt: at(-1) })] }), 'TRY', NOW);
    expect(lapsed).toMatchObject({ state: 'EXPIRED', hasAccess: false, trialDaysLeft: null });
  });

  it('cancelled keeps access until the period end', () => {
    const cancelled = toTenantDto(addOn({ studioAddOns: [own({ status: 'CANCELLED', currentPeriodEnd: at(5), billingInterval: 'MONTH' })] }), 'TRY', NOW);
    expect(cancelled).toMatchObject({ state: 'CANCELLED', hasAccess: true, billingInterval: 'MONTH' });
    const over = toTenantDto(addOn({ studioAddOns: [own({ status: 'CANCELLED', currentPeriodEnd: at(-1) })] }), 'TRY', NOW);
    expect(over).toMatchObject({ state: 'EXPIRED', hasAccess: false });
  });

  it('active with a past period end is flagged as payment overdue but keeps access', () => {
    const dto = toTenantDto(addOn({ studioAddOns: [own({ status: 'ACTIVE', currentPeriodEnd: at(-1), billingInterval: 'YEAR', activatedAt: at(-30) })] }), 'TRY', NOW);
    expect(dto).toMatchObject({ state: 'ACTIVE', hasAccess: true, paymentOverdue: true, billingInterval: 'YEAR' });
  });

  it('a failed direct purchase placeholder reads as available with the trial still open', () => {
    const dto = toTenantDto(addOn({ studioAddOns: [own({ status: 'EXPIRED', trialStartedAt: null, trialEndsAt: null })] }), 'TRY', NOW);
    expect(dto).toMatchObject({ state: 'AVAILABLE', trialAvailable: true });
  });
});
