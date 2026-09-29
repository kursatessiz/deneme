import { Prisma } from '@platform/database';
import { StudioReferralsService } from './studio-referrals.service';
import type { PrismaService } from '../prisma/prisma.service';

/** G5c-1b: the AMOUNT reward per billing currency (platform_referral_reward_amounts) and its currency selection. */
function setup(settings: { kind: string; months: number | null } | null, amounts: { currency: string; amount: string }[]) {
  const store = { amounts: amounts.map((a) => ({ currency: a.currency, amount: new Prisma.Decimal(a.amount) })) };
  const audit = jest.fn().mockResolvedValue({});
  const ledger = jest.fn().mockResolvedValue({});
  const tx = {
    platformBillingSettings: { upsert: jest.fn().mockResolvedValue({}) },
    platformReferralRewardAmount: {
      deleteMany: jest.fn(async () => {
        store.amounts = [];
        return { count: 0 };
      }),
      createMany: jest.fn(async ({ data }: { data: { currency: string; amount: Prisma.Decimal }[] }) => {
        store.amounts = data;
        return { count: data.length };
      }),
    },
    auditLog: { create: audit },
    studioReferral: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    platformCreditLedger: { create: ledger },
  };
  const prisma = {
    platformBillingSettings: {
      findUnique: jest.fn().mockResolvedValue(settings ? { id: 'platform', referralRewardKind: settings.kind, referralRewardMonths: settings.months } : null),
    },
    platformReferralRewardAmount: { findMany: jest.fn(async () => [...store.amounts].sort((a, b) => a.currency.localeCompare(b.currency))) },
    studioReferral: { findUnique: jest.fn(), updateMany: jest.fn() },
    studio: { findUnique: jest.fn() },
    membership: { findMany: jest.fn().mockResolvedValue([]) },
    inviteToken: { findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn((fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  return { service: new StudioReferralsService(prisma as unknown as PrismaService), prisma, tx, audit, ledger };
}

describe('StudioReferralsService reward setting (G5c-1b)', () => {
  it('defaults to one free month when nothing is stored', async () => {
    const { service } = setup(null, []);
    expect(await service.rewardSetting()).toEqual({ kind: 'FREE_MONTHS', months: 1 });
  });

  it('reads the per-currency amounts and ignores a currency no longer offered', async () => {
    const { service } = setup({ kind: 'AMOUNT', months: null }, [
      { currency: 'TRY', amount: '250' },
      { currency: 'GBP', amount: '8' },
      { currency: 'CHF', amount: '9' },
    ]);
    expect(await service.rewardSetting()).toEqual({
      kind: 'AMOUNT',
      amounts: [
        { currency: 'GBP', amount: '8.00' },
        { currency: 'TRY', amount: '250.00' },
      ],
    });
  });

  it('saves the full set of amounts and audit logs the previous and new setting', async () => {
    const { service, tx, audit } = setup({ kind: 'FREE_MONTHS', months: 1 }, []);
    const reward = { kind: 'AMOUNT' as const, amounts: [{ currency: 'EUR' as const, amount: '10.00' }] };
    await service.updateSettings('admin', { referralReward: reward });
    expect(tx.platformReferralRewardAmount.deleteMany).toHaveBeenCalled();
    const written = tx.platformReferralRewardAmount.createMany.mock.calls[0][0].data;
    expect(written.map((r) => ({ currency: r.currency, amount: r.amount.toFixed(2) }))).toEqual([{ currency: 'EUR', amount: '10.00' }]);
    expect(tx.platformBillingSettings.upsert.mock.calls[0][0].update).toMatchObject({ referralRewardKind: 'AMOUNT', updatedByUserId: 'admin' });
    expect(audit.mock.calls[0][0].data).toMatchObject({
      action: 'billing.settings_update',
      userId: 'admin',
      metadata: { previous: { kind: 'FREE_MONTHS', months: 1 }, referralReward: reward },
    });
  });

  it('switching to free months removes the amounts', async () => {
    const { service, tx } = setup({ kind: 'AMOUNT', months: null }, [{ currency: 'TRY', amount: '250' }]);
    await service.updateSettings('admin', { referralReward: { kind: 'FREE_MONTHS', months: 2 } });
    expect(tx.platformReferralRewardAmount.deleteMany).toHaveBeenCalled();
    expect(tx.platformReferralRewardAmount.createMany).not.toHaveBeenCalled();
  });
});

describe('StudioReferralsService reward currency selection (G5c-1b)', () => {
  const referral = { id: 'ref-1', referrerStudioId: 'referrer', referredStudioId: 'referred', status: 'SIGNED_UP' };

  function rewardFor(countryCode: string, billingCurrency: string | null, amounts: { currency: string; amount: string }[]) {
    const ctx = setup({ kind: 'AMOUNT', months: null }, amounts);
    ctx.prisma.studioReferral.findUnique.mockResolvedValue(referral);
    ctx.prisma.studio.findUnique.mockResolvedValue({ isActive: true, countryCode, billingCurrency });
    // Different owners on both sides: not a self-referral.
    ctx.prisma.membership.findMany.mockImplementation(async ({ where }: { where: { studioId: string } }) => [
      { user: { phone: `+90532000${where.studioId === 'referrer' ? '0001' : '0002'}`, email: null } },
    ]);
    return ctx;
  }

  it('credits the amount in the referrer billing currency', async () => {
    const { service, ledger } = rewardFor('GB', null, [
      { currency: 'TRY', amount: '250' },
      { currency: 'GBP', amount: '8' },
    ]);
    await service.onReferredStudioActivated('referred');
    expect(ledger.mock.calls[0][0].data).toMatchObject({ studioId: 'referrer', currency: 'GBP', months: null, idempotencyKey: 'referral-reward:referred' });
    expect(String(ledger.mock.calls[0][0].data.amount)).toBe('8.00');
  });

  it('uses the super-admin override over the country', async () => {
    const { service, ledger } = rewardFor('GB', 'TRY', [
      { currency: 'TRY', amount: '250' },
      { currency: 'GBP', amount: '8' },
    ]);
    await service.onReferredStudioActivated('referred');
    expect(ledger.mock.calls[0][0].data).toMatchObject({ currency: 'TRY' });
    expect(String(ledger.mock.calls[0][0].data.amount)).toBe('250.00');
  });

  it('falls back to one free month when the referrer currency has no amount (never converts)', async () => {
    const { service, ledger } = rewardFor('US', null, [{ currency: 'TRY', amount: '250' }]);
    await service.onReferredStudioActivated('referred');
    expect(ledger.mock.calls[0][0].data).toMatchObject({ amount: null, currency: null, months: 1 });
  });
});
