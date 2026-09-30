import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@platform/database';
import type { PaymentProvider } from '@platform/database';
import { ADD_ON_TEMPLATE_KEYS, addOnPeriodEnd, localizedText, nextDunningAttempt } from '@platform/shared';
import type { AddOnInterval } from '@platform/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { PaymentProviderRegistry } from '../../payments/providers/payment-provider.registry';
import { PaymentWebhookRouter } from '../../payments/payment-webhook-router';
import type { RoutedWebhookResult } from '../../payments/payment-webhook-router';
import type { WebhookVerificationResult } from '../../payments/providers/payment-provider.interface';
import { MessagingService } from '../../messaging/engine/messaging.service';
import { notifyStudioOwner } from '../owner-notifier';
import { toLocalizedText } from './admin-add-ons.service';

export interface AddOnChargeParams {
  studioAddOnId: string;
  studioId: string;
  addOnKey: string;
  currency: string;
  /** Decimal string, e.g. "49.00". */
  amount: string;
  interval: AddOnInterval;
  actorUserId: string | null;
}

export interface AddOnChargeResult {
  paymentId: string;
  status: 'COMPLETED' | 'PENDING' | 'FAILED';
  checkoutUrl: string | null;
  /** The adapter error when the checkout could not be created (status FAILED). */
  error?: unknown;
}

/**
 * Charges and settles add-on payments through the process-wide payment
 * adapter (MOCK completes immediately outside production; Stripe and the
 * others return a hosted checkout that the existing
 * /payments/webhook/:provider URL confirms). Add-on payments are
 * platform_billing_payments rows with a studio_add_on_id and no plan; they
 * use no referral credit (referral rewards are unaffected).
 *
 * Failure handling is the platform's dunning: a failed RENEWAL counts, the
 * charge is retried after 1, 3 and 5 days (ADD_ON_DUNNING_RETRY_DAYS), the
 * owner is told each time, and the add-on expires when the retries run out.
 * A failed first activation only leaves the row as it was.
 */
@Injectable()
export class AddOnChargeService implements OnModuleInit {
  private readonly logger = new Logger(AddOnChargeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly providers: PaymentProviderRegistry,
    private readonly webhookRouter: PaymentWebhookRouter,
    private readonly messaging: MessagingService,
  ) {}

  onModuleInit(): void {
    this.webhookRouter.register((provider, verification) => this.handleWebhook(provider, verification));
  }

  /** Creates the payment and the provider checkout; completes it at once when the provider does. Never throws for a provider error. */
  async charge(params: AddOnChargeParams, now = new Date()): Promise<AddOnChargeResult> {
    const payment = await this.prisma.platformBillingPayment.create({
      data: {
        studioId: params.studioId,
        planId: null,
        studioAddOnId: params.studioAddOnId,
        listAmount: new Prisma.Decimal(params.amount),
        amount: new Prisma.Decimal(params.amount),
        currency: params.currency,
        periodMonths: params.interval === 'YEAR' ? 12 : 1,
        status: 'PENDING',
        createdByUserId: params.actorUserId,
      },
    });
    const adapter = this.providers.default;
    let checkout: { providerReference: string; status: 'COMPLETED' | 'PENDING'; checkoutUrl?: string };
    try {
      checkout = await adapter.createCheckout({
        studioId: params.studioId,
        memberId: params.studioId,
        amount: new Prisma.Decimal(params.amount).toNumber(),
        currency: params.currency,
        installmentCount: 1,
        description: `Platform add-on ${params.addOnKey}`,
        reference: `platform_${payment.id}`,
      });
    } catch (error) {
      await this.failPayment(payment.id, now);
      return { paymentId: payment.id, status: 'FAILED', checkoutUrl: null, error };
    }
    await this.prisma.platformBillingPayment.update({
      where: { id: payment.id },
      data: { provider: adapter.name, providerReference: checkout.providerReference },
    });
    if (checkout.status === 'COMPLETED') {
      await this.complete(payment.id, adapter.name, checkout.providerReference, now);
      return { paymentId: payment.id, status: 'COMPLETED', checkoutUrl: checkout.checkoutUrl ?? null };
    }
    return { paymentId: payment.id, status: 'PENDING', checkoutUrl: checkout.checkoutUrl ?? null };
  }

  /**
   * PENDING -> COMPLETED exactly once, then the add-on becomes (or stays)
   * ACTIVE for the paid period. A renewal extends from the previous period
   * end (no drift); a late one, or a fresh activation, starts now, except
   * that reactivating a cancelled add-on that still has paid access starts
   * where that access ends.
   */
  async complete(paymentId: string, provider: PaymentProvider | null, providerReference: string | null, now = new Date()): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const moved = await tx.platformBillingPayment.updateMany({
        where: { id: paymentId, status: 'PENDING', studioAddOnId: { not: null } },
        data: { status: 'COMPLETED', paidAt: now, ...(provider ? { provider, providerReference } : {}) },
      });
      if (moved.count === 0) return;
      const payment = await tx.platformBillingPayment.findUniqueOrThrow({ where: { id: paymentId } });
      if (!payment.studioAddOnId) return;
      const row = await tx.studioAddOn.findUniqueOrThrow({ where: { id: payment.studioAddOnId }, include: { addOn: { select: { key: true } } } });
      const interval: AddOnInterval = payment.periodMonths === 12 ? 'YEAR' : 'MONTH';
      const renewal = row.status === 'ACTIVE';
      const stillPaid = row.status === 'CANCELLED' && row.currentPeriodEnd !== null && row.currentPeriodEnd > now;
      const base = renewal ? (row.currentPeriodEnd ?? now) : stillPaid && row.currentPeriodEnd ? row.currentPeriodEnd : now;
      let periodEnd = addOnPeriodEnd(base, interval);
      if (periodEnd <= now) periodEnd = addOnPeriodEnd(now, interval);
      await tx.studioAddOn.update({
        where: { id: row.id },
        data: {
          status: 'ACTIVE',
          billingInterval: interval,
          activatedAt: renewal ? (row.activatedAt ?? now) : now,
          cancelledAt: null,
          currentPeriodEnd: periodEnd,
          renewalFailures: 0,
          nextRenewalAttemptAt: null,
        },
      });
      await tx.auditLog.create({
        data: {
          studioId: row.studioId,
          userId: payment.createdByUserId,
          action: renewal ? 'add_on.renew' : 'add_on.activate',
          entityType: 'StudioAddOn',
          entityId: row.id,
          metadata: {
            key: row.addOn.key,
            interval,
            amount: payment.amount.toFixed(2),
            currency: payment.currency,
            paymentId: payment.id,
            currentPeriodEnd: periodEnd.toISOString(),
          },
        },
      });
    });
  }

  /** PENDING -> FAILED exactly once; a failed renewal of an ACTIVE add-on enters dunning. */
  async failPayment(paymentId: string, now = new Date()): Promise<void> {
    const moved = await this.prisma.platformBillingPayment.updateMany({ where: { id: paymentId, status: 'PENDING' }, data: { status: 'FAILED' } });
    if (moved.count === 0) return;
    const payment = await this.prisma.platformBillingPayment.findUnique({ where: { id: paymentId }, select: { studioAddOnId: true } });
    if (!payment?.studioAddOnId) return;
    const row = await this.prisma.studioAddOn.findUnique({ where: { id: payment.studioAddOnId }, select: { status: true } });
    if (row?.status === 'ACTIVE') await this.recordRenewalFailure(payment.studioAddOnId, now);
  }

  /** Counts a failed renewal: schedule the next attempt, or expire the add-on when the retries are used up. */
  async recordRenewalFailure(studioAddOnId: string, now: Date): Promise<'RETRY' | 'EXPIRED' | 'NOOP'> {
    const row = await this.prisma.studioAddOn.findUnique({
      where: { id: studioAddOnId },
      include: { addOn: { select: { key: true, name: true } }, studio: { select: { defaultLocale: true } } },
    });
    if (!row || row.status !== 'ACTIVE') return 'NOOP';
    const failures = row.renewalFailures + 1;
    const next = nextDunningAttempt(failures, now);
    const addOnName = localizedText(toLocalizedText(row.addOn.name), row.studio.defaultLocale);
    if (next === null) {
      const expired = await this.prisma.studioAddOn.updateMany({
        where: { id: row.id, status: 'ACTIVE' },
        data: { status: 'EXPIRED', renewalFailures: failures, nextRenewalAttemptAt: null },
      });
      if (expired.count === 0) return 'NOOP';
      await this.audit(row.studioId, 'add_on.expired', row.id, { key: row.addOn.key, reason: 'RENEWAL_FAILED', failures });
      await this.notify(row.studioId, ADD_ON_TEMPLATE_KEYS.renewalFailed, `addon-renewal-failed:${row.id}:${failures}`, { addOnName });
      return 'EXPIRED';
    }
    const updated = await this.prisma.studioAddOn.updateMany({
      where: { id: row.id, status: 'ACTIVE', renewalFailures: row.renewalFailures },
      data: { renewalFailures: failures, nextRenewalAttemptAt: next },
    });
    if (updated.count === 0) return 'NOOP';
    await this.audit(row.studioId, 'add_on.renewal_failed', row.id, { key: row.addOn.key, failures, nextAttemptAt: next.toISOString() });
    await this.notify(row.studioId, ADD_ON_TEMPLATE_KEYS.renewalFailed, `addon-renewal-failed:${row.id}:${failures}`, { addOnName });
    return 'RETRY';
  }

  /** Verified provider webhook for an add-on payment (routed from /payments/webhook/:provider). */
  async handleWebhook(provider: PaymentProvider, verification: WebhookVerificationResult): Promise<RoutedWebhookResult | null> {
    if (!verification.providerReference) return null;
    const payment = await this.prisma.platformBillingPayment.findFirst({
      where: { provider, providerReference: verification.providerReference, studioAddOnId: { not: null } },
    });
    if (!payment) return null;
    if (payment.status !== 'PENDING') return { handled: true, alreadyProcessed: true };
    if (verification.amount !== undefined && !new Prisma.Decimal(verification.amount).toDecimalPlaces(2).equals(new Prisma.Decimal(payment.amount))) {
      this.logger.warn(`Webhook amount mismatch for add-on payment ${payment.id}`);
      return { handled: false, reason: 'AMOUNT_MISMATCH' };
    }
    if (verification.eventType === 'CHECKOUT_COMPLETED' || verification.eventType === 'CHARGE_SUCCEEDED') {
      await this.complete(payment.id, provider, verification.providerReference);
      return { handled: true };
    }
    if (verification.eventType === 'CHARGE_FAILED') {
      await this.failPayment(payment.id);
      return { handled: true };
    }
    return { handled: false };
  }

  private async audit(studioId: string, action: string, entityId: string, metadata: Prisma.InputJsonObject): Promise<void> {
    await this.prisma.auditLog.create({ data: { studioId, userId: null, action, entityType: 'StudioAddOn', entityId, metadata } });
  }

  private notify(studioId: string, templateKey: string, idempotencyKey: string, variables: Record<string, string | number>): Promise<boolean> {
    return notifyStudioOwner({ prisma: this.prisma, messaging: this.messaging, logger: this.logger }, studioId, templateKey, idempotencyKey, variables);
  }
}
