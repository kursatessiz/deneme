import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { CrmHooksService } from '../crm/hooks/crm-hooks.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { InvoicingService } from '../invoicing/invoicing.service';
import { PaymentProviderRegistry } from './providers/payment-provider.registry';
import { WebhooksService } from '../webhooks/webhooks.service';
import { PromotionsService } from '../promotions/promotions.service';
import { EventSeatsService } from '../events/event-seats.service';
import type { TenantContext } from '../auth/tenant-context';
import type {
  CancelSubscriptionInput,
  CardTokenInput,
  ConfirmBankTransferInput,
  CreateSubscriptionInput,
  ListPaymentsQuery,
  MemberCheckoutInput,
  PauseSubscriptionInput,
  RefundPaymentInput,
  SellPackageInput,
} from '@platform/shared';
import { maskLeaderboardName } from '@platform/shared';
import { Prisma, PaymentMethod, PaymentProvider, PaymentStatus, PackageDefinition } from '@platform/database';
import { assertBranchAccess, branchScope } from '../branches/branch-access';
import { PaymentWebhookRouter } from './payment-webhook-router';
import { onlineCheckoutMethod, providerForOnlineMethod } from './provider-method';
import { apiError, codedError } from '../../common/api-error';
import { serverT, studioLocale } from '../../common/server-i18n';

type Tx = Prisma.TransactionClient;

/** Money already captured at a provider whose sale transaction has not committed yet. */
interface CapturedCharge {
  studioId: string;
  memberId: string;
  provider: PaymentProvider;
  paymentMethod: PaymentMethod;
  providerReference: string;
  amount: number;
  currency: string;
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
    private providers: PaymentProviderRegistry,
    private invoicing: InvoicingService,
    private promotions: PromotionsService,
    private webhooks: WebhooksService,
    @Optional() private crm?: CrmHooksService,
    @Optional() private eventSeats?: EventSeatsService,
    @Optional() private webhookRouter?: PaymentWebhookRouter,
  ) {}

  /**
   * Post-completion work (automatic e-invoice) for a payment another module
   * recorded as COMPLETED, e.g. an event ticket (G3c-1). Never throws.
   */
  async onPaymentCompleted(studioId: string, paymentId: string): Promise<void> {
    await this.maybeAutoIssueInvoice(studioId, paymentId);
  }

  /**
   * Auto-issues an e-invoice for a just-completed payment, when the studio
   * has e-invoicing configured and auto-issue on. Always best-effort: a
   * provider failure is already recorded as a FAILED Invoice inside
   * InvoicingService, and any unexpected error here is only logged, so a
   * document generation problem never undoes or blocks the payment itself.
   *
   * Also emits the payment.completed webhook, since every immediate-payment
   * completion path (sale, self checkout, bank transfer confirmation,
   * provider webhook) already calls this helper right after the payment
   * transitions to COMPLETED.
   */
  private async maybeAutoIssueInvoice(studioId: string, paymentId: string): Promise<void> {
    try {
      const settings = await this.invoicing.getSettings(studioId);
      if (!settings || !settings.autoIssueOnPayment || settings.eInvoiceMode === 'NONE') return;
      await this.invoicing.issueForPayment(studioId, paymentId);
    } catch (err) {
      this.logger.warn(`Auto-issue invoice failed for payment ${paymentId}: ${err instanceof Error ? err.message : err}`);
    }
    await this.webhooks.emit(studioId, 'payment.completed', await this.paymentWebhookData(studioId, paymentId));
    // CRM purchase / subscription conversion; never throws (CrmHooksService).
    await this.crm?.onPaymentCompleted(studioId, paymentId);
  }

  /**
   * Who paid and how much, for the payment webhooks: memberId is null for a
   * guest or walk-in payment, contactId then names the payer when known.
   * Falls back to the id alone if the row is gone (never throws).
   */
  async paymentWebhookData(studioId: string, paymentId: string): Promise<Record<string, unknown>> {
    try {
      const payment = await this.prisma.payment.findFirst({
        where: { id: paymentId, studioId },
        select: { memberId: true, contactId: true, amount: true, currency: true },
      });
      if (!payment) return { paymentId };
      return { paymentId, memberId: payment.memberId, contactId: payment.contactId, amount: payment.amount.toFixed(2), currency: payment.currency };
    } catch {
      return { paymentId };
    }
  }

  /**
   * Resolves the userId (global) for a member profile, for trial/promo
   * redemption tracking, which is keyed by user rather than member profile.
   */
  private async resolveUserId(studioId: string, memberId: string): Promise<string> {
    const member = await this.prisma.memberProfile.findFirstOrThrow({
      where: { id: memberId, studioId },
      include: { membership: true },
    });
    return member.membership.userId;
  }

  // ---------------------------------------------------------------------------
  // Selling a package with an immediate or pending payment
  // ---------------------------------------------------------------------------

  async sellPackage(tenant: TenantContext, dto: SellPackageInput) {
    const studioId = tenant.studioId;
    const [pkgDef, member] = await Promise.all([
      this.prisma.packageDefinition.findFirst({ where: { id: dto.packageDefinitionId, studioId } }),
      this.prisma.memberProfile.findFirst({ where: { id: dto.memberId, studioId } }),
    ]);
    if (!pkgDef) throw new NotFoundException(apiError('apiErrors.common.packageDefinitionNotFound'));
    if (!member) throw new NotFoundException(apiError('apiErrors.common.memberNotFound'));

    const branchId = dto.branchId ?? member.homeBranchId ?? null;
    if (branchId) assertBranchAccess(tenant, branchId);
    else if (tenant.branchIds !== null) {
      throw new BadRequestException(apiError('apiErrors.common.selectBranch'));
    }

    // The business currency is the only currency a sale can be taken in.
    const studio = await this.prisma.studio.findUniqueOrThrow({ where: { id: studioId }, select: { currency: true } });
    if (dto.currency.toUpperCase() !== studio.currency.toUpperCase()) {
      throw new BadRequestException(apiError('apiErrors.payments.currencyMustMatchStudio', { currency: studio.currency }));
    }
    const currency = studio.currency;

    const onlineProvider = providerForOnlineMethod(dto.paymentMethod);
    if (
      dto.paymentMethod !== PaymentMethod.CASH &&
      dto.paymentMethod !== PaymentMethod.CREDIT_CARD_POS &&
      dto.paymentMethod !== PaymentMethod.BANK_TRANSFER &&
      !onlineProvider
    ) {
      throw new BadRequestException(apiError('apiErrors.payments.paymentMethodNotSupportedForSale'));
    }

    const hasPromoOrGiftCard = Boolean(dto.promoCode || dto.giftCardCode);

    // A resubmitted attempt returns the sale it already completed instead of charging again.
    if (dto.idempotencyKey) {
      const replay = await this.findCompletedSaleByKey(studioId, dto.idempotencyKey);
      if (replay) return replay;
    }
    const saleReference = dto.idempotencyKey ? `sell_${dto.idempotencyKey}` : `sell_${dto.memberId}_${pkgDef.id}_${randomUUID()}`;

    if (dto.paymentMethod === PaymentMethod.BANK_TRANSFER) {
      if (!dto.bankReference) {
        throw new BadRequestException(apiError('apiErrors.payments.bankTransferReferenceRequired'));
      }
      // A pending bank transfer only activates on later confirmation, so a
      // promo/gift-card redemption here could not be reserved atomically
      // with the sale; require an immediate payment method instead.
      if (hasPromoOrGiftCard) {
        throw new BadRequestException(apiError('apiErrors.payments.promoCodesGiftCardsCanOnly'));
      }
      const payment = await this.prisma.payment.create({
        data: {
          studioId,
          memberId: dto.memberId,
          branchId,
          amount: dto.paidAmount,
          currency,
          paymentMethod: dto.paymentMethod,
          paymentStatus: PaymentStatus.PENDING,
          providerReference: dto.bankReference,
          notes: dto.notes,
          metadata: { packageDefinitionId: pkgDef.id, startDate: dto.startDate ?? null },
        },
      });
      return { payment, memberPackage: null, pending: true };
    }

    const userId = await this.resolveUserId(studioId, dto.memberId);
    const pricing = hasPromoOrGiftCard
      ? await this.promotions.previewSalePricing(studioId, userId, pkgDef, new Prisma.Decimal(dto.paidAmount), {
          promoCode: dto.promoCode,
          giftCardCode: dto.giftCardCode,
          giftCardAmount: dto.giftCardAmount,
        })
      : null;
    const methodAmount = pricing ? pricing.methodAmount.toNumber() : dto.paidAmount;

    if (onlineProvider) {
      const provider = onlineProvider;
      // Checkout and charge descriptions are written in the business language.
      const saleText = serverT(await studioLocale(this.prisma, studioId));
      const checkout = await this.providers.get(provider).createCheckout({
        studioId,
        memberId: dto.memberId,
        amount: methodAmount,
        currency,
        installmentCount: dto.installmentCount,
        description: saleText('apiTexts.payments.packageSale', { name: pkgDef.name }),
        reference: saleReference,
        idempotencyKey: saleReference,
      });
      if (checkout.status === 'COMPLETED') {
        const { payment, memberPackage } = await this.completeSaleOrRefund(
          { studioId, memberId: dto.memberId, provider, paymentMethod: dto.paymentMethod, providerReference: checkout.providerReference, amount: methodAmount, currency },
          () => this.completeSale(studioId, { ...dto, currency }, pkgDef, branchId, provider, checkout.providerReference, userId),
        );
        await this.maybeAutoIssueInvoice(studioId, payment.id);
        return { payment, memberPackage, pending: false };
      }
      if (hasPromoOrGiftCard) {
        throw new BadRequestException(apiError('apiErrors.payments.promoCodesGiftCardsCanOnly'));
      }
      const payment = await this.prisma.payment.create({
        data: {
          studioId,
          memberId: dto.memberId,
          branchId,
          amount: dto.paidAmount,
          currency,
          paymentMethod: dto.paymentMethod,
          paymentStatus: PaymentStatus.PENDING,
          provider,
          providerReference: checkout.providerReference,
          notes: dto.notes,
          metadata: { packageDefinitionId: pkgDef.id, startDate: dto.startDate ?? null },
        },
      });
      return { payment, memberPackage: null, pending: true, checkoutUrl: checkout.checkoutUrl };
    }

    // CASH or CREDIT_CARD_POS: charged immediately. A card token means the
    // staff terminal captured a card-present charge; without one, the staff
    // is simply recording money already collected outside the platform.
    let providerRef: string | undefined;
    let provider: PaymentProvider | undefined;
    if (dto.card && dto.paymentMethod === PaymentMethod.CREDIT_CARD_POS && methodAmount > 0) {
      provider = PaymentProvider.MOCK;
      const charge = await this.providers.get(provider).chargeStoredCard({
        studioId,
        memberId: dto.memberId,
        cardToken: dto.card.providerCardToken,
        amount: methodAmount,
        currency,
        installmentCount: dto.installmentCount,
        description: serverT(await studioLocale(this.prisma, studioId))('apiTexts.payments.packageSale', { name: pkgDef.name }),
        reference: saleReference,
        idempotencyKey: saleReference,
      });
      if (!charge.success) {
        throw new BadRequestException(charge.failureMessage ?? apiError('apiErrors.payments.cardDeclined'));
      }
      providerRef = charge.providerReference;
    }

    const completeCashOrCard = () => this.completeSale(studioId, { ...dto, currency }, pkgDef, branchId, provider, providerRef, userId);
    const { payment, memberPackage } =
      provider && providerRef
        ? await this.completeSaleOrRefund(
            { studioId, memberId: dto.memberId, provider, paymentMethod: dto.paymentMethod, providerReference: providerRef, amount: methodAmount, currency },
            completeCashOrCard,
          )
        : await completeCashOrCard();
    await this.maybeAutoIssueInvoice(studioId, payment.id);
    return { payment, memberPackage, pending: false };
  }

  /** A completed sale carrying this client key, shaped like a fresh sale result; null when there is none. */
  private async findCompletedSaleByKey(studioId: string, idempotencyKey: string) {
    const payment = await this.prisma.payment.findFirst({
      where: {
        studioId,
        paymentStatus: { in: [PaymentStatus.COMPLETED, PaymentStatus.PENDING] },
        metadata: { path: ['idempotencyKey'], equals: idempotencyKey },
      },
    });
    if (!payment) return null;
    const memberPackage = payment.memberPackageId
      ? await this.prisma.memberPackage.findFirst({ where: { id: payment.memberPackageId, studioId } })
      : null;
    return { payment, memberPackage, pending: payment.paymentStatus === PaymentStatus.PENDING };
  }

  /**
   * Runs the sale transaction after money was captured at a provider. If the
   * transaction fails the charge must not stay without a sale: refund it, or
   * when the refund is impossible record a FAILED payment holding the provider
   * reference so staff can reconcile it by hand. The original error is rethrown.
   */
  private async completeSaleOrRefund<T>(charged: CapturedCharge, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (err) {
      await this.compensateCapturedCharge(charged, err);
      throw err;
    }
  }

  private async compensateCapturedCharge(charged: CapturedCharge, cause: unknown): Promise<void> {
    if (!(charged.amount > 0)) return;
    let refunded = false;
    try {
      const result = await this.providers.get(charged.provider).refund({
        studioId: charged.studioId,
        providerReference: charged.providerReference,
        amount: charged.amount,
        currency: charged.currency,
        reason: 'sale_failed',
      });
      refunded = result.success;
    } catch (refundErr) {
      this.logger.error(`Refund of captured charge ${charged.providerReference} threw: ${(refundErr as Error).message}`);
    }
    if (refunded) {
      this.logger.warn(`Sale failed after charge ${charged.providerReference}; the charge was refunded (${(cause as Error).message})`);
      return;
    }
    try {
      await this.prisma.payment.create({
        data: {
          studioId: charged.studioId,
          memberId: charged.memberId,
          amount: charged.amount,
          currency: charged.currency,
          paymentMethod: charged.paymentMethod,
          paymentStatus: PaymentStatus.FAILED,
          provider: charged.provider,
          providerReference: charged.providerReference,
          metadata: { saleFailedAfterCharge: true, refundRequired: true },
        },
      });
    } catch (recordErr) {
      this.logger.error(`Could not record the unrefunded charge ${charged.providerReference}: ${(recordErr as Error).message}`);
    }
    this.logger.error(`Sale failed after charge ${charged.providerReference} and the refund did not succeed; manual refund required`);
  }

  /** Member self-service checkout: always an online mock/real checkout, package activates once completed. */
  async memberCheckout(tenant: TenantContext, dto: MemberCheckoutInput) {
    if (!tenant.memberProfileId || dto.memberId !== tenant.memberProfileId) {
      throw new ForbiddenException(apiError('apiErrors.payments.canOnlyMakePurchasesYourself'));
    }
    const studioId = tenant.studioId;
    const pkgDef = await this.prisma.packageDefinition.findFirst({
      where: { id: dto.packageDefinitionId, studioId, isActive: true },
    });
    if (!pkgDef) throw new NotFoundException(apiError('apiErrors.common.packageDefinitionNotFound'));
    const member = await this.prisma.memberProfile.findFirstOrThrow({ where: { id: dto.memberId, studioId } });
    const userId = await this.resolveUserId(studioId, dto.memberId);
    const studio = await this.prisma.studio.findUniqueOrThrow({ where: { id: studioId }, select: { currency: true } });

    const hasPromoOrGiftCard = Boolean(dto.promoCode || dto.giftCardCode);
    const pricing = hasPromoOrGiftCard
      ? await this.promotions.previewSalePricing(studioId, userId, pkgDef, pkgDef.price, {
          promoCode: dto.promoCode,
          giftCardCode: dto.giftCardCode,
          giftCardAmount: dto.giftCardAmount,
        })
      : null;
    const methodAmount = pricing ? pricing.methodAmount.toNumber() : Number(pkgDef.price);

    const checkout = await this.providers.default.createCheckout({
      studioId,
      memberId: dto.memberId,
      amount: methodAmount,
      currency: studio.currency,
      installmentCount: dto.installmentCount,
      description: serverT(await studioLocale(this.prisma, studioId))('apiTexts.payments.packagePurchase', { name: pkgDef.name }),
      reference: `checkout_${dto.memberId}_${pkgDef.id}_${Date.now()}`,
    });

    const sellDto: SellPackageInput = {
      studioId,
      memberId: dto.memberId,
      packageDefinitionId: pkgDef.id,
      branchId: member.homeBranchId ?? undefined,
      paymentMethod: onlineCheckoutMethod(this.providers.default.name) as SellPackageInput['paymentMethod'],
      paidAmount: Number(pkgDef.price),
      currency: studio.currency,
      installmentCount: dto.installmentCount,
      promoCode: dto.promoCode,
      giftCardCode: dto.giftCardCode,
      giftCardAmount: dto.giftCardAmount,
    };

    if (checkout.status === 'COMPLETED') {
      const { payment, memberPackage } = await this.completeSaleOrRefund(
        {
          studioId,
          memberId: dto.memberId,
          provider: this.providers.default.name,
          paymentMethod: sellDto.paymentMethod,
          providerReference: checkout.providerReference,
          amount: methodAmount,
          currency: studio.currency,
        },
        () =>
          this.completeSale(
            studioId,
            sellDto,
            pkgDef,
            member.homeBranchId ?? null,
            this.providers.default.name,
            checkout.providerReference,
            userId,
          ),
      );
      await this.maybeAutoIssueInvoice(studioId, payment.id);
      return { payment, memberPackage, pending: false, checkoutUrl: checkout.checkoutUrl };
    }

    if (hasPromoOrGiftCard) {
      throw new BadRequestException(apiError('apiErrors.payments.promoCodesGiftCardsCanOnly'));
    }
    const payment = await this.prisma.payment.create({
      data: {
        studioId,
        memberId: dto.memberId,
        branchId: member.homeBranchId ?? null,
        amount: pkgDef.price,
        currency: studio.currency,
        paymentMethod: sellDto.paymentMethod,
        paymentStatus: PaymentStatus.PENDING,
        provider: this.providers.default.name,
        providerReference: checkout.providerReference,
        metadata: { packageDefinitionId: pkgDef.id, startDate: null },
      },
    });
    return { payment, memberPackage: null, pending: true, checkoutUrl: checkout.checkoutUrl };
  }

  async confirmBankTransfer(tenant: TenantContext, actorUserId: string, dto: ConfirmBankTransferInput) {
    const studioId = tenant.studioId;
    const payment = await this.prisma.payment.findFirst({ where: { id: dto.paymentId, studioId } });
    if (!payment) throw new NotFoundException(apiError('apiErrors.common.paymentNotFound'));
    if (payment.paymentMethod !== PaymentMethod.BANK_TRANSFER) {
      throw new BadRequestException(apiError('apiErrors.payments.onlyBankTransferPaymentsConfirmedWay'));
    }
    if (payment.branchId) assertBranchAccess(tenant, payment.branchId);

    const meta = (payment.metadata as { packageDefinitionId?: string; startDate?: string | null } | null) ?? null;
    // A package always belongs to a member; a guest payment never carries one.
    const memberId = payment.memberId;
    if (!meta?.packageDefinitionId || !memberId) {
      throw new BadRequestException(apiError('apiErrors.payments.noPackageInformationFoundPayment'));
    }
    const pkgDef = await this.prisma.packageDefinition.findFirst({
      where: { id: meta.packageDefinitionId, studioId },
    });
    if (!pkgDef) throw new NotFoundException(apiError('apiErrors.common.packageDefinitionNotFound'));

    const result = await this.prisma.$transaction(async (tx) => {
      // Conditional transition: a second confirm call cannot activate the package twice.
      const transitioned = await tx.payment.updateMany({
        where: { id: payment.id, studioId, paymentStatus: PaymentStatus.PENDING },
        data: { paymentStatus: PaymentStatus.COMPLETED },
      });
      if (transitioned.count === 0) {
        throw new ConflictException(apiError('apiErrors.payments.paymentAlreadyConfirmed'));
      }
      const memberPackage = await this.createMemberPackageTx(
        tx,
        studioId,
        memberId,
        pkgDef,
        meta.startDate ? new Date(meta.startDate) : new Date(),
      );
      await tx.payment.update({ where: { id: payment.id }, data: { memberPackageId: memberPackage.id } });
      await tx.auditLog.create({
        data: {
          studioId,
          userId: actorUserId,
          action: 'payments.bank_transfer.confirm',
          entityType: 'Payment',
          entityId: payment.id,
          metadata: { memberPackageId: memberPackage.id },
        },
      });
      return memberPackage;
    });

    await this.maybeAutoIssueInvoice(studioId, payment.id);
    return { paymentId: payment.id, memberPackage: result };
  }

  /**
   * Shared atomic creation of Payment + MemberPackage for every
   * immediate-payment path. Trial eligibility, promo code redemption and
   * gift card debit are all resolved and reserved here, inside the same
   * transaction as the package/payment rows, so none of them can be left
   * half-applied.
   */
  private async completeSale(
    studioId: string,
    dto: SellPackageInput,
    pkgDef: PackageDefinition,
    branchId: string | null,
    provider: PaymentProvider | undefined,
    providerReference: string | undefined,
    userId: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      if (pkgDef.isTrial) {
        await this.promotions.reserveTrialSlot(tx, studioId, userId, pkgDef);
      }

      const basePrice = new Prisma.Decimal(dto.paidAmount).toDecimalPlaces(2);
      let discountAmount = new Prisma.Decimal(0);
      let bonusUnits = 0;
      let promoCodeId: string | undefined;
      if (dto.promoCode) {
        const applied = await this.promotions.applyPromoCodeTx(tx, studioId, userId, dto.promoCode, pkgDef, basePrice);
        discountAmount = applied.discountAmount;
        bonusUnits = applied.bonusUnits;
        promoCodeId = applied.promoCode.id;
      }
      const amountAfterDiscount = basePrice.minus(discountAmount);

      let giftCardAmount = new Prisma.Decimal(0);
      let giftCardId: string | undefined;
      if (dto.giftCardCode) {
        const requested =
          dto.giftCardAmount !== undefined
            ? Prisma.Decimal.min(new Prisma.Decimal(dto.giftCardAmount), amountAfterDiscount)
            : amountAfterDiscount;
        const applied = await this.promotions.applyGiftCardTx(tx, studioId, dto.giftCardCode, requested);
        giftCardAmount = applied.amountApplied;
        giftCardId = applied.giftCardId;
      }

      const memberPackage = await this.createMemberPackageTx(
        tx,
        studioId,
        dto.memberId,
        pkgDef,
        dto.startDate ? new Date(dto.startDate) : new Date(),
        bonusUnits,
      );
      const payment = await tx.payment.create({
        data: {
          studioId,
          memberId: dto.memberId,
          memberPackageId: memberPackage.id,
          branchId,
          amount: amountAfterDiscount,
          currency: dto.currency,
          paymentMethod: dto.paymentMethod,
          paymentStatus: PaymentStatus.COMPLETED,
          provider,
          providerReference,
          installmentCount: dto.installmentCount,
          notes: dto.notes,
          promoCodeId,
          discountAmount,
          giftCardId,
          giftCardAmount,
          metadata: dto.idempotencyKey ? { idempotencyKey: dto.idempotencyKey } : undefined,
        },
      });

      if (promoCodeId) {
        await this.promotions.recordPromoRedemption(tx, studioId, userId, promoCodeId, payment.id, discountAmount);
      }
      if (giftCardId) {
        await this.promotions.recordGiftCardRedemption(tx, studioId, giftCardId, giftCardAmount, payment.id, userId);
      }
      if (pkgDef.isTrial) {
        await this.promotions.recordTrialRedemption(tx, studioId, userId, pkgDef.id, memberPackage.id);
      }

      return { payment, memberPackage };
    });
  }

  private async createMemberPackageTx(
    tx: Tx,
    studioId: string,
    memberId: string,
    pkgDef: PackageDefinition,
    startDate: Date,
    bonusUnits = 0,
  ) {
    const totalUnits = pkgDef.totalUnits !== null && bonusUnits > 0 ? pkgDef.totalUnits + bonusUnits : pkgDef.totalUnits;
    const endDate = new Date(startDate.getTime() + pkgDef.validityDays * 24 * 60 * 60 * 1000);
    return tx.memberPackage.create({
      data: {
        studioId,
        memberId,
        packageDefinitionId: pkgDef.id,
        entitlementKind: pkgDef.entitlementKind,
        totalUnits,
        usedUnits: 0,
        remainingUnits: totalUnits,
        status: 'ACTIVE',
        startDate,
        endDate,
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Listing and refunds
  // ---------------------------------------------------------------------------

  async listPayments(tenant: TenantContext, query: ListPaymentsQuery) {
    const scope = branchScope(tenant, query.branchId);
    const canViewContact = tenant.permissions.has('members.contact.view');
    const payments = await this.prisma.payment.findMany({
      where: {
        studioId: tenant.studioId,
        ...scope,
        ...(query.from || query.to
          ? { paidAt: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } }
          : {}),
        ...(query.paymentMethod ? { paymentMethod: query.paymentMethod } : {}),
        ...(query.paymentStatus ? { paymentStatus: query.paymentStatus } : {}),
      },
      include: {
        member: { select: { membership: { select: { user: { select: { firstName: true, lastName: true } } } } } },
        contact: { select: { firstName: true, lastName: true } },
      },
      orderBy: { paidAt: 'desc' },
    });
    // Guest and walk-in payments have no member: the contact's name when
    // known, otherwise both names are null and the screen shows a label.
    return payments.map(({ member, contact, ...payment }) => ({
      ...payment,
      memberDisplayName: member ? this.paymentMemberDisplayName(member.membership.user.firstName, member.membership.user.lastName, canViewContact) : null,
      contactDisplayName: !member && contact ? this.paymentMemberDisplayName(contact.firstName, contact.lastName, canViewContact) : null,
    }));
  }

  /**
   * First name plus the initial of the last name by default (see
   * `maskLeaderboardName`); the full last name only when the caller has
   * `members.contact.view`.
   */
  private paymentMemberDisplayName(firstName: string, lastName: string, canViewContact: boolean): string {
    if (canViewContact) {
      const full = `${firstName.trim()} ${lastName.trim()}`.trim();
      return full || firstName.trim();
    }
    return maskLeaderboardName(firstName, lastName);
  }

  async listMyPayments(tenant: TenantContext) {
    if (!tenant.memberProfileId) throw new ForbiddenException(apiError('apiErrors.common.actionOnlyMembers'));
    return this.prisma.payment.findMany({
      where: { studioId: tenant.studioId, memberId: tenant.memberProfileId },
      orderBy: { paidAt: 'desc' },
    });
  }

  async refundPayment(tenant: TenantContext, actorUserId: string, paymentId: string, dto: RefundPaymentInput) {
    const studioId = tenant.studioId;
    const payment = await this.prisma.payment.findFirst({ where: { id: paymentId, studioId } });
    if (!payment) throw new NotFoundException(apiError('apiErrors.common.paymentNotFound'));
    if (payment.branchId) assertBranchAccess(tenant, payment.branchId);
    if (payment.paymentStatus !== PaymentStatus.COMPLETED) {
      throw new BadRequestException(apiError('apiErrors.payments.onlyCompletedPaymentsCanRefunded'));
    }
    // G3c-2: a desk sale's payment is refunded from the sale, which also
    // returns the stock; refunding it here would leave the sale and stock out of step.
    if ((await this.prisma.sale.count({ where: { studioId, paymentId: payment.id } })) > 0) {
      throw new ConflictException(codedError('RETAIL_PAYMENT_IS_RETAIL', { statusCode: 409 }));
    }

    // Exact decimal arithmetic: money never goes through binary floats.
    const paid = new Prisma.Decimal(payment.amount);
    const alreadyRefunded = new Prisma.Decimal(payment.refundedAmount);
    const remaining = paid.minus(alreadyRefunded);
    const requested = dto.amount !== undefined ? new Prisma.Decimal(dto.amount).toDecimalPlaces(2) : remaining;
    if (requested.lte(0) || requested.gt(remaining)) {
      throw new BadRequestException(apiError('apiErrors.payments.refundAmountCannotExceedAmountPaid'));
    }
    const newRefunded = alreadyRefunded.plus(requested);
    const fullyRefunded = newRefunded.gte(paid);

    // A payment partly or fully paid with a gift card returns that portion
    // to the card, proportional to how much of the payment this refund
    // covers, capped by what has not already been returned to the card.
    const giftCardAmount = new Prisma.Decimal(payment.giftCardAmount);
    const giftCardAlreadyRefunded = new Prisma.Decimal(payment.giftCardRefunded);
    const giftCardRemaining = giftCardAmount.minus(giftCardAlreadyRefunded);
    let giftCardCredit = new Prisma.Decimal(0);
    if (giftCardAmount.gt(0) && paid.gt(0)) {
      giftCardCredit = requested.times(giftCardAmount).dividedBy(paid).toDecimalPlaces(2);
      if (giftCardCredit.gt(giftCardRemaining)) giftCardCredit = giftCardRemaining;
      if (giftCardCredit.gt(requested)) giftCardCredit = requested;
    }
    const newGiftCardRefunded = giftCardAlreadyRefunded.plus(giftCardCredit);

    // Reserve first: the conditional update on the snapshot means only one of
    // two concurrent refunds proceeds, so the provider is never asked to
    // refund more than was paid.
    const reserved = await this.prisma.payment.updateMany({
      where: {
        id: payment.id,
        studioId,
        refundedAmount: payment.refundedAmount,
        giftCardRefunded: payment.giftCardRefunded,
        paymentStatus: PaymentStatus.COMPLETED,
      },
      data: {
        refundedAmount: newRefunded,
        giftCardRefunded: newGiftCardRefunded,
        paymentStatus: fullyRefunded ? PaymentStatus.REFUNDED : PaymentStatus.COMPLETED,
      },
    });
    if (reserved.count === 0) {
      throw new ConflictException(apiError('apiErrors.payments.paymentUpdatedAnotherOperation'));
    }

    // Only the non-gift-card portion of this refund goes through the provider.
    const providerPortion = requested.minus(giftCardCredit);
    if (payment.providerReference && providerPortion.gt(0)) {
      const providerName = payment.provider ?? PaymentProvider.MOCK;
      let refundResult: { success: boolean; failureMessage?: string };
      try {
        refundResult = await this.providers.get(providerName).refund({
          studioId,
          providerReference: payment.providerReference,
          amount: providerPortion.toNumber(),
          currency: payment.currency,
          reason: dto.reason,
        });
      } catch (err) {
        refundResult = { success: false, failureMessage: err instanceof Error ? err.message : undefined };
      }
      if (!refundResult.success) {
        // Release the reservation made above; guarded so it only undoes this refund.
        await this.prisma.payment.updateMany({
          where: { id: payment.id, studioId, refundedAmount: newRefunded, giftCardRefunded: newGiftCardRefunded },
          data: { refundedAmount: alreadyRefunded, giftCardRefunded: giftCardAlreadyRefunded, paymentStatus: PaymentStatus.COMPLETED },
        });
        throw new BadRequestException(refundResult.failureMessage ?? apiError('apiErrors.payments.refundRejectedByProvider'));
      }
    }

    if (giftCardCredit.gt(0) && payment.giftCardId) {
      await this.prisma.$transaction((tx) =>
        this.promotions.refundToGiftCard(tx, studioId, payment.giftCardId as string, giftCardCredit, payment.id, actorUserId),
      );
    }

    // G3c-1: an event ticket's registration mirrors what its payment has refunded.
    await this.prisma.eventRegistration.updateMany({ where: { studioId, paymentId: payment.id }, data: { refundedAmount: newRefunded } });

    await this.prisma.auditLog.create({
      data: {
        studioId,
        userId: actorUserId,
        action: 'payments.refund',
        entityType: 'Payment',
        entityId: payment.id,
        metadata: { amount: requested.toFixed(2), giftCardCredit: giftCardCredit.toFixed(2), reason: dto.reason ?? null, fullyRefunded },
      },
    });

    // Full refund cancels the e-invoice (if any was issued); a partial
    // refund is only recorded here and never touches the invoice - see
    // docs/INVOICING.md for the reconciliation note on partial refunds.
    if (fullyRefunded) {
      try {
        await this.invoicing.cancelForRefund(tenant, actorUserId, payment.id, serverT(await studioLocale(this.prisma, tenant.studioId))('apiTexts.payments.refundReason', { reason: dto.reason ?? '' }));
      } catch (err) {
        this.logger.warn(`Invoice cancel-on-refund failed for payment ${payment.id}: ${err instanceof Error ? err.message : err}`);
      }
    }

    await this.webhooks.emit(studioId, 'payment.refunded', {
      paymentId: payment.id,
      memberId: payment.memberId,
      contactId: payment.contactId,
      amount: requested.toFixed(2),
      currency: payment.currency,
      fullyRefunded,
    });

    return this.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
  }

  // ---------------------------------------------------------------------------
  // Stored cards
  // ---------------------------------------------------------------------------

  async addStoredCardSelf(tenant: TenantContext, dto: CardTokenInput) {
    if (!tenant.memberProfileId) throw new ForbiddenException(apiError('apiErrors.common.actionOnlyMembers'));
    return this.prisma.storedCard.create({
      data: {
        studioId: tenant.studioId,
        memberId: tenant.memberProfileId,
        provider: this.providers.default.name,
        providerCardToken: dto.providerCardToken,
        last4: dto.last4,
        brand: dto.brand,
        expMonth: dto.expMonth,
        expYear: dto.expYear,
      },
    });
  }

  async listMyStoredCards(tenant: TenantContext) {
    if (!tenant.memberProfileId) throw new ForbiddenException(apiError('apiErrors.common.actionOnlyMembers'));
    return this.prisma.storedCard.findMany({
      where: { studioId: tenant.studioId, memberId: tenant.memberProfileId },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ---------------------------------------------------------------------------
  // Subscriptions
  // ---------------------------------------------------------------------------

  async createSubscription(tenant: TenantContext, dto: CreateSubscriptionInput) {
    const studioId = tenant.studioId;
    const [pkgDef, member, card] = await Promise.all([
      this.prisma.packageDefinition.findFirst({ where: { id: dto.packageDefinitionId, studioId, isActive: true } }),
      this.prisma.memberProfile.findFirst({ where: { id: dto.memberId, studioId } }),
      this.prisma.storedCard.findFirst({ where: { id: dto.storedCardId, studioId, memberId: dto.memberId } }),
    ]);
    if (!pkgDef) throw new NotFoundException(apiError('apiErrors.common.packageDefinitionNotFound'));
    if (!member) throw new NotFoundException(apiError('apiErrors.common.memberNotFound'));
    if (!card) throw new NotFoundException(apiError('apiErrors.payments.savedCardNotFound'));

    const start = dto.startDate ? new Date(dto.startDate) : new Date();
    const end = new Date(start.getTime() + pkgDef.validityDays * 24 * 60 * 60 * 1000);

    return this.prisma.memberSubscription.create({
      data: {
        studioId,
        memberId: dto.memberId,
        packageDefinitionId: pkgDef.id,
        storedCardId: card.id,
        status: 'ACTIVE',
        currentPeriodStart: start,
        currentPeriodEnd: end,
        nextChargeAt: end,
        installmentCount: dto.installmentCount,
      },
    });
  }

  async cancelSubscriptionSelf(tenant: TenantContext, subscriptionId: string, dto: CancelSubscriptionInput) {
    if (!tenant.memberProfileId) throw new ForbiddenException(apiError('apiErrors.common.actionOnlyMembers'));
    return this.cancelSubscription(tenant, subscriptionId, dto, tenant.memberProfileId);
  }

  async cancelSubscription(tenant: TenantContext, subscriptionId: string, dto: CancelSubscriptionInput, requireMemberId?: string) {
    const sub = await this.prisma.memberSubscription.findFirst({ where: { id: subscriptionId, studioId: tenant.studioId } });
    if (!sub) throw new NotFoundException(apiError('apiErrors.payments.subscriptionNotFound'));
    if (requireMemberId && sub.memberId !== requireMemberId) {
      throw new ForbiddenException(apiError('apiErrors.payments.canOnlyCancelOwnSubscription'));
    }
    if (dto.atPeriodEnd) {
      return this.prisma.memberSubscription.update({ where: { id: sub.id }, data: { cancelAtPeriodEnd: true } });
    }
    return this.prisma.memberSubscription.update({
      where: { id: sub.id },
      data: { status: 'CANCELLED', cancelAtPeriodEnd: true },
    });
  }

  async pauseSubscription(tenant: TenantContext, subscriptionId: string, _dto: PauseSubscriptionInput) {
    const sub = await this.prisma.memberSubscription.findFirst({ where: { id: subscriptionId, studioId: tenant.studioId } });
    if (!sub) throw new NotFoundException(apiError('apiErrors.payments.subscriptionNotFound'));
    if (sub.status === 'CANCELLED') throw new BadRequestException(apiError('apiErrors.payments.cancelledSubscriptionCannotPaused'));
    return this.prisma.memberSubscription.update({ where: { id: sub.id }, data: { status: 'PAUSED' } });
  }

  async resumeSubscription(tenant: TenantContext, subscriptionId: string) {
    const sub = await this.prisma.memberSubscription.findFirst({ where: { id: subscriptionId, studioId: tenant.studioId } });
    if (!sub) throw new NotFoundException(apiError('apiErrors.payments.subscriptionNotFound'));
    if (sub.status !== 'PAUSED') throw new BadRequestException(apiError('apiErrors.payments.onlyPausedSubscriptionsCanResumed'));
    const now = new Date();
    return this.prisma.memberSubscription.update({
      where: { id: sub.id },
      data: { status: 'ACTIVE', nextChargeAt: sub.nextChargeAt < now ? now : sub.nextChargeAt },
    });
  }

  async listMySubscriptions(tenant: TenantContext) {
    if (!tenant.memberProfileId) throw new ForbiddenException(apiError('apiErrors.common.actionOnlyMembers'));
    return this.prisma.memberSubscription.findMany({
      where: { studioId: tenant.studioId, memberId: tenant.memberProfileId },
      include: { packageDefinition: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ---------------------------------------------------------------------------
  // Webhook
  // ---------------------------------------------------------------------------

  async handleWebhook(providerName: string, headers: Record<string, string | string[] | undefined>, rawBody: string) {
    const adapter = this.providers.byName(providerName);
    if (!adapter) throw new NotFoundException(apiError('apiErrors.common.unknownProvider'));
    const verification = adapter.verifyWebhook(headers, rawBody);
    if (!verification.valid || !verification.providerReference) {
      throw new BadRequestException(apiError('apiErrors.payments.invalidWebhookSignature'));
    }

    const payment = await this.prisma.payment.findFirst({
      where: { provider: adapter.name, providerReference: verification.providerReference },
    });
    if (!payment) {
      // Not a tenant payment: platform billing (G5c-1) may own the reference.
      const routed = await this.webhookRouter?.route(adapter.name, verification);
      if (routed) return routed;
      // Unknown reference: nothing to reconcile. Acknowledged so the
      // provider does not keep retrying a webhook we will never match.
      return { handled: false };
    }

    // Idempotent: a payment already resolved (completed or failed-and-final)
    // is left untouched no matter how many times the provider redelivers it.
    if (payment.paymentStatus !== PaymentStatus.PENDING) {
      return { handled: true, alreadyProcessed: true };
    }

    // A verified event for a different amount than we asked for never activates anything.
    if (
      (verification.amount !== undefined &&
        !new Prisma.Decimal(verification.amount).toDecimalPlaces(2).equals(new Prisma.Decimal(payment.amount))) ||
      (verification.currency !== undefined && verification.currency.toUpperCase() !== payment.currency.toUpperCase())
    ) {
      this.logger.warn(`Webhook amount mismatch for payment ${payment.id}`);
      return { handled: false, reason: 'AMOUNT_MISMATCH' };
    }

    if (verification.eventType === 'CHECKOUT_COMPLETED' || verification.eventType === 'CHARGE_SUCCEEDED') {
      const meta = (payment.metadata as { packageDefinitionId?: string; startDate?: string | null } | null) ?? null;
      if (!meta?.packageDefinitionId) {
        const completed = await this.prisma.payment.updateMany({
          where: { id: payment.id, paymentStatus: PaymentStatus.PENDING },
          data: { paymentStatus: PaymentStatus.COMPLETED },
        });
        // G3c-1: an event ticket checkout confirms its held registration.
        if (completed.count === 1) await this.eventSeats?.onPaymentCompleted(payment.id);
        await this.maybeAutoIssueInvoice(payment.studioId, payment.id);
        return { handled: true };
      }
      const pkgDef = await this.prisma.packageDefinition.findFirst({
        where: { id: meta.packageDefinitionId, studioId: payment.studioId },
      });
      // A package payment always has a member; a guest payment never carries a package.
      const memberId = payment.memberId;
      if (!pkgDef || !memberId) return { handled: false };

      await this.prisma.$transaction(async (tx) => {
        const transitioned = await tx.payment.updateMany({
          where: { id: payment.id, paymentStatus: PaymentStatus.PENDING },
          data: { paymentStatus: PaymentStatus.COMPLETED },
        });
        if (transitioned.count === 0) return;
        const memberPackage = await this.createMemberPackageTx(
          tx,
          payment.studioId,
          memberId,
          pkgDef,
          meta.startDate ? new Date(meta.startDate) : new Date(),
        );
        await tx.payment.update({ where: { id: payment.id }, data: { memberPackageId: memberPackage.id } });
      });
      await this.maybeAutoIssueInvoice(payment.studioId, payment.id);
      return { handled: true };
    }

    if (verification.eventType === 'CHARGE_FAILED') {
      await this.prisma.payment.updateMany({
        where: { id: payment.id, paymentStatus: PaymentStatus.PENDING },
        data: { paymentStatus: PaymentStatus.FAILED },
      });
      await this.eventSeats?.onPaymentFailed(payment.id);
      return { handled: true };
    }

    return { handled: false };
  }
}
