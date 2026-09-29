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
