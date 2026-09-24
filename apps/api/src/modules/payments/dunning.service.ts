import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PaymentProviderRegistry } from './providers/payment-provider.registry';
import { MemberSubscriptionStatus, PaymentAttemptStatus, PaymentMethod, PaymentProvider, PaymentStatus } from '@platform/database';
import type { MemberSubscription, PackageDefinition, PaymentAttempt, StoredCard } from '@platform/database';

/**
 * Retry offsets (in days, from the first failure of a dunning cycle) after
 * which a due subscription is retried. Once the retry at day 7 also fails,
 * the subscription is cancelled and the member is notified.
 */
export const DUNNING_RETRY_OFFSETS_DAYS = [1, 3, 7] as const;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface DunningOutcome {
  subscriptionId: string;
  outcome: 'renewed' | 'retry_scheduled' | 'cancelled' | 'cancelled_at_period_end' | 'no_card' | 'skipped';
  nextChargeAt?: Date;
}

type SubscriptionWithRelations = MemberSubscription & {
  packageDefinition: PackageDefinition;
  storedCard: StoredCard | null;
};

const CHARGE_PROVIDER_METHOD: Record<PaymentProvider, PaymentMethod> = {
  [PaymentProvider.MOCK]: PaymentMethod.CREDIT_CARD_POS,
  [PaymentProvider.IYZICO]: PaymentMethod.ONLINE_IYZICO,
  [PaymentProvider.PAYTR]: PaymentMethod.ONLINE_PAYTR,
};

@Injectable()
export class DunningService {
  private readonly logger = new Logger(DunningService.name);

  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
    private providers: PaymentProviderRegistry,
  ) {}

  /**
   * Charges every subscription due at or before `now`. Not wired to a
   * scheduler here (see HANDOVER.md W6): call it from a cron-capable process
   * or the super-admin trigger endpoint. Safe to call repeatedly; each
   * subscription is only advanced once its nextChargeAt condition matches
   * at call time (conditional updates guard concurrent runs).
   */
  async runDueRenewals(now: Date): Promise<DunningOutcome[]> {
    const due = await this.prisma.memberSubscription.findMany({
      where: { status: { in: [MemberSubscriptionStatus.ACTIVE, MemberSubscriptionStatus.PAST_DUE] }, nextChargeAt: { lte: now } },
      include: { packageDefinition: true, storedCard: true },
    });

    const results: DunningOutcome[] = [];
    for (const sub of due) {
      try {
        results.push(await this.processDueSubscription(sub, now));
      } catch (err) {
        this.logger.error(`Dunning failed for subscription ${sub.id}: ${(err as Error).message}`);
        results.push({ subscriptionId: sub.id, outcome: 'skipped' });
      }
    }
    return results;
  }

  private async processDueSubscription(sub: SubscriptionWithRelations, now: Date): Promise<DunningOutcome> {
    if (sub.cancelAtPeriodEnd && sub.currentPeriodEnd <= now) {
      const cancelled = await this.prisma.memberSubscription.updateMany({
        where: { id: sub.id, nextChargeAt: sub.nextChargeAt },
        data: { status: MemberSubscriptionStatus.CANCELLED },
      });
      return { subscriptionId: sub.id, outcome: cancelled.count > 0 ? 'cancelled_at_period_end' : 'skipped' };
    }

    if (!sub.storedCard) {
      await this.prisma.memberSubscription.updateMany({
        where: { id: sub.id, nextChargeAt: sub.nextChargeAt },
        data: { status: MemberSubscriptionStatus.PAST_DUE },
      });
      return { subscriptionId: sub.id, outcome: 'no_card' };
    }

    const cycleAttempts = await this.currentCycleAttempts(sub.id);
    const attemptNumber = cycleAttempts.length + 1;

    const amount = Number(sub.packageDefinition.price);
    const charge = await this.providers.get(sub.storedCard.provider).chargeStoredCard({
      studioId: sub.studioId,
      memberId: sub.memberId,
      cardToken: sub.storedCard.providerCardToken,
      amount,
      currency: 'TRY',
      installmentCount: sub.installmentCount,
      description: `${sub.packageDefinition.name} yenileme`,
      reference: `dunning_${sub.id}_${attemptNumber}_${now.getTime()}`,
    });

    if (charge.success) {
      return this.applySuccessfulRenewal(sub, amount, charge.providerReference, attemptNumber);
    }
    return this.applyFailedRenewal(sub, charge.failureCode, attemptNumber, cycleAttempts, now);
  }

  /** Failed attempts since the subscription's last success, oldest last (findMany is desc). */
  private async currentCycleAttempts(subscriptionId: string): Promise<PaymentAttempt[]> {
    const all = await this.prisma.paymentAttempt.findMany({
      where: { memberSubscriptionId: subscriptionId },
      orderBy: { createdAt: 'desc' },
    });
    const lastSuccessIndex = all.findIndex((a) => a.status === PaymentAttemptStatus.SUCCEEDED);
    return lastSuccessIndex === -1 ? all : all.slice(0, lastSuccessIndex);
  }

  private async applySuccessfulRenewal(
    sub: SubscriptionWithRelations,
    amount: number,
    providerReference: string,
    attemptNumber: number,
  ): Promise<DunningOutcome> {
    const newStart = sub.currentPeriodEnd;
    const newEnd = new Date(newStart.getTime() + sub.packageDefinition.validityDays * DAY_MS);

    await this.prisma.$transaction(async (tx) => {
      const advanced = await tx.memberSubscription.updateMany({
        where: { id: sub.id, nextChargeAt: sub.nextChargeAt },
        data: {
          status: MemberSubscriptionStatus.ACTIVE,
          currentPeriodStart: newStart,
          currentPeriodEnd: newEnd,
          nextChargeAt: newEnd,
        },
      });
      if (advanced.count === 0) return;

      const memberPackage = await tx.memberPackage.create({
        data: {
          studioId: sub.studioId,
          memberId: sub.memberId,
          packageDefinitionId: sub.packageDefinitionId,
          entitlementKind: sub.packageDefinition.entitlementKind,
          totalUnits: sub.packageDefinition.totalUnits,
          usedUnits: 0,
          remainingUnits: sub.packageDefinition.totalUnits,
          status: 'ACTIVE',
          startDate: newStart,
          endDate: newEnd,
        },
      });

      const payment = await tx.payment.create({
        data: {
          studioId: sub.studioId,
          memberId: sub.memberId,
          memberPackageId: memberPackage.id,
          memberSubscriptionId: sub.id,
          storedCardId: sub.storedCardId,
          amount,
          currency: 'TRY',
          paymentMethod: CHARGE_PROVIDER_METHOD[sub.storedCard!.provider],
          paymentStatus: PaymentStatus.COMPLETED,
          provider: sub.storedCard!.provider,
          providerReference,
          installmentCount: sub.installmentCount,
        },
      });

      await tx.paymentAttempt.create({
        data: {
          studioId: sub.studioId,
          memberSubscriptionId: sub.id,
          paymentId: payment.id,
          attemptNumber,
          status: PaymentAttemptStatus.SUCCEEDED,
        },
      });
    });

    return { subscriptionId: sub.id, outcome: 'renewed', nextChargeAt: newEnd };
  }

  private async applyFailedRenewal(
    sub: SubscriptionWithRelations,
    failureCode: string | undefined,
    attemptNumber: number,
    cycleAttempts: PaymentAttempt[],
    now: Date,
  ): Promise<DunningOutcome> {
    // The oldest attempt of this cycle (last element, since the list is
    // newest-first) anchors the day-1/3/7 retry schedule; the very first
    // failure anchors itself.
    const anchor = cycleAttempts.length > 0 ? cycleAttempts[cycleAttempts.length - 1].createdAt : now;

    const willCancel = attemptNumber > DUNNING_RETRY_OFFSETS_DAYS.length;
    const nextRetryAt = willCancel
      ? null
      : new Date(anchor.getTime() + DUNNING_RETRY_OFFSETS_DAYS[attemptNumber - 1] * DAY_MS);

    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.memberSubscription.updateMany({
        where: { id: sub.id, nextChargeAt: sub.nextChargeAt },
        data: willCancel
          ? { status: MemberSubscriptionStatus.CANCELLED }
          : { status: MemberSubscriptionStatus.PAST_DUE, nextChargeAt: nextRetryAt! },
      });
      if (updated.count === 0) return;
      await tx.paymentAttempt.create({
        data: {
          studioId: sub.studioId,
          memberSubscriptionId: sub.id,
          attemptNumber,
          status: PaymentAttemptStatus.FAILED,
          failureCode: failureCode ?? null,
          nextRetryAt,
        },
      });
    });

    if (willCancel) {
      await this.notifyMemberSafe(sub, {
        title: 'Üyelik aboneliği iptal edildi',
        body: `${sub.packageDefinition.name} otomatik yenileme ödemesi tekrarlanan denemelere rağmen alınamadı; aboneliğiniz iptal edildi.`,
      });
      return { subscriptionId: sub.id, outcome: 'cancelled' };
    }

    await this.notifyMemberSafe(sub, {
      title: 'Ödeme alınamadı',
      body: `${sub.packageDefinition.name} otomatik yenileme ödemesi alınamadı, tekrar denenecek.`,
    });
    return { subscriptionId: sub.id, outcome: 'retry_scheduled', nextChargeAt: nextRetryAt ?? undefined };
  }

  private async notifyMemberSafe(sub: SubscriptionWithRelations, message: { title: string; body: string }) {
    try {
      const profile = await this.prisma.memberProfile.findFirst({
        where: { id: sub.memberId },
        select: { membership: { select: { userId: true } } },
      });
      if (!profile) return;
      await this.notifications.notifyUser({
        userId: profile.membership.userId,
        studioId: sub.studioId,
        category: 'PACKAGE',
        message,
      });
    } catch (err) {
      this.logger.warn(`Dunning notification failed for subscription ${sub.id}: ${(err as Error).message}`);
    }
  }
}
