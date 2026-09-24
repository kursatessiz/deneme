import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PaymentProviderRegistry } from './providers/payment-provider.registry';
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
import { Prisma, PaymentMethod, PaymentProvider, PaymentStatus, PackageDefinition } from '@platform/database';
import { assertBranchAccess, branchScope } from '../branches/branch-access';

type Tx = Prisma.TransactionClient;

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
    private providers: PaymentProviderRegistry,
  ) {}

  // ---------------------------------------------------------------------------
  // Selling a package with an immediate or pending payment
  // ---------------------------------------------------------------------------

  async sellPackage(tenant: TenantContext, dto: SellPackageInput) {
    const studioId = tenant.studioId;
    const [pkgDef, member] = await Promise.all([
      this.prisma.packageDefinition.findFirst({ where: { id: dto.packageDefinitionId, studioId } }),
      this.prisma.memberProfile.findFirst({ where: { id: dto.memberId, studioId } }),
    ]);
    if (!pkgDef) throw new NotFoundException('Paket tanımı bulunamadı');
    if (!member) throw new NotFoundException('Üye bulunamadı');

    const branchId = dto.branchId ?? member.homeBranchId ?? null;
    if (branchId) assertBranchAccess(tenant, branchId);
    else if (tenant.branchIds !== null) {
      throw new BadRequestException('Şube seçiniz');
    }

    if (dto.paymentMethod === PaymentMethod.BANK_TRANSFER) {
      if (!dto.bankReference) {
        throw new BadRequestException('Havale/EFT referansı zorunludur');
      }
      const payment = await this.prisma.payment.create({
        data: {
          studioId,
          memberId: dto.memberId,
          branchId,
          amount: dto.paidAmount,
          currency: dto.currency,
          paymentMethod: dto.paymentMethod,
          paymentStatus: PaymentStatus.PENDING,
          providerReference: dto.bankReference,
          notes: dto.notes,
          metadata: { packageDefinitionId: pkgDef.id, startDate: dto.startDate ?? null },
        },
      });
      return { payment, memberPackage: null, pending: true };
    }

    if (dto.paymentMethod === PaymentMethod.ONLINE_IYZICO || dto.paymentMethod === PaymentMethod.ONLINE_PAYTR) {
      const provider = dto.paymentMethod === PaymentMethod.ONLINE_IYZICO ? PaymentProvider.IYZICO : PaymentProvider.PAYTR;
      const checkout = await this.providers.get(provider).createCheckout({
        studioId,
        memberId: dto.memberId,
        amount: dto.paidAmount,
        currency: dto.currency,
        installmentCount: dto.installmentCount,
        description: `${pkgDef.name} paket satışı`,
        reference: `sell_${dto.memberId}_${pkgDef.id}_${Date.now()}`,
      });
      if (checkout.status === 'COMPLETED') {
        const { payment, memberPackage } = await this.completeSale(studioId, dto, pkgDef, branchId, provider, checkout.providerReference);
        return { payment, memberPackage, pending: false };
      }
      const payment = await this.prisma.payment.create({
        data: {
          studioId,
          memberId: dto.memberId,
          branchId,
          amount: dto.paidAmount,
          currency: dto.currency,
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
    if (dto.card && dto.paymentMethod === PaymentMethod.CREDIT_CARD_POS) {
      provider = PaymentProvider.MOCK;
      const charge = await this.providers.get(provider).chargeStoredCard({
        studioId,
        memberId: dto.memberId,
        cardToken: dto.card.providerCardToken,
        amount: dto.paidAmount,
        currency: dto.currency,
        installmentCount: dto.installmentCount,
        description: `${pkgDef.name} paket satışı`,
        reference: `sell_${dto.memberId}_${pkgDef.id}_${Date.now()}`,
      });
      if (!charge.success) {
        throw new BadRequestException(charge.failureMessage ?? 'Kart reddedildi');
      }
      providerRef = charge.providerReference;
    }

    const { payment, memberPackage } = await this.completeSale(studioId, dto, pkgDef, branchId, provider, providerRef);
    return { payment, memberPackage, pending: false };
  }

  /** Member self-service checkout: always an online mock/real checkout, package activates once completed. */
  async memberCheckout(tenant: TenantContext, dto: MemberCheckoutInput) {
    if (!tenant.memberProfileId || dto.memberId !== tenant.memberProfileId) {
      throw new ForbiddenException('Yalnızca kendi adınıza satın alma yapabilirsiniz');
    }
    const studioId = tenant.studioId;
    const pkgDef = await this.prisma.packageDefinition.findFirst({
      where: { id: dto.packageDefinitionId, studioId, isActive: true },
    });
    if (!pkgDef) throw new NotFoundException('Paket tanımı bulunamadı');
    const member = await this.prisma.memberProfile.findFirstOrThrow({ where: { id: dto.memberId, studioId } });

    const checkout = await this.providers.default.createCheckout({
      studioId,
      memberId: dto.memberId,
      amount: Number(pkgDef.price),
      currency: 'TRY',
      installmentCount: dto.installmentCount,
      description: `${pkgDef.name} paket satın alma`,
      reference: `checkout_${dto.memberId}_${pkgDef.id}_${Date.now()}`,
    });

    const sellDto: SellPackageInput = {
      studioId,
      memberId: dto.memberId,
      packageDefinitionId: pkgDef.id,
      branchId: member.homeBranchId ?? undefined,
      paymentMethod: (this.providers.default.name === PaymentProvider.PAYTR ? 'ONLINE_PAYTR' : 'ONLINE_IYZICO') as SellPackageInput['paymentMethod'],
      paidAmount: Number(pkgDef.price),
      currency: 'TRY',
      installmentCount: dto.installmentCount,
    };

    if (checkout.status === 'COMPLETED') {
      const { payment, memberPackage } = await this.completeSale(
        studioId,
        sellDto,
        pkgDef,
        member.homeBranchId ?? null,
        this.providers.default.name,
        checkout.providerReference,
      );
      return { payment, memberPackage, pending: false, checkoutUrl: checkout.checkoutUrl };
    }

    const payment = await this.prisma.payment.create({
      data: {
        studioId,
        memberId: dto.memberId,
        branchId: member.homeBranchId ?? null,
        amount: pkgDef.price,
        currency: 'TRY',
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
    if (!payment) throw new NotFoundException('Ödeme bulunamadı');
    if (payment.paymentMethod !== PaymentMethod.BANK_TRANSFER) {
      throw new BadRequestException('Yalnızca havale/EFT ödemeleri bu şekilde onaylanır');
    }
    if (payment.branchId) assertBranchAccess(tenant, payment.branchId);

    const meta = (payment.metadata as { packageDefinitionId?: string; startDate?: string | null } | null) ?? null;
    if (!meta?.packageDefinitionId) {
      throw new BadRequestException('Ödemede paket bilgisi bulunamadı');
    }
    const pkgDef = await this.prisma.packageDefinition.findFirst({
      where: { id: meta.packageDefinitionId, studioId },
    });
    if (!pkgDef) throw new NotFoundException('Paket tanımı bulunamadı');

    const result = await this.prisma.$transaction(async (tx) => {
      // Conditional transition: a second confirm call cannot activate the package twice.
      const transitioned = await tx.payment.updateMany({
        where: { id: payment.id, studioId, paymentStatus: PaymentStatus.PENDING },
        data: { paymentStatus: PaymentStatus.COMPLETED },
      });
      if (transitioned.count === 0) {
        throw new ConflictException('Bu ödeme zaten onaylanmış');
      }
      const memberPackage = await this.createMemberPackageTx(
        tx,
        studioId,
        payment.memberId,
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

    return { paymentId: payment.id, memberPackage: result };
  }

  /** Shared atomic creation of Payment + MemberPackage for every immediate-payment path. */
  private async completeSale(
    studioId: string,
    dto: SellPackageInput,
    pkgDef: PackageDefinition,
    branchId: string | null,
    provider: PaymentProvider | undefined,
    providerReference: string | undefined,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const memberPackage = await this.createMemberPackageTx(
        tx,
        studioId,
        dto.memberId,
        pkgDef,
        dto.startDate ? new Date(dto.startDate) : new Date(),
      );
      const payment = await tx.payment.create({
        data: {
          studioId,
          memberId: dto.memberId,
          memberPackageId: memberPackage.id,
          branchId,
          amount: dto.paidAmount,
          currency: dto.currency,
          paymentMethod: dto.paymentMethod,
          paymentStatus: PaymentStatus.COMPLETED,
          provider,
          providerReference,
          installmentCount: dto.installmentCount,
          notes: dto.notes,
        },
      });
      return { payment, memberPackage };
    });
  }

  private async createMemberPackageTx(tx: Tx, studioId: string, memberId: string, pkgDef: PackageDefinition, startDate: Date) {
    const endDate = new Date(startDate.getTime() + pkgDef.validityDays * 24 * 60 * 60 * 1000);
    return tx.memberPackage.create({
      data: {
        studioId,
        memberId,
        packageDefinitionId: pkgDef.id,
        entitlementKind: pkgDef.entitlementKind,
        totalUnits: pkgDef.totalUnits,
        usedUnits: 0,
        remainingUnits: pkgDef.totalUnits,
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
    return this.prisma.payment.findMany({
      where: {
        studioId: tenant.studioId,
        ...scope,
        ...(query.from || query.to
          ? { paidAt: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } }
          : {}),
        ...(query.paymentMethod ? { paymentMethod: query.paymentMethod } : {}),
        ...(query.paymentStatus ? { paymentStatus: query.paymentStatus } : {}),
      },
      orderBy: { paidAt: 'desc' },
    });
  }

  async listMyPayments(tenant: TenantContext) {
    if (!tenant.memberProfileId) throw new ForbiddenException('Bu işlem yalnızca üyeler içindir');
    return this.prisma.payment.findMany({
      where: { studioId: tenant.studioId, memberId: tenant.memberProfileId },
      orderBy: { paidAt: 'desc' },
    });
  }

  async refundPayment(tenant: TenantContext, actorUserId: string, paymentId: string, dto: RefundPaymentInput) {
    const studioId = tenant.studioId;
    const payment = await this.prisma.payment.findFirst({ where: { id: paymentId, studioId } });
    if (!payment) throw new NotFoundException('Ödeme bulunamadı');
    if (payment.branchId) assertBranchAccess(tenant, payment.branchId);
    if (payment.paymentStatus !== PaymentStatus.COMPLETED) {
      throw new BadRequestException('Yalnızca tamamlanmış ödemeler iade edilebilir');
    }

    // Exact decimal arithmetic: money never goes through binary floats.
    const paid = new Prisma.Decimal(payment.amount);
    const alreadyRefunded = new Prisma.Decimal(payment.refundedAmount);
    const remaining = paid.minus(alreadyRefunded);
    const requested = dto.amount !== undefined ? new Prisma.Decimal(dto.amount).toDecimalPlaces(2) : remaining;
    if (requested.lte(0) || requested.gt(remaining)) {
      throw new BadRequestException('İade tutarı ödenen ve henüz iade edilmemiş tutarı aşamaz');
    }
    const newRefunded = alreadyRefunded.plus(requested);
    const fullyRefunded = newRefunded.gte(paid);

    // Reserve first: the conditional update on the snapshot means only one of
    // two concurrent refunds proceeds, so the provider is never asked to
    // refund more than was paid.
    const reserved = await this.prisma.payment.updateMany({
      where: { id: payment.id, studioId, refundedAmount: payment.refundedAmount, paymentStatus: PaymentStatus.COMPLETED },
      data: {
        refundedAmount: newRefunded,
        paymentStatus: fullyRefunded ? PaymentStatus.REFUNDED : PaymentStatus.COMPLETED,
      },
    });
    if (reserved.count === 0) {
      throw new ConflictException('Bu ödeme başka bir işlemde güncellendi, tekrar deneyin');
    }

    if (payment.providerReference) {
      const providerName = payment.provider ?? PaymentProvider.MOCK;
      let refundResult: { success: boolean; failureMessage?: string };
      try {
        refundResult = await this.providers.get(providerName).refund({
          studioId,
          providerReference: payment.providerReference,
          amount: requested.toNumber(),
          currency: payment.currency,
          reason: dto.reason,
        });
      } catch (err) {
        refundResult = { success: false, failureMessage: err instanceof Error ? err.message : undefined };
      }
      if (!refundResult.success) {
        // Release the reservation made above; guarded so it only undoes this refund.
        await this.prisma.payment.updateMany({
          where: { id: payment.id, studioId, refundedAmount: newRefunded },
          data: { refundedAmount: alreadyRefunded, paymentStatus: PaymentStatus.COMPLETED },
        });
        throw new BadRequestException(refundResult.failureMessage ?? 'İade sağlayıcı tarafından reddedildi');
      }
    }

    await this.prisma.auditLog.create({
      data: {
        studioId,
        userId: actorUserId,
        action: 'payments.refund',
        entityType: 'Payment',
        entityId: payment.id,
        metadata: { amount: requested.toFixed(2), reason: dto.reason ?? null },
      },
    });

    return this.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
  }

  // ---------------------------------------------------------------------------
  // Stored cards
  // ---------------------------------------------------------------------------

  async addStoredCardSelf(tenant: TenantContext, dto: CardTokenInput) {
    if (!tenant.memberProfileId) throw new ForbiddenException('Bu işlem yalnızca üyeler içindir');
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
    if (!tenant.memberProfileId) throw new ForbiddenException('Bu işlem yalnızca üyeler içindir');
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
    if (!pkgDef) throw new NotFoundException('Paket tanımı bulunamadı');
    if (!member) throw new NotFoundException('Üye bulunamadı');
    if (!card) throw new NotFoundException('Kayıtlı kart bulunamadı');

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
    if (!tenant.memberProfileId) throw new ForbiddenException('Bu işlem yalnızca üyeler içindir');
    return this.cancelSubscription(tenant, subscriptionId, dto, tenant.memberProfileId);
  }

  async cancelSubscription(tenant: TenantContext, subscriptionId: string, dto: CancelSubscriptionInput, requireMemberId?: string) {
    const sub = await this.prisma.memberSubscription.findFirst({ where: { id: subscriptionId, studioId: tenant.studioId } });
    if (!sub) throw new NotFoundException('Abonelik bulunamadı');
    if (requireMemberId && sub.memberId !== requireMemberId) {
      throw new ForbiddenException('Yalnızca kendi aboneliğinizi iptal edebilirsiniz');
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
    if (!sub) throw new NotFoundException('Abonelik bulunamadı');
    if (sub.status === 'CANCELLED') throw new BadRequestException('İptal edilmiş abonelik durdurulamaz');
    return this.prisma.memberSubscription.update({ where: { id: sub.id }, data: { status: 'PAUSED' } });
  }

  async resumeSubscription(tenant: TenantContext, subscriptionId: string) {
    const sub = await this.prisma.memberSubscription.findFirst({ where: { id: subscriptionId, studioId: tenant.studioId } });
    if (!sub) throw new NotFoundException('Abonelik bulunamadı');
    if (sub.status !== 'PAUSED') throw new BadRequestException('Yalnızca durdurulmuş abonelikler devam ettirilebilir');
    const now = new Date();
    return this.prisma.memberSubscription.update({
      where: { id: sub.id },
      data: { status: 'ACTIVE', nextChargeAt: sub.nextChargeAt < now ? now : sub.nextChargeAt },
    });
  }

  async listMySubscriptions(tenant: TenantContext) {
    if (!tenant.memberProfileId) throw new ForbiddenException('Bu işlem yalnızca üyeler içindir');
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
    if (!adapter) throw new NotFoundException('Bilinmeyen sağlayıcı');
    const verification = adapter.verifyWebhook(headers, rawBody);
    if (!verification.valid || !verification.providerReference) {
      throw new BadRequestException('Geçersiz webhook imzası');
    }

    const payment = await this.prisma.payment.findFirst({
      where: { provider: adapter.name, providerReference: verification.providerReference },
    });
    if (!payment) {
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
      verification.amount !== undefined &&
      !new Prisma.Decimal(verification.amount).toDecimalPlaces(2).equals(new Prisma.Decimal(payment.amount))
    ) {
      this.logger.warn(`Webhook amount mismatch for payment ${payment.id}`);
      return { handled: false, reason: 'AMOUNT_MISMATCH' };
    }

    if (verification.eventType === 'CHECKOUT_COMPLETED' || verification.eventType === 'CHARGE_SUCCEEDED') {
      const meta = (payment.metadata as { packageDefinitionId?: string; startDate?: string | null } | null) ?? null;
      if (!meta?.packageDefinitionId) {
        await this.prisma.payment.updateMany({
          where: { id: payment.id, paymentStatus: PaymentStatus.PENDING },
          data: { paymentStatus: PaymentStatus.COMPLETED },
        });
        return { handled: true };
      }
      const pkgDef = await this.prisma.packageDefinition.findFirst({
        where: { id: meta.packageDefinitionId, studioId: payment.studioId },
      });
      if (!pkgDef) return { handled: false };

      await this.prisma.$transaction(async (tx) => {
        const transitioned = await tx.payment.updateMany({
          where: { id: payment.id, paymentStatus: PaymentStatus.PENDING },
          data: { paymentStatus: PaymentStatus.COMPLETED },
        });
        if (transitioned.count === 0) return;
        const memberPackage = await this.createMemberPackageTx(
          tx,
          payment.studioId,
          payment.memberId,
          pkgDef,
          meta.startDate ? new Date(meta.startDate) : new Date(),
        );
        await tx.payment.update({ where: { id: payment.id }, data: { memberPackageId: memberPackage.id } });
      });
      return { handled: true };
    }

    if (verification.eventType === 'CHARGE_FAILED') {
      await this.prisma.payment.updateMany({
        where: { id: payment.id, paymentStatus: PaymentStatus.PENDING },
        data: { paymentStatus: PaymentStatus.FAILED },
      });
      return { handled: true };
    }

    return { handled: false };
  }
}
