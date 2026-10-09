import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@platform/database';
import { PlatformBillingService } from './platform-billing.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { PaymentProviderRegistry } from '../payments/providers/payment-provider.registry';
import type { PaymentWebhookRouter } from '../payments/payment-webhook-router';
import type { ConversionService } from '../crm/conversions/conversion.service';
import type { StudioReferralsService } from './studio-referrals.service';
import type { TenantContext } from '../auth/tenant-context';

const STUDIO = '00000000-0000-4000-8000-0000000000a1';
const NOW = new Date('2026-10-16T10:00:00Z');

type PriceRow = { currency: string; priceMonthly: Prisma.Decimal };

function setup(opts: { billingStatus?: string; countryCode?: string; billingCurrency?: string | null; prices?: PriceRow[] } = {}) {
  const plan = {
    id: 'plan-1',
    key: 'pro',
    name: 'Pro',
    trialDays: 14,
    isActive: true,
    prices: opts.prices ?? [
      { currency: 'TRY', priceMonthly: new Prisma.Decimal('3490') },
      { currency: 'EUR', priceMonthly: new Prisma.Decimal('109') },
    ],
  };
  const audit = jest.fn().mockResolvedValue({});
  const tx = {
    studio: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    plan: { findUnique: jest.fn().mockResolvedValue(plan) },
    subscription: { updateMany: jest.fn().mockResolvedValue({ count: 1 }), create: jest.fn().mockResolvedValue({}), findFirst: jest.fn() },
    auditLog: { create: audit },
  };
  const prisma = {
    studio: {
      findUnique: jest.fn().mockResolvedValue({
        id: STUDIO,
        billingStatus: opts.billingStatus ?? 'RESTRICTED',
        isPlatform: false,
        countryCode: opts.countryCode ?? 'DE',
        billingCurrency: opts.billingCurrency ?? null,
      }),
    },
    plan: { findFirst: jest.fn().mockResolvedValue(plan) },
    platformBillingPayment: { findFirst: jest.fn().mockResolvedValue(null) },
    $transaction: jest.fn((fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  const conversions = { recordStudioPaid: jest.fn().mockResolvedValue(null) };
  const referrals = { onReferredStudioActivated: jest.fn().mockResolvedValue(undefined) };
  const service = new PlatformBillingService(
    prisma as unknown as PrismaService,
    {} as PaymentProviderRegistry,
    {} as PaymentWebhookRouter,
    conversions as unknown as ConversionService,
    referrals as unknown as StudioReferralsService,
  );
  return { service, prisma, tx, audit, conversions, referrals };
}

describe('PlatformBillingService.forceStatus (G5c-1b recordAsPaid)', () => {
  it('without recordAsPaid activates but records no payment, conversion or reward', async () => {
    const { service, audit, conversions, referrals } = setup();
    const res = await service.forceStatus('admin', STUDIO, { status: 'ACTIVE', planKey: 'pro', recordAsPaid: false }, NOW);
    expect(res).toEqual({ status: 'ACTIVE', recordAsPaid: false });
    expect(conversions.recordStudioPaid).not.toHaveBeenCalled();
    expect(referrals.onReferredStudioActivated).not.toHaveBeenCalled();
    expect(audit.mock.calls[0][0].data).toMatchObject({ action: 'billing.force_activate', metadata: { recordAsPaid: false, paidValue: null } });
  });

  it('with recordAsPaid records studio_paid at the plan price in the billing currency and rewards once, like a paid activation', async () => {
    const { service, audit, conversions, referrals } = setup({ countryCode: 'DE' });
    const res = await service.forceStatus('admin', STUDIO, { status: 'ACTIVE', planKey: 'pro', recordAsPaid: true, reason: 'offline' }, NOW);
    expect(res).toEqual({ status: 'ACTIVE', recordAsPaid: true });
    expect(conversions.recordStudioPaid).toHaveBeenCalledTimes(1);
    expect(conversions.recordStudioPaid).toHaveBeenCalledWith(STUDIO, { kind: 'studio_activation', id: STUDIO }, { amount: '109.00', currency: 'EUR' }, NOW);
    expect(referrals.onReferredStudioActivated).toHaveBeenCalledTimes(1);
    expect(referrals.onReferredStudioActivated).toHaveBeenCalledWith(STUDIO);
    expect(audit.mock.calls[0][0].data.metadata).toMatchObject({ recordAsPaid: true, paidValue: { amount: '109.00', currency: 'EUR' }, reason: 'offline' });
  });

  it('uses the super-admin currency override over the country', async () => {
    const { service, conversions } = setup({ countryCode: 'DE', billingCurrency: 'TRY' });
    await service.forceStatus('admin', STUDIO, { status: 'ACTIVE', planKey: 'pro', recordAsPaid: true }, NOW);
    expect(conversions.recordStudioPaid).toHaveBeenCalledWith(STUDIO, expect.anything(), { amount: '3490.00', currency: 'TRY' }, NOW);
  });

  it('refuses recordAsPaid when the plan has no price in the billing currency (nothing changes)', async () => {
    const { service, audit, conversions, referrals } = setup({ countryCode: 'US' });
    await expect(service.forceStatus('admin', STUDIO, { status: 'ACTIVE', planKey: 'pro', recordAsPaid: true }, NOW)).rejects.toMatchObject({
      response: { code: 'PLAN_PRICE_UNAVAILABLE' },
    });
    expect(audit).not.toHaveBeenCalled();
    expect(conversions.recordStudioPaid).not.toHaveBeenCalled();
    expect(referrals.onReferredStudioActivated).not.toHaveBeenCalled();
  });

  it('a repeated call on an ACTIVE studio is a no-op: no second conversion or reward', async () => {
    const { service, prisma, conversions, referrals } = setup({ billingStatus: 'ACTIVE' });
    const res = await service.forceStatus('admin', STUDIO, { status: 'ACTIVE', planKey: 'pro', recordAsPaid: true }, NOW);
    expect(res).toEqual({ status: 'ACTIVE', recordAsPaid: false });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(conversions.recordStudioPaid).not.toHaveBeenCalled();
    expect(referrals.onReferredStudioActivated).not.toHaveBeenCalled();
  });

  it('recordAsPaid only makes sense for an activation', async () => {
    const { service } = setup({ billingStatus: 'TRIALING' });
    await expect(service.forceStatus('admin', STUDIO, { status: 'RESTRICTED', recordAsPaid: true }, NOW)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('PlatformBillingService.activate (G5c-1b billing currency)', () => {
  it('rejects a plan with no price in the studio billing currency', async () => {
    const { service } = setup({ billingStatus: 'TRIALING', countryCode: 'US' });
    const tenant = { studioId: STUDIO } as TenantContext;
    await expect(service.activate(tenant, 'owner', { planKey: 'pro', installmentCount: 1 })).rejects.toMatchObject({
      response: { code: 'PLAN_PRICE_UNAVAILABLE' },
    });
  });
});

describe('PlatformBillingService.activate (parallel clicks)', () => {
  /**
   * A small in-memory database: the credit ledger and billing payments are
   * arrays, every call yields to the event loop so unserialised work would
   * interleave, and pg_advisory_xact_lock is a real per-key mutex held until
   * the transaction callback settles.
   */
  function parallelSetup() {
    const ledger: { amount: Prisma.Decimal | null; currency: string | null; months: number | null; kind: string }[] = [
      { kind: 'GRANT', amount: new Prisma.Decimal('1000.00'), currency: 'TRY', months: null },
    ];
    const payments: { id: string; studioId: string; status: string; createdAt: Date; creditAmount: string }[] = [];
    const locks = new Map<string, Promise<void>>();
    const tick = () => new Promise<void>((r) => setImmediate(r));
    let seq = 0;

    const makeTx = (held: { release?: () => void }) => ({
      $executeRaw: async (query: { values: unknown[] }) => {
        const key = String(query.values[0]);
        while (locks.has(key)) await locks.get(key);
        let release!: () => void;
        locks.set(key, new Promise<void>((r) => (release = r)));
        held.release = () => {
          locks.delete(key);
          release();
        };
      },
      platformBillingPayment: {
        findFirst: async () => {
          await tick();
          return payments.find((p) => p.status === 'PENDING') ? { id: 'pending' } : null;
        },
        create: async ({ data }: { data: { studioId: string; status: string; creditAmount: string } }) => {
          await tick();
          const row = { id: `pay-${++seq}`, studioId: data.studioId, status: data.status, createdAt: new Date(), creditAmount: data.creditAmount };
          payments.push(row);
          return row;
        },
      },
      platformCreditLedger: {
        findMany: async () => {
          await tick();
          return ledger.map((r) => ({ amount: r.amount, currency: r.currency, months: r.months }));
        },
        create: async ({ data }: { data: { kind: string; amount?: Prisma.Decimal; currency?: string; months?: number } }) => {
          await tick();
          ledger.push({ kind: data.kind, amount: data.amount ?? null, currency: data.currency ?? null, months: data.months ?? null });
          return {};
        },
      },
    });

    const plan = { id: 'plan-1', key: 'pro', isActive: true, prices: [{ currency: 'TRY', priceMonthly: new Prisma.Decimal('3490') }] };
    const checkout = jest.fn().mockResolvedValue({ providerReference: 'chk-1', status: 'PENDING', checkoutUrl: 'https://pay.example' });
    const prisma = {
      studio: { findUnique: jest.fn().mockResolvedValue({ id: STUDIO, billingStatus: 'RESTRICTED', isPlatform: false, countryCode: 'TR', billingCurrency: null }) },
      plan: { findFirst: jest.fn().mockResolvedValue(plan) },
      platformBillingPayment: { update: jest.fn().mockResolvedValue({}) },
      platformCreditLedger: { findMany: jest.fn() },
      $transaction: async (fn: (t: ReturnType<typeof makeTx>) => Promise<unknown>) => {
        const held: { release?: () => void } = {};
        try {
          return await fn(makeTx(held));
        } finally {
          held.release?.();
        }
      },
    };
    const service = new PlatformBillingService(
      prisma as unknown as PrismaService,
      { default: { name: 'MOCK', createCheckout: checkout } } as unknown as PaymentProviderRegistry,
      {} as PaymentWebhookRouter,
      { recordStudioPaid: jest.fn() } as unknown as ConversionService,
      { onReferredStudioActivated: jest.fn() } as unknown as StudioReferralsService,
    );
    jest.spyOn(service as unknown as { activationResult: () => Promise<unknown> }, 'activationResult').mockResolvedValue({ pending: true });
    return { service, ledger, payments, prisma };
  }

  it('lets one of two parallel activations through and spends the credit once', async () => {
    const { service, ledger, payments } = parallelSetup();
    const tenant = { studioId: STUDIO } as TenantContext;
    const dto = { planKey: 'pro', installmentCount: 1 };

    const settled = await Promise.allSettled([service.activate(tenant, 'owner', dto), service.activate(tenant, 'owner', dto)]);

    expect(settled.filter((s) => s.status === 'fulfilled')).toHaveLength(1);
    const rejected = settled.find((s) => s.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason.response.code).toBe('apiErrors.billing.pendingPaymentWaitComplete');
    expect(payments).toHaveLength(1);
    const applied = ledger.filter((r) => r.kind === 'APPLIED');
    expect(applied).toHaveLength(1);
    expect(applied[0].amount?.toFixed(2)).toBe('-1000.00');
    // The remaining balance never goes negative.
    const balance = ledger.reduce((sum, r) => sum.plus(r.amount ?? 0), new Prisma.Decimal(0));
    expect(balance.toFixed(2)).toBe('0.00');
  });
});
