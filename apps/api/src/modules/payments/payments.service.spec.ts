import { BadRequestException, ConflictException } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PaymentProviderRegistry } from './providers/payment-provider.registry';
import { InvoicingService } from '../invoicing/invoicing.service';
import { PromotionsService } from '../promotions/promotions.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { PaymentMethod, PaymentProvider, PaymentStatus } from '@platform/database';
import type { SellPackageInput } from '@platform/shared';
import type { TenantContext } from '../auth/tenant-context';

describe('PaymentsService - refunds', () => {
  let service: PaymentsService;
  let prisma: any;
  let providers: any;
  let refund: jest.Mock;

  const tenant: TenantContext = {
    studioId: 'studio-1',
    membershipId: 'membership-1',
    isOwner: true,
    isSuperAdmin: false,
    permissions: new Set(['finance.manage']),
    memberProfileId: null,
    trainerProfileId: null,
    branchIds: null,
  };

  const basePayment = {
    id: 'payment-1',
    studioId: 'studio-1',
    branchId: null,
    amount: '1000.00',
    refundedAmount: '0.00',
    giftCardAmount: '0.00',
    giftCardRefunded: '0.00',
    giftCardId: null,
    currency: 'TRY',
    paymentStatus: PaymentStatus.COMPLETED,
    provider: PaymentProvider.MOCK,
    providerReference: 'mock_chg_1',
  };

  beforeEach(() => {
    refund = jest.fn().mockResolvedValue({ success: true, providerReference: 'mock_rfnd_1' });
    prisma = {
      payment: {
        findFirst: jest.fn(),
        updateMany: jest.fn(),
        findUniqueOrThrow: jest.fn(),
      },
      auditLog: { create: jest.fn() },
      studio: { findUnique: jest.fn().mockResolvedValue({ defaultLocale: 'tr' }) },
      sale: { count: jest.fn().mockResolvedValue(0) },
      eventRegistration: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    };
    providers = { get: jest.fn().mockReturnValue({ refund }) };
    service = new PaymentsService(
      prisma as unknown as PrismaService,
      { notifyUser: jest.fn() } as unknown as NotificationsService,
      providers as unknown as PaymentProviderRegistry,
      { cancelForRefund: jest.fn(), getSettings: jest.fn(), issueForPayment: jest.fn() } as unknown as InvoicingService,
      {} as unknown as PromotionsService,
      { emit: jest.fn() } as unknown as WebhooksService,
    );
  });

  it('refunds the full remaining amount when no amount is given', async () => {
    prisma.payment.findFirst.mockResolvedValue({ ...basePayment });
    prisma.payment.updateMany.mockResolvedValue({ count: 1 });
    prisma.payment.findUniqueOrThrow.mockResolvedValue({ ...basePayment, refundedAmount: '1000.00', paymentStatus: PaymentStatus.REFUNDED });

    await service.refundPayment(tenant, 'user-1', 'payment-1', { reason: 'musteri talebi' });

    expect(refund).toHaveBeenCalledWith(expect.objectContaining({ amount: 1000 }));
    const updateCall = prisma.payment.updateMany.mock.calls[0][0];
    expect(updateCall.data.refundedAmount.toFixed(2)).toBe('1000.00');
    expect(updateCall.data.paymentStatus).toBe(PaymentStatus.REFUNDED);
  });

  it('refunds a guest payment (no member), mirrors it on the event registration and names the contact in the webhook', async () => {
    const webhooks = { emit: jest.fn() };
    service = new PaymentsService(
      prisma as unknown as PrismaService,
      { notifyUser: jest.fn() } as unknown as NotificationsService,
      providers as unknown as PaymentProviderRegistry,
      { cancelForRefund: jest.fn(), getSettings: jest.fn(), issueForPayment: jest.fn() } as unknown as InvoicingService,
      {} as unknown as PromotionsService,
      webhooks as unknown as WebhooksService,
    );
    const guest = { ...basePayment, memberId: null, contactId: 'contact-1', providerReference: null, provider: null };
    prisma.payment.findFirst.mockResolvedValue(guest);
    prisma.payment.updateMany.mockResolvedValue({ count: 1 });
    prisma.payment.findUniqueOrThrow.mockResolvedValue({ ...guest, refundedAmount: '1000.00', paymentStatus: PaymentStatus.REFUNDED });

    await service.refundPayment(tenant, 'user-1', 'payment-1', { reason: 'misafir iptal' });

    expect(refund).not.toHaveBeenCalled();
    const sync = prisma.eventRegistration.updateMany.mock.calls[0][0];
    expect(sync.where).toEqual({ studioId: 'studio-1', paymentId: 'payment-1' });
    expect(sync.data.refundedAmount.toFixed(2)).toBe('1000.00');
    expect(webhooks.emit).toHaveBeenCalledWith(
      'studio-1',
      'payment.refunded',
      expect.objectContaining({ paymentId: 'payment-1', memberId: null, contactId: 'contact-1', amount: '1000.00', currency: basePayment.currency, fullyRefunded: true }),
    );
  });

  it('rejects a refund larger than the paid amount', async () => {
    prisma.payment.findFirst.mockResolvedValue({ ...basePayment });

    await expect(service.refundPayment(tenant, 'user-1', 'payment-1', { amount: 1500, reason: 'x' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(refund).not.toHaveBeenCalled();
  });

  it('rejects a second refund that would push the total past the paid amount (double refund)', async () => {
    // First refund already took 700 of 1000.
    prisma.payment.findFirst.mockResolvedValue({ ...basePayment, refundedAmount: '700.00' });

    await expect(service.refundPayment(tenant, 'user-1', 'payment-1', { amount: 500, reason: 'x' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(refund).not.toHaveBeenCalled();
  });

  it('allows a partial refund that stays within the remaining amount and keeps the payment COMPLETED', async () => {
    prisma.payment.findFirst.mockResolvedValue({ ...basePayment, refundedAmount: '200.00' });
    prisma.payment.updateMany.mockResolvedValue({ count: 1 });
    prisma.payment.findUniqueOrThrow.mockResolvedValue({ ...basePayment, refundedAmount: '500.00' });

    await service.refundPayment(tenant, 'user-1', 'payment-1', { amount: 300, reason: 'kismi iade' });

    const updateCall = prisma.payment.updateMany.mock.calls[0][0];
    expect(updateCall.data.refundedAmount.toFixed(2)).toBe('500.00');
    expect(updateCall.data.paymentStatus).toBe(PaymentStatus.COMPLETED);
  });

  it('raises a conflict when the conditional update loses a race to a concurrent refund', async () => {
    prisma.payment.findFirst.mockResolvedValue({ ...basePayment });
    prisma.payment.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.refundPayment(tenant, 'user-1', 'payment-1', { reason: 'x' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects a refund of a payment that is not COMPLETED', async () => {
    prisma.payment.findFirst.mockResolvedValue({ ...basePayment, paymentStatus: PaymentStatus.PENDING });

    await expect(service.refundPayment(tenant, 'user-1', 'payment-1', { reason: 'x' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('releases the reservation when the provider declines the refund', async () => {
    prisma.payment.findFirst.mockResolvedValue({ ...basePayment });
    prisma.payment.updateMany.mockResolvedValue({ count: 1 });
    refund.mockResolvedValue({ success: false, providerReference: 'mock_rfnd_2', failureMessage: 'sağlayıcı reddetti' });

    await expect(service.refundPayment(tenant, 'user-1', 'payment-1', { reason: 'x' })).rejects.toBeInstanceOf(BadRequestException);
    // Reserve, then release back to the amount refunded before this call.
    expect(prisma.payment.updateMany).toHaveBeenCalledTimes(2);
    const release = prisma.payment.updateMany.mock.calls[1][0];
    expect(release.data.refundedAmount.toFixed(2)).toBe('0.00');
    expect(release.data.paymentStatus).toBe(PaymentStatus.COMPLETED);
  });

  it('does not call the provider when the reservation loses a race', async () => {
    prisma.payment.findFirst.mockResolvedValue({ ...basePayment });
    prisma.payment.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.refundPayment(tenant, 'user-1', 'payment-1', { reason: 'x' })).rejects.toBeInstanceOf(ConflictException);
    expect(refund).not.toHaveBeenCalled();
  });
});

describe('PaymentsService - webhook amount and currency', () => {
  let service: PaymentsService;
  let prisma: any;
  let verification: Record<string, unknown>;

  beforeEach(() => {
    prisma = {
      payment: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'payment-1',
          studioId: 'studio-1',
          provider: PaymentProvider.STRIPE,
          providerReference: 'pi_1',
          paymentStatus: PaymentStatus.PENDING,
          amount: '1500.00',
          currency: 'JPY',
          metadata: null,
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const providers = { byName: jest.fn().mockReturnValue({ name: PaymentProvider.STRIPE, verifyWebhook: () => verification }) };
    service = new PaymentsService(
      prisma as unknown as PrismaService,
      { notifyUser: jest.fn() } as unknown as NotificationsService,
      providers as unknown as PaymentProviderRegistry,
      { getSettings: jest.fn(), issueForPayment: jest.fn() } as unknown as InvoicingService,
      {} as unknown as PromotionsService,
      { emit: jest.fn() } as unknown as WebhooksService,
    );
    jest.spyOn(service as any, 'maybeAutoIssueInvoice').mockResolvedValue(undefined);
  });

  it('completes a JPY payment when the webhook amount and currency match', async () => {
    verification = { valid: true, providerReference: 'pi_1', eventType: 'CHARGE_SUCCEEDED', amount: '1500', currency: 'JPY' };
    await expect(service.handleWebhook('STRIPE', {}, '{}')).resolves.toEqual({ handled: true });
  });

  it('rejects a webhook whose currency differs from the payment currency', async () => {
    verification = { valid: true, providerReference: 'pi_1', eventType: 'CHARGE_SUCCEEDED', amount: '1500', currency: 'EUR' };
    await expect(service.handleWebhook('STRIPE', {}, '{}')).resolves.toEqual({ handled: false, reason: 'AMOUNT_MISMATCH' });
    expect(prisma.payment.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a webhook with a different amount', async () => {
    verification = { valid: true, providerReference: 'pi_1', eventType: 'CHARGE_SUCCEEDED', amount: '15.00', currency: 'JPY' };
    await expect(service.handleWebhook('STRIPE', {}, '{}')).resolves.toEqual({ handled: false, reason: 'AMOUNT_MISMATCH' });
  });
});

describe('PaymentsService - sellPackage', () => {
  let service: PaymentsService;
  let prisma: any;
  let providerAdapter: { createCheckout: jest.Mock; chargeStoredCard: jest.Mock; refund: jest.Mock };
  let getProvider: jest.Mock;

  const tenant: TenantContext = {
    studioId: 'studio-1',
    membershipId: 'membership-1',
    isOwner: true,
    isSuperAdmin: false,
    permissions: new Set(['packages.sell']),
    memberProfileId: null,
    trainerProfileId: null,
    branchIds: null,
  };

  const pkgDef = { id: 'pkg-1', studioId: 'studio-1', name: 'Gold', isTrial: false, validityDays: 30, totalUnits: 10, entitlementKind: 'SESSION_COUNT' };
  const baseDto = {
    studioId: 'studio-1',
    memberId: 'member-1',
    packageDefinitionId: 'pkg-1',
    paymentMethod: 'CREDIT_CARD_POS',
    paidAmount: 500,
    currency: 'TRY',
    installmentCount: 1,
    card: { providerCardToken: 'tok_good', last4: '4242', brand: 'visa', expMonth: 12, expYear: 2099 },
  } as unknown as SellPackageInput;

  beforeEach(() => {
    providerAdapter = {
      createCheckout: jest.fn().mockResolvedValue({ providerReference: 'chk_1', status: 'COMPLETED' }),
      chargeStoredCard: jest.fn().mockResolvedValue({ success: true, providerReference: 'chg_1' }),
      refund: jest.fn().mockResolvedValue({ success: true, providerReference: 'rfnd_1' }),
    };
    getProvider = jest.fn().mockReturnValue(providerAdapter);
    prisma = {
      packageDefinition: { findFirst: jest.fn().mockResolvedValue(pkgDef) },
      memberProfile: {
        findFirst: jest.fn().mockResolvedValue({ id: 'member-1', homeBranchId: null }),
        findFirstOrThrow: jest.fn().mockResolvedValue({ membership: { userId: 'user-1' } }),
      },
      studio: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ currency: 'TRY' }),
        findUnique: jest.fn().mockResolvedValue({ defaultLocale: 'tr' }),
      },
      payment: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: 'payment-1' }) },
      memberPackage: { findFirst: jest.fn() },
      $transaction: jest.fn(),
    };
    service = new PaymentsService(
      prisma as unknown as PrismaService,
      { notifyUser: jest.fn() } as unknown as NotificationsService,
      { get: getProvider, default: providerAdapter } as unknown as PaymentProviderRegistry,
      { getSettings: jest.fn(), issueForPayment: jest.fn() } as unknown as InvoicingService,
      {} as unknown as PromotionsService,
      { emit: jest.fn() } as unknown as WebhooksService,
    );
    jest.spyOn(service as any, 'maybeAutoIssueInvoice').mockResolvedValue(undefined);
  });

  describe('card charge followed by a failing sale transaction', () => {
    it('refunds the charge and rethrows when the sale transaction fails', async () => {
      prisma.$transaction.mockRejectedValue(new Error('db down'));

      await expect(service.sellPackage(tenant, baseDto)).rejects.toThrow('db down');

      expect(providerAdapter.chargeStoredCard).toHaveBeenCalledTimes(1);
      expect(providerAdapter.refund).toHaveBeenCalledWith(
        expect.objectContaining({ providerReference: 'chg_1', amount: 500, currency: 'TRY', studioId: 'studio-1' }),
      );
      expect(prisma.payment.create).not.toHaveBeenCalled();
    });

    it('records a FAILED payment with the provider reference when the refund also fails', async () => {
      prisma.$transaction.mockRejectedValue(new Error('db down'));
      providerAdapter.refund.mockResolvedValue({ success: false, providerReference: 'x' });

      await expect(service.sellPackage(tenant, baseDto)).rejects.toThrow('db down');

      expect(prisma.payment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ paymentStatus: PaymentStatus.FAILED, providerReference: 'chg_1', amount: 500, currency: 'TRY' }),
        }),
      );
    });

    it('does not refund when the card was declined (nothing was captured)', async () => {
      providerAdapter.chargeStoredCard.mockResolvedValue({ success: false, providerReference: 'x', failureMessage: 'declined' });
      await expect(service.sellPackage(tenant, baseDto)).rejects.toBeInstanceOf(BadRequestException);
      expect(providerAdapter.refund).not.toHaveBeenCalled();
    });
  });

  describe('idempotency key', () => {
    it('uses a stable reference and provider idempotency key derived from the client key', async () => {
      prisma.$transaction.mockRejectedValue(new Error('stop here'));
      await expect(service.sellPackage(tenant, { ...baseDto, idempotencyKey: 'attempt-0001' })).rejects.toThrow();
      expect(providerAdapter.chargeStoredCard).toHaveBeenCalledWith(
        expect.objectContaining({ reference: 'sell_attempt-0001', idempotencyKey: 'sell_attempt-0001' }),
      );
    });

    it('returns the already completed sale for a repeated key without charging again', async () => {
      prisma.payment.findFirst.mockResolvedValue({ id: 'payment-9', paymentStatus: PaymentStatus.COMPLETED, memberPackageId: 'mp-1' });
      prisma.memberPackage.findFirst.mockResolvedValue({ id: 'mp-1' });

      const result = await service.sellPackage(tenant, { ...baseDto, idempotencyKey: 'attempt-0001' });

      expect(result).toMatchObject({ payment: { id: 'payment-9' }, memberPackage: { id: 'mp-1' }, pending: false });
      expect(providerAdapter.chargeStoredCard).not.toHaveBeenCalled();
    });

    it('stores the key on a pending bank transfer so a resubmission returns it', async () => {
      const transfer = { ...baseDto, paymentMethod: PaymentMethod.BANK_TRANSFER, bankReference: 'REF123', card: undefined, idempotencyKey: 'attempt-0002' } as unknown as SellPackageInput;
      await service.sellPackage(tenant, transfer);
      expect(prisma.payment.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ metadata: expect.objectContaining({ idempotencyKey: 'attempt-0002' }) }) }),
      );
    });

    it('generates a per-request fallback reference when the client sends no key', async () => {
      prisma.$transaction.mockRejectedValue(new Error('stop here'));
      await expect(service.sellPackage(tenant, baseDto)).rejects.toThrow();
      const call = providerAdapter.chargeStoredCard.mock.calls[0][0];
      expect(call.reference).toMatch(/^sell_member-1_pkg-1_/);
      expect(call.idempotencyKey).toBe(call.reference);
    });
  });

  describe('online method to provider mapping', () => {
    it('sends ONLINE_STRIPE through the Stripe provider as a pending checkout', async () => {
      providerAdapter.createCheckout.mockResolvedValue({ providerReference: 'cs_1', status: 'PENDING', checkoutUrl: 'https://pay.example/cs_1' });

      const result = await service.sellPackage(tenant, { ...baseDto, paymentMethod: PaymentMethod.ONLINE_STRIPE, card: undefined } as unknown as SellPackageInput);

      expect(getProvider).toHaveBeenCalledWith(PaymentProvider.STRIPE);
      expect(result).toMatchObject({ pending: true, checkoutUrl: 'https://pay.example/cs_1' });
      expect(prisma.payment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ paymentMethod: 'ONLINE_STRIPE', paymentStatus: PaymentStatus.PENDING, provider: PaymentProvider.STRIPE }),
        }),
      );
    });

    it('never records an ONLINE_STRIPE sale as a COMPLETED payment without a provider charge', async () => {
      providerAdapter.createCheckout.mockResolvedValue({ providerReference: 'cs_1', status: 'PENDING' });
      await service.sellPackage(tenant, { ...baseDto, paymentMethod: PaymentMethod.ONLINE_STRIPE, card: undefined } as unknown as SellPackageInput);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects a payment method that no branch handles', async () => {
      await expect(
        service.sellPackage(tenant, { ...baseDto, paymentMethod: 'ONLINE_UNKNOWN' } as unknown as SellPackageInput),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(providerAdapter.chargeStoredCard).not.toHaveBeenCalled();
    });
  });

  describe('member checkout labelling', () => {
    it('stores a Stripe checkout as ONLINE_STRIPE, not ONLINE_IYZICO', async () => {
      const stripeAdapter = {
        name: PaymentProvider.STRIPE,
        createCheckout: jest.fn().mockResolvedValue({ providerReference: 'cs_9', status: 'PENDING', checkoutUrl: 'https://pay.example/cs_9' }),
      };
      (service as any).providers = { get: getProvider, default: stripeAdapter };
      prisma.packageDefinition.findFirst.mockResolvedValue({ ...pkgDef, price: '500.00' });
      prisma.memberProfile.findFirstOrThrow.mockResolvedValue({ homeBranchId: null, membership: { userId: 'user-1' } });
      const memberTenant: TenantContext = { ...tenant, memberProfileId: 'member-1' };

      await service.memberCheckout(memberTenant, { studioId: 'studio-1', memberId: 'member-1', packageDefinitionId: 'pkg-1', installmentCount: 1 } as never);

      expect(prisma.payment.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ paymentMethod: PaymentMethod.ONLINE_STRIPE, provider: PaymentProvider.STRIPE }) }),
      );
    });
  });

  describe('currency', () => {
    it('rejects a currency that differs from the business currency', async () => {
      await expect(service.sellPackage(tenant, { ...baseDto, currency: 'USD' })).rejects.toBeInstanceOf(BadRequestException);
      expect(providerAdapter.chargeStoredCard).not.toHaveBeenCalled();
    });

    it('charges and records in the business currency', async () => {
      prisma.studio.findUniqueOrThrow.mockResolvedValue({ currency: 'EUR' });
      prisma.$transaction.mockRejectedValue(new Error('stop here'));
      await expect(service.sellPackage(tenant, { ...baseDto, currency: 'eur' })).rejects.toThrow();
      expect(providerAdapter.chargeStoredCard).toHaveBeenCalledWith(expect.objectContaining({ currency: 'EUR' }));
    });

    it('creates the pending bank transfer payment in the business currency and rejects a mismatch', async () => {
      const transfer = { ...baseDto, paymentMethod: PaymentMethod.BANK_TRANSFER, bankReference: 'REF123', card: undefined } as unknown as SellPackageInput;
      await expect(service.sellPackage(tenant, { ...transfer, currency: 'USD' })).rejects.toBeInstanceOf(BadRequestException);
      await service.sellPackage(tenant, transfer);
      expect(prisma.payment.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ currency: 'TRY' }) }));
    });
  });
});
