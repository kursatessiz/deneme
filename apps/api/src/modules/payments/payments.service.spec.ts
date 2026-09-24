import { BadRequestException, ConflictException } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PaymentProviderRegistry } from './providers/payment-provider.registry';
import { InvoicingService } from '../invoicing/invoicing.service';
import { PromotionsService } from '../promotions/promotions.service';
import { PaymentProvider, PaymentStatus } from '@platform/database';
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
    };
    providers = { get: jest.fn().mockReturnValue({ refund }) };
    service = new PaymentsService(
      prisma as unknown as PrismaService,
      { notifyUser: jest.fn() } as unknown as NotificationsService,
      providers as unknown as PaymentProviderRegistry,
      { cancelForRefund: jest.fn(), getSettings: jest.fn(), issueForPayment: jest.fn() } as unknown as InvoicingService,
      {} as unknown as PromotionsService,
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
