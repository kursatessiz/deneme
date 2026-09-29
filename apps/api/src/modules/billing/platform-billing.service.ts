import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, OnModuleInit, Optional } from '@nestjs/common';
import { Prisma, SubscriptionStatus } from '@platform/database';
import type { PaymentProvider, Plan, PlanPrice, PlatformBillingPayment } from '@platform/database';
import {
  DEFAULT_TRIAL_DAYS,
  PLAN_PRICE_UNAVAILABLE_ERROR_CODE,
  applyCredits,
  canTransitionBillingStatus,
  creditBalanceOf,
  isPlatformBillingCurrency,
  isStudioBillingStatus,
  planPriceIn,
  studioBillingCurrency,
  trialDaysLeft,
  trialEndFrom,
} from '@platform/shared';
import type {
  ActivateStudioInput,
  ActivateStudioResultDTO,
  AdminForceBillingStatusInput,
  AdminSetBillingCurrencyInput,
  BillingPlanDTO,
  CreditBalance,
  CurrentBillingPlanDTO,
  ExtendTrialInput,
  PlatformBillingCurrency,
  PlatformPaymentDTO,
  PlatformPaymentStatus,
  StudioBillingDTO,
  StudioBillingStatus,
} from '@platform/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentProviderRegistry } from '../payments/providers/payment-provider.registry';
import { PaymentWebhookRouter } from '../payments/payment-webhook-router';
import type { RoutedWebhookResult } from '../payments/payment-webhook-router';
import type { WebhookVerificationResult } from '../payments/providers/payment-provider.interface';
import { ConversionService } from '../crm/conversions/conversion.service';
import { StudioReferralsService } from './studio-referrals.service';
import { PlatformEventsService } from '../webhooks/platform-events.service';
import type { TenantContext } from '../auth/tenant-context';

type Tx = Prisma.TransactionClient;
type PricedPlan = Plan & { prices: PlanPrice[] };
const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

/** 400 when the plan has no price in the studio's billing currency; clients translate `billing.error.PLAN_PRICE_UNAVAILABLE`. */
export function planPriceUnavailableError(): BadRequestException {
  return new BadRequestException({
    statusCode: 400,
    code: PLAN_PRICE_UNAVAILABLE_ERROR_CODE,
    message: 'Bu plan işletmenin faturalama para biriminde sunulmuyor',
  });
}

/**
 * Platform billing of tenants (G5c-1, docs/DENEME_VE_ETKINLESTIRME.md).
 *
 * Studio.billingStatus is the gate (read by StudioTenantGuard on every
 * request); Subscription keeps the plan and period history as before.
 * Activation charges the plan price through the process-wide payment
 * adapter (MOCK completes immediately outside production), consumes
 * referral credits first, moves the studio to ACTIVE, records studio_paid
 * on the platform tenant once per studio and rewards the referrer.
 *
 * Every price is the plan's plan_prices row in the studio's billing
 * currency (G5c-1b: the super admin's override, else derived from the
 * studio's country); a plan without one is not offered.
 */
@Injectable()
export class PlatformBillingService implements OnModuleInit {
  private readonly logger = new Logger(PlatformBillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly providers: PaymentProviderRegistry,
    private readonly webhookRouter: PaymentWebhookRouter,
    private readonly conversions: ConversionService,
    private readonly referrals: StudioReferralsService,
    @Optional() private readonly platformEvents?: PlatformEventsService,
  ) {}

  onModuleInit(): void {
    this.webhookRouter.register((provider, verification) => this.handleWebhook(provider, verification));
  }

  // ---------------------------------------------------------------------------
  // Trial
  // ---------------------------------------------------------------------------

  /** New tenant (super-admin creation): TRIALING for the plan's trial length. Returns the trial end. */
  async startTrial(tx: Tx, studioId: string, plan: Pick<Plan, 'trialDays'>, now = new Date()): Promise<Date> {
    const trialEndsAt = trialEndFrom(now, plan.trialDays ?? DEFAULT_TRIAL_DAYS);
    await tx.studio.update({
      where: { id: studioId },
      data: {
        billingStatus: 'TRIALING',
        trialStartedAt: now,
        trialEndsAt,
        billingStatusChangedAt: now,
        trialReminderSentDays: null,
      },
    });
    return trialEndsAt;
  }

  // ---------------------------------------------------------------------------
  // Tenant-facing
  // ---------------------------------------------------------------------------

  async summary(studioId: string, now = new Date()): Promise<StudioBillingDTO> {
    const [studio, subscription, plans, credit, locked] = await Promise.all([
      this.prisma.studio.findUnique({
        where: { id: studioId },
        select: { billingStatus: true, trialStartedAt: true, trialEndsAt: true, activatedAt: true, countryCode: true, billingCurrency: true },
      }),
      this.currentSubscription(studioId),
      this.prisma.plan.findMany({ where: { isActive: true }, include: { prices: true } }),
      this.creditBalance(studioId),
      this.hasCompletedPayment(studioId),
    ]);
    if (!studio) throw new NotFoundException('İşletme bulunamadı');
    const currency = studioBillingCurrency(studio);
    const offered = plans
      .map((plan) => toPlanDto(plan, currency))
      .filter((plan): plan is BillingPlanDTO => plan !== null)
      .sort((a, b) => new Prisma.Decimal(a.priceMonthly).comparedTo(new Prisma.Decimal(b.priceMonthly)));
    return {
      status: this.statusOf(studio.billingStatus),
      billingCurrency: currency,
      billingCurrencyLocked: locked,
      trialStartedAt: studio.trialStartedAt?.toISOString() ?? null,
      trialEndsAt: studio.trialEndsAt?.toISOString() ?? null,
      trialDaysLeft: studio.billingStatus === 'TRIALING' ? trialDaysLeft(studio.trialEndsAt, now) : null,
      activatedAt: studio.activatedAt?.toISOString() ?? null,
      plan: subscription ? toCurrentPlanDto(subscription.plan, currency) : null,
      currentPeriodEnd: subscription?.currentPeriodEnd.toISOString() ?? null,
      credit,
      plans: offered,
    };
  }

  /** A completed platform payment fixes the studio's billing currency. */
  async hasCompletedPayment(studioId: string): Promise<boolean> {
    const paid = await this.prisma.platformBillingPayment.findFirst({ where: { studioId, status: 'COMPLETED' }, select: { id: true } });
    return paid !== null;
  }

  async listPayments(studioId: string): Promise<PlatformPaymentDTO[]> {
    const rows = await this.prisma.platformBillingPayment.findMany({
      where: { studioId },
      include: { plan: { select: { key: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return rows.map(toPaymentDto);
  }

  /**
   * "Hesabı etkinleştir": charge the chosen plan for one month. Credits
   * are reserved (APPLIED rows) when the charge is created and reversed if
   * it fails, so two parallel checkouts cannot spend the same credit.
   */
  async activate(tenant: TenantContext, actorUserId: string, dto: ActivateStudioInput): Promise<ActivateStudioResultDTO> {
    const studioId = tenant.studioId;
    const [studio, plan] = await Promise.all([
      this.prisma.studio.findUnique({ where: { id: studioId }, select: { id: true, billingStatus: true, isPlatform: true, countryCode: true, billingCurrency: true } }),
      this.prisma.plan.findFirst({ where: { key: dto.planKey, isActive: true }, include: { prices: true } }),
    ]);
    if (!studio) throw new NotFoundException('İşletme bulunamadı');
    if (studio.isPlatform) throw new BadRequestException('Platform kiracısı etkinleştirilemez');
    if (!plan) throw new BadRequestException('Plan bulunamadı');
    const currency = studioBillingCurrency(studio);
    const price = planPriceIn(plan.prices, currency);
    if (!price) throw planPriceUnavailableError();
    const status = this.statusOf(studio.billingStatus);
    if (status === 'ACTIVE') throw new ConflictException('Hesap zaten etkin');
    if (!canTransitionBillingStatus(status, 'ACTIVE')) throw new ConflictException('Hesap bu durumdan etkinleştirilemez');

    const pendingExists = await this.prisma.platformBillingPayment.findFirst({
      where: { studioId, status: 'PENDING', createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } },
      select: { id: true },
    });
    if (pendingExists) throw new ConflictException('Bekleyen bir ödeme var; tamamlanmasını bekleyin');

    const periodMonths = 1;
    const listAmount = new Prisma.Decimal(price.priceMonthly).toFixed(2);
    const balance = await this.creditBalance(studioId);
    // Money credit only applies in the charge's own currency (never converted).
    const applied = applyCredits({ amount: listAmount, currency, periodMonths }, balance);

    const payment = await this.prisma.$transaction(async (tx) => {
      const created = await tx.platformBillingPayment.create({
        data: {
          studioId,
          planId: plan.id,
          listAmount,
          creditAmount: applied.creditAmount,
          creditMonths: applied.creditMonths,
          amount: applied.payable,
          currency,
          periodMonths,
          status: 'PENDING',
          createdByUserId: actorUserId,
        },
      });
      await this.reserveCredits(tx, studioId, created.id, applied.creditAmount, currency, applied.creditMonths);
      return created;
    });

    const payable = new Prisma.Decimal(applied.payable);
    if (payable.lte(0)) {
      // Credits cover the whole charge: no provider call.
      await this.complete(payment.id, null, null);
      return this.activationResult(payment.id, false, null);
    }

    const adapter = this.providers.default;
    let checkout: { providerReference: string; status: 'COMPLETED' | 'PENDING'; checkoutUrl?: string };
    try {
      checkout = await adapter.createCheckout({
        studioId,
        memberId: studioId,
        amount: payable.toNumber(),
        currency,
        installmentCount: dto.installmentCount,
        description: `Platform subscription ${plan.key}`,
        reference: `platform_${payment.id}`,
      });
    } catch (err) {
      await this.fail(payment.id);
      throw err;
    }
    await this.prisma.platformBillingPayment.update({
      where: { id: payment.id },
      data: { provider: adapter.name, providerReference: checkout.providerReference },
    });
    if (checkout.status === 'COMPLETED') {
      await this.complete(payment.id, adapter.name, checkout.providerReference);
      return this.activationResult(payment.id, false, checkout.checkoutUrl ?? null);
    }
    return this.activationResult(payment.id, true, checkout.checkoutUrl ?? null);
  }

  /** Verified provider webhook for a platform payment (routed from /payments/webhook/:provider). */
  async handleWebhook(provider: PaymentProvider, verification: WebhookVerificationResult): Promise<RoutedWebhookResult | null> {
    if (!verification.providerReference) return null;
    const payment = await this.prisma.platformBillingPayment.findFirst({
      where: { provider, providerReference: verification.providerReference },
    });
    if (!payment) return null;
    if (payment.status !== 'PENDING') return { handled: true, alreadyProcessed: true };
    if (
      verification.amount !== undefined &&
      !new Prisma.Decimal(verification.amount).toDecimalPlaces(2).equals(new Prisma.Decimal(payment.amount))
    ) {
      this.logger.warn(`Webhook amount mismatch for platform payment ${payment.id}`);
      return { handled: false, reason: 'AMOUNT_MISMATCH' };
    }
    if (verification.eventType === 'CHECKOUT_COMPLETED' || verification.eventType === 'CHARGE_SUCCEEDED') {
      await this.complete(payment.id, provider, verification.providerReference);
      return { handled: true };
    }
    if (verification.eventType === 'CHARGE_FAILED') {
      await this.fail(payment.id);
      return { handled: true };
    }
    return { handled: false };
  }

  // ---------------------------------------------------------------------------
  // Super admin
  // ---------------------------------------------------------------------------

  async extendTrial(actorUserId: string, studioId: string, dto: ExtendTrialInput, now = new Date()) {
    const studio = await this.prisma.studio.findUnique({ where: { id: studioId }, select: { id: true, billingStatus: true, trialEndsAt: true, trialStartedAt: true } });
    if (!studio) throw new NotFoundException('İşletme bulunamadı');
    const status = this.statusOf(studio.billingStatus);
    if (status !== 'TRIALING' && status !== 'RESTRICTED') throw new ConflictException('Yalnızca deneme veya kısıtlı moddaki işletmenin denemesi uzatılabilir');
    const base = studio.trialEndsAt && studio.trialEndsAt > now ? studio.trialEndsAt : now;
    const trialEndsAt = trialEndFrom(base, dto.days);

    await this.prisma.$transaction(async (tx) => {
      const moved = await tx.studio.updateMany({
        where: { id: studioId, billingStatus: status },
        data: {
          billingStatus: 'TRIALING',
          trialEndsAt,
          trialStartedAt: studio.trialStartedAt ?? now,
          trialReminderSentDays: null,
          ...(status !== 'TRIALING' ? { billingStatusChangedAt: now } : {}),
        },
      });
      if (moved.count === 0) throw new ConflictException('İşletmenin durumu değişti, tekrar deneyin');
      await tx.subscription.updateMany({
        where: { studioId, status: SubscriptionStatus.TRIALING },
        data: { currentPeriodEnd: trialEndsAt },
      });
      await tx.auditLog.create({
        data: {
          studioId,
          userId: actorUserId,
          action: 'billing.trial_extend',
          entityType: 'Studio',
          entityId: studioId,
          metadata: { days: dto.days, from: status, previousTrialEndsAt: studio.trialEndsAt?.toISOString() ?? null, trialEndsAt: trialEndsAt.toISOString() },
        },
      });
    });
    return { status: 'TRIALING' as StudioBillingStatus, trialEndsAt: trialEndsAt.toISOString() };
  }

  /**
   * Force ACTIVE (no payment) or RESTRICTED. Audit logged. A forced
   * activation is not a paying customer unless the super admin sets
   * recordAsPaid (G5c-1b): then studio_paid is recorded at the plan's list
   * price in the studio's billing currency and the referrer is rewarded,
   * through the same code as a paid activation and at most once per studio.
   */
  async forceStatus(actorUserId: string, studioId: string, dto: AdminForceBillingStatusInput, now = new Date()) {
    const recordAsPaid = dto.recordAsPaid === true;
    if (recordAsPaid && dto.status !== 'ACTIVE') throw new BadRequestException('Ödeme kaydı yalnızca etkinleştirmede seçilebilir');
    const studio = await this.prisma.studio.findUnique({
      where: { id: studioId },
      select: { id: true, billingStatus: true, isPlatform: true, countryCode: true, billingCurrency: true },
    });
    if (!studio) throw new NotFoundException('İşletme bulunamadı');
    if (studio.isPlatform) throw new BadRequestException('Platform kiracısının durumu değiştirilemez');
    const from = this.statusOf(studio.billingStatus);
    if (from === dto.status) return { status: from, recordAsPaid: false };
    if (!canTransitionBillingStatus(from, dto.status)) throw new ConflictException('Bu durum geçişine izin verilmiyor');
    const currency = studioBillingCurrency(studio);

    let planKey: string | null = null;
    let paidValue: { amount: string; currency: string } | null = null;
    await this.prisma.$transaction(async (tx) => {
      const moved = await tx.studio.updateMany({
        where: { id: studioId, billingStatus: from },
        data: { billingStatus: dto.status, billingStatusChangedAt: now },
      });
      if (moved.count === 0) throw new ConflictException('İşletmenin durumu değişti, tekrar deneyin');
      if (dto.status === 'ACTIVE') {
        await tx.studio.updateMany({ where: { id: studioId, activatedAt: null }, data: { activatedAt: now } });
        const plan = await this.planForForce(tx, studioId, dto.planKey);
        planKey = plan.key;
        if (recordAsPaid) {
          const price = planPriceIn(plan.prices, currency);
          if (!price) throw planPriceUnavailableError();
          paidValue = { amount: new Prisma.Decimal(price.priceMonthly).toFixed(2), currency };
        }
        await this.startPaidPeriod(tx, studioId, plan.id, now, 1);
      }
      await tx.auditLog.create({
        data: {
          studioId,
          userId: actorUserId,
          action: dto.status === 'ACTIVE' ? 'billing.force_activate' : 'billing.force_restrict',
          entityType: 'Studio',
          entityId: studioId,
          metadata: { from, to: dto.status, planKey, reason: dto.reason ?? null, recordAsPaid, paidValue },
        },
      });
    });
    if (paidValue) await this.recordPaidActivation(studioId, paidValue, now);
    return { status: dto.status, recordAsPaid };
  }

  /**
   * Super admin: pin the studio's billing currency, or null to derive it
   * from the country again. Allowed after a completed payment too (this is
   * the override the owner cannot make); audit logged with that fact.
   */
  async setBillingCurrency(actorUserId: string, studioId: string, dto: AdminSetBillingCurrencyInput) {
    const studio = await this.prisma.studio.findUnique({ where: { id: studioId }, select: { id: true, countryCode: true, billingCurrency: true } });
    if (!studio) throw new NotFoundException('İşletme bulunamadı');
    const before = studioBillingCurrency(studio);
    const override = dto.currency;
    const after = studioBillingCurrency({ countryCode: studio.countryCode, billingCurrency: override });
    const pending = await this.prisma.platformBillingPayment.findFirst({ where: { studioId, status: 'PENDING' }, select: { id: true } });
    if (pending && before !== after) throw new ConflictException('Bekleyen bir ödeme var; tamamlanmasını bekleyin');
    const hadCompletedPayment = await this.hasCompletedPayment(studioId);
    await this.prisma.$transaction(async (tx) => {
      await tx.studio.update({ where: { id: studioId }, data: { billingCurrency: override } });
      await tx.auditLog.create({
        data: {
          studioId,
          userId: actorUserId,
          action: 'billing.currency_override',
          entityType: 'Studio',
          entityId: studioId,
          metadata: {
            previousOverride: isPlatformBillingCurrency(studio.billingCurrency) ? studio.billingCurrency : null,
            override,
            from: before,
            to: after,
            hadCompletedPayment,
            reason: dto.reason ?? null,
          },
        },
      });
    });
    return { billingCurrency: after, billingCurrencyOverride: override };
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  async creditBalance(studioId: string): Promise<CreditBalance> {
    const rows = await this.prisma.platformCreditLedger.findMany({ where: { studioId }, select: { amount: true, currency: true, months: true } });
    return creditBalanceOf(rows.map((r) => ({ amount: r.amount ? r.amount.toFixed(2) : null, currency: r.currency, months: r.months })));
  }

  private async reserveCredits(tx: Tx, studioId: string, paymentId: string, amount: string, currency: string, months: number): Promise<void> {
    if (new Prisma.Decimal(amount).gt(0)) {
      await tx.platformCreditLedger.create({
        data: { studioId, kind: 'APPLIED', amount: new Prisma.Decimal(amount).neg(), currency, billingPaymentId: paymentId, idempotencyKey: `applied:${paymentId}:amount` },
      });
    }
    if (months > 0) {
      await tx.platformCreditLedger.create({
        data: { studioId, kind: 'APPLIED', months: -months, billingPaymentId: paymentId, idempotencyKey: `applied:${paymentId}:months` },
      });
    }
  }

  /** PENDING -> COMPLETED exactly once, then activation side effects. */
  private async complete(paymentId: string, provider: PaymentProvider | null, providerReference: string | null, now = new Date()): Promise<void> {
    const payment = await this.prisma.$transaction(async (tx) => {
      const moved = await tx.platformBillingPayment.updateMany({
        where: { id: paymentId, status: 'PENDING' },
        data: { status: 'COMPLETED', paidAt: now, ...(provider ? { provider, providerReference } : {}) },
      });
      if (moved.count === 0) return null;
      const row = await tx.platformBillingPayment.findUniqueOrThrow({ where: { id: paymentId }, include: { plan: true } });
      const studio = await tx.studio.findUniqueOrThrow({ where: { id: row.studioId }, select: { billingStatus: true } });
      const from = this.statusOf(studio.billingStatus);
      if (from !== 'ACTIVE') {
        await tx.studio.update({ where: { id: row.studioId }, data: { billingStatus: 'ACTIVE', billingStatusChangedAt: now } });
      }
      await tx.studio.updateMany({ where: { id: row.studioId, activatedAt: null }, data: { activatedAt: now } });
      await this.startPaidPeriod(tx, row.studioId, row.planId, now, row.periodMonths);
      await tx.auditLog.create({
        data: {
          studioId: row.studioId,
          userId: row.createdByUserId,
          action: 'billing.activate',
          entityType: 'PlatformBillingPayment',
          entityId: row.id,
          metadata: { from, planKey: row.plan.key, amount: row.amount.toFixed(2), currency: row.currency, creditAmount: row.creditAmount.toFixed(2), creditMonths: row.creditMonths },
        },
      });
      return row;
    });
    if (!payment) return;

    // After commit, best effort: neither may undo a completed payment.
    await this.recordPaidActivation(payment.studioId, { amount: payment.listAmount.toFixed(2), currency: payment.currency }, now);
  }

  /**
   * The paying-customer side effects of an activation, shared by a completed
   * payment and a super-admin force-activation with recordAsPaid: studio_paid
   * on the platform tenant (source studio_activation:<studioId>, so once per
   * studio, with the usual attribution) and the referral reward (once per
   * referred studio). Runs after commit and never undoes the activation.
   */
  private async recordPaidActivation(studioId: string, value: { amount: string; currency: string }, now: Date): Promise<void> {
    await this.conversions.recordStudioPaid(studioId, { kind: 'studio_activation', id: studioId }, value, now);
    await this.referrals.onReferredStudioActivated(studioId);
    await this.emitStudioPaid(studioId, value);
  }

  /** M4c: studio.paid for the platform tenant's automation subscriptions (Zapier, Make, n8n). Never throws. */
  private async emitStudioPaid(studioId: string, value: { amount: string; currency: string }): Promise<void> {
    if (!this.platformEvents) return;
    try {
      const studio = await this.prisma.studio.findUnique({
        where: { id: studioId },
        select: { name: true, subscriptions: { where: { status: { not: 'CANCELLED' } }, orderBy: { createdAt: 'desc' }, take: 1, select: { plan: { select: { key: true } } } } },
      });
      if (!studio) return;
      await this.platformEvents.emit('studio.paid', {
        studioId,
        name: studio.name,
        planKey: studio.subscriptions[0]?.plan.key ?? null,
        amount: value.amount,
        currency: value.currency,
      });
    } catch {
      // A failed automation event must never undo or fail an activation.
    }
  }

  private async fail(paymentId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const moved = await tx.platformBillingPayment.updateMany({ where: { id: paymentId, status: 'PENDING' }, data: { status: 'FAILED' } });
      if (moved.count === 0) return;
      // Give reserved credits back (append-only: a reversing row).
      const reserved = await tx.platformCreditLedger.findMany({ where: { billingPaymentId: paymentId, kind: 'APPLIED' } });
      for (const row of reserved) {
        await tx.platformCreditLedger.create({
          data: {
            studioId: row.studioId,
            kind: 'ADJUSTMENT',
            amount: row.amount ? row.amount.neg() : null,
            currency: row.currency,
            months: row.months !== null ? -row.months : null,
            billingPaymentId: paymentId,
            idempotencyKey: `reversal:${row.idempotencyKey}`,
          },
        });
      }
    });
  }

  private async startPaidPeriod(tx: Tx, studioId: string, planId: string, now: Date, periodMonths: number): Promise<void> {
    await tx.subscription.updateMany({
      where: { studioId, status: { in: [SubscriptionStatus.TRIALING, SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE] } },
      data: { status: SubscriptionStatus.CANCELLED, cancelledAt: now },
    });
    await tx.subscription.create({
      data: {
        studioId,
        planId,
        status: SubscriptionStatus.ACTIVE,
        currentPeriodStart: now,
        currentPeriodEnd: new Date(now.getTime() + periodMonths * MONTH_MS),
      },
    });
  }

  private async planForForce(tx: Tx, studioId: string, planKey: string | undefined): Promise<PricedPlan> {
    if (planKey) {
      const plan = await tx.plan.findUnique({ where: { key: planKey }, include: { prices: true } });
      if (!plan) throw new BadRequestException('Plan bulunamadı');
      return plan;
    }
    const current = await tx.subscription.findFirst({ where: { studioId }, orderBy: { createdAt: 'desc' }, include: { plan: { include: { prices: true } } } });
    if (!current) throw new BadRequestException('Plan seçilmelidir');
    return current.plan;
  }

  private currentSubscription(studioId: string) {
    return this.prisma.subscription.findFirst({
      where: { studioId, status: { not: SubscriptionStatus.CANCELLED } },
      orderBy: { createdAt: 'desc' },
      include: { plan: { include: { prices: true } } },
    });
  }

  private async activationResult(paymentId: string, pending: boolean, checkoutUrl: string | null): Promise<ActivateStudioResultDTO> {
    const row = await this.prisma.platformBillingPayment.findUniqueOrThrow({ where: { id: paymentId }, include: { plan: { select: { key: true } } } });
    const studio = await this.prisma.studio.findUniqueOrThrow({ where: { id: row.studioId }, select: { billingStatus: true } });
    return { status: this.statusOf(studio.billingStatus), pending, checkoutUrl, payment: toPaymentDto(row) };
  }

  private statusOf(value: string): StudioBillingStatus {
    return isStudioBillingStatus(value) ? value : 'ACTIVE';
  }
}

/** The plan as offered in `currency`; null when it has no price there (not offered). */
function toPlanDto(plan: PricedPlan, currency: PlatformBillingCurrency): BillingPlanDTO | null {
  const price = planPriceIn(plan.prices, currency);
  if (!price) return null;
  return { key: plan.key, name: plan.name, priceMonthly: new Prisma.Decimal(price.priceMonthly).toFixed(2), currency, trialDays: plan.trialDays };
}

function toCurrentPlanDto(plan: PricedPlan, currency: PlatformBillingCurrency): CurrentBillingPlanDTO {
  const price = planPriceIn(plan.prices, currency);
  return {
    key: plan.key,
    name: plan.name,
    priceMonthly: price ? new Prisma.Decimal(price.priceMonthly).toFixed(2) : null,
    currency,
    trialDays: plan.trialDays,
  };
}

function toPaymentDto(row: PlatformBillingPayment & { plan: { key: string } }): PlatformPaymentDTO {
  return {
    id: row.id,
    planKey: row.plan.key,
    listAmount: row.listAmount.toFixed(2),
    creditAmount: row.creditAmount.toFixed(2),
    creditMonths: row.creditMonths,
    amount: row.amount.toFixed(2),
    currency: row.currency,
    status: row.status as PlatformPaymentStatus,
    paidAt: row.paidAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}
