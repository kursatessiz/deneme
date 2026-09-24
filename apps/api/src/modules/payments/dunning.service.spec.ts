import { DunningService, DUNNING_RETRY_OFFSETS_DAYS } from './dunning.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PaymentProviderRegistry } from './providers/payment-provider.registry';
import { MemberSubscriptionStatus, PaymentAttemptStatus, PaymentProvider } from '@platform/database';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('DunningService', () => {
  let service: DunningService;
  let prisma: any;
  let notifications: any;
  let providers: any;
  let chargeStoredCard: jest.Mock;

  const NOW = new Date('2026-06-15T00:00:00.000Z');

  const baseSub = {
    id: 'sub-1',
    studioId: 'studio-1',
    memberId: 'member-1',
    packageDefinitionId: 'pkg-1',
    storedCardId: 'card-1',
    status: MemberSubscriptionStatus.ACTIVE,
    currentPeriodStart: new Date(NOW.getTime() - 30 * DAY_MS),
    currentPeriodEnd: NOW,
    nextChargeAt: NOW,
    cancelAtPeriodEnd: false,
    installmentCount: 1,
    packageDefinition: { id: 'pkg-1', name: 'Aylik Uyelik', price: '500.00', validityDays: 30, entitlementKind: 'TIME_UNLIMITED', totalUnits: null },
    storedCard: { id: 'card-1', provider: PaymentProvider.MOCK, providerCardToken: 'card_tok_good' },
  };

  beforeEach(() => {
    chargeStoredCard = jest.fn();
    prisma = {
      memberSubscription: { findMany: jest.fn(), updateMany: jest.fn() },
      paymentAttempt: { findMany: jest.fn(), create: jest.fn() },
      memberPackage: { create: jest.fn() },
      payment: { create: jest.fn() },
      memberProfile: { findFirst: jest.fn().mockResolvedValue({ membership: { userId: 'user-1' } }) },
      $transaction: jest.fn(async (cb) => cb(prisma)),
    };
    notifications = { notifyUser: jest.fn().mockResolvedValue({ push: 1, sms: false }) };
    providers = { get: jest.fn().mockReturnValue({ chargeStoredCard }) };

    service = new DunningService(prisma as unknown as PrismaService, notifications as unknown as NotificationsService, providers as unknown as PaymentProviderRegistry);
  });

  it('does nothing when no subscription is due', async () => {
    prisma.memberSubscription.findMany.mockResolvedValue([]);
    const result = await service.runDueRenewals(NOW);
    expect(result).toEqual([]);
  });

  it('renews a subscription on a successful charge, advancing the period and creating a package', async () => {
    prisma.memberSubscription.findMany.mockResolvedValue([baseSub]);
    prisma.paymentAttempt.findMany.mockResolvedValue([]);
    prisma.memberSubscription.updateMany.mockResolvedValue({ count: 1 });
    prisma.memberPackage.create.mockResolvedValue({ id: 'pkg-instance-1' });
    prisma.payment.create.mockResolvedValue({ id: 'payment-1' });
    chargeStoredCard.mockResolvedValue({ success: true, providerReference: 'mock_chg_1' });

    const [outcome] = await service.runDueRenewals(NOW);

    expect(outcome.outcome).toBe('renewed');
    expect(chargeStoredCard).toHaveBeenCalledWith(expect.objectContaining({ cardToken: 'card_tok_good', amount: 500 }));
    expect(prisma.memberSubscription.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'sub-1', nextChargeAt: NOW } }),
    );
    const updateCall = prisma.memberSubscription.updateMany.mock.calls[0][0];
    expect(updateCall.data.status).toBe(MemberSubscriptionStatus.ACTIVE);
    expect(updateCall.data.currentPeriodStart).toEqual(NOW);
    expect(prisma.paymentAttempt.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: PaymentAttemptStatus.SUCCEEDED, attemptNumber: 1 }) }),
    );
  });

  it('schedules the first retry one day after a failed charge and marks the subscription PAST_DUE', async () => {
    prisma.memberSubscription.findMany.mockResolvedValue([baseSub]);
    prisma.paymentAttempt.findMany.mockResolvedValue([]);
    prisma.memberSubscription.updateMany.mockResolvedValue({ count: 1 });
    chargeStoredCard.mockResolvedValue({ success: false, providerReference: 'mock_chg_2', failureCode: 'card_declined' });

    const [outcome] = await service.runDueRenewals(NOW);

    expect(outcome.outcome).toBe('retry_scheduled');
    expect(outcome.nextChargeAt).toEqual(new Date(NOW.getTime() + DUNNING_RETRY_OFFSETS_DAYS[0] * DAY_MS));
    const updateCall = prisma.memberSubscription.updateMany.mock.calls[0][0];
    expect(updateCall.data.status).toBe(MemberSubscriptionStatus.PAST_DUE);
    const attemptCall = prisma.paymentAttempt.create.mock.calls[0][0];
    expect(attemptCall.data.attemptNumber).toBe(1);
    expect(attemptCall.data.status).toBe(PaymentAttemptStatus.FAILED);
  });

  it('retries on day 3 after the day-1 retry also fails, anchored to the first failure', async () => {
    const firstFailureAt = new Date('2026-06-01T00:00:00.000Z');
    // One prior failed attempt this cycle: the original charge at day 0. This
    // call is the day-1 retry, which is about to fail too (attempt 2).
    prisma.memberSubscription.findMany.mockResolvedValue([baseSub]);
    prisma.paymentAttempt.findMany.mockResolvedValue([{ createdAt: firstFailureAt, status: PaymentAttemptStatus.FAILED }]);
    prisma.memberSubscription.updateMany.mockResolvedValue({ count: 1 });
    chargeStoredCard.mockResolvedValue({ success: false, providerReference: 'x', failureCode: 'card_declined' });

    const [outcome] = await service.runDueRenewals(NOW);

    expect(outcome.outcome).toBe('retry_scheduled');
    expect(outcome.nextChargeAt).toEqual(new Date(firstFailureAt.getTime() + DUNNING_RETRY_OFFSETS_DAYS[1] * DAY_MS));
    const attemptCall = prisma.paymentAttempt.create.mock.calls[0][0];
    expect(attemptCall.data.attemptNumber).toBe(2);
  });

  it('cancels the subscription and notifies the member after the day-7 retry also fails', async () => {
    const firstFailureAt = new Date('2026-06-01T00:00:00.000Z');
    prisma.memberSubscription.findMany.mockResolvedValue([baseSub]);
    // Three prior failures this cycle (day 0, day 1, day 3 retries) -> this call is the 4th, the day-7 retry.
    prisma.paymentAttempt.findMany.mockResolvedValue([
      { createdAt: new Date(firstFailureAt.getTime() + 3 * DAY_MS), status: PaymentAttemptStatus.FAILED },
      { createdAt: new Date(firstFailureAt.getTime() + 1 * DAY_MS), status: PaymentAttemptStatus.FAILED },
      { createdAt: firstFailureAt, status: PaymentAttemptStatus.FAILED },
    ]);
    prisma.memberSubscription.updateMany.mockResolvedValue({ count: 1 });
    chargeStoredCard.mockResolvedValue({ success: false, providerReference: 'x', failureCode: 'card_declined' });

    const [outcome] = await service.runDueRenewals(NOW);

    expect(outcome.outcome).toBe('cancelled');
    const updateCall = prisma.memberSubscription.updateMany.mock.calls[0][0];
    expect(updateCall.data.status).toBe(MemberSubscriptionStatus.CANCELLED);
    const attemptCall = prisma.paymentAttempt.create.mock.calls[0][0];
    expect(attemptCall.data.attemptNumber).toBe(4);
    expect(attemptCall.data.nextRetryAt).toBeNull();
    expect(notifications.notifyUser).toHaveBeenCalledWith(expect.objectContaining({ category: 'PACKAGE', userId: 'user-1' }));
  });

  it('ignores prior attempts from before the last success when computing the attempt number', async () => {
    prisma.memberSubscription.findMany.mockResolvedValue([baseSub]);
    prisma.paymentAttempt.findMany.mockResolvedValue([
      { createdAt: NOW, status: PaymentAttemptStatus.SUCCEEDED },
      { createdAt: new Date(NOW.getTime() - DAY_MS), status: PaymentAttemptStatus.FAILED },
    ]);
    prisma.memberSubscription.updateMany.mockResolvedValue({ count: 1 });
    prisma.memberPackage.create.mockResolvedValue({ id: 'pkg-instance-1' });
    prisma.payment.create.mockResolvedValue({ id: 'payment-1' });
    chargeStoredCard.mockResolvedValue({ success: true, providerReference: 'mock_chg_3' });

    await service.runDueRenewals(NOW);

    const attemptCall = prisma.paymentAttempt.create.mock.calls[0][0];
    expect(attemptCall.data.attemptNumber).toBe(1);
  });

  it('marks a subscription with no stored card as PAST_DUE without charging', async () => {
    const sub = { ...baseSub, storedCard: null };
    prisma.memberSubscription.findMany.mockResolvedValue([sub]);
    prisma.memberSubscription.updateMany.mockResolvedValue({ count: 1 });

    const [outcome] = await service.runDueRenewals(NOW);

    expect(outcome.outcome).toBe('no_card');
    expect(chargeStoredCard).not.toHaveBeenCalled();
    expect(prisma.memberSubscription.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: MemberSubscriptionStatus.PAST_DUE } }),
    );
  });

  it('cancels at period end without charging when cancelAtPeriodEnd is set and the period has ended', async () => {
    const sub = { ...baseSub, cancelAtPeriodEnd: true };
    prisma.memberSubscription.findMany.mockResolvedValue([sub]);
    prisma.memberSubscription.updateMany.mockResolvedValue({ count: 1 });

    const [outcome] = await service.runDueRenewals(NOW);

    expect(outcome.outcome).toBe('cancelled_at_period_end');
    expect(chargeStoredCard).not.toHaveBeenCalled();
  });
});
