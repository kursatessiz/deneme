import { randomUUID } from 'crypto';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  GiftCardStatus,
  GiftCardTransactionType,
  PackageDefinition,
  Prisma,
  PromoCode,
  PromoCodeKind,
  RedemptionCounterSubject,
} from '@platform/database';
import type {
  AdjustGiftCardInput,
  CreatePromoCodeInput,
  IssueGiftCardInput,
  UpdatePromoCodeInput,
} from '@platform/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { TenantContext } from '../auth/tenant-context';
import { assertBranchAccess } from '../branches/branch-access';
import { generateGiftCardCode, hashGiftCardCode, last4OfGiftCardCode } from './gift-card-code';
import { computePromoDiscount } from './promo-pricing';

type Tx = Prisma.TransactionClient;

export interface PromoApplication {
  promoCode: PromoCode;
  discountAmount: Prisma.Decimal;
  bonusUnits: number;
}

export interface GiftCardApplication {
  giftCardId: string;
  amountApplied: Prisma.Decimal;
}

@Injectable()
export class PromotionsService {
  constructor(private prisma: PrismaService) {}

  // ---------------------------------------------------------------------------
  // Generic race-safe per-user redemption counter (trial offers, promo per-user limit)
  // ---------------------------------------------------------------------------

  /**
   * Atomically checks and reserves one redemption slot for (subject, subjectId,
   * userId) against `limit`. A single INSERT ... ON CONFLICT statement: the
   * first redemption always inserts the counter row at 1, and every later
   * one only increments it while still under the limit. This has to be one
   * statement rather than a JS-level "try update, else create" retry loop,
   * because a unique-constraint violation caught in application code still
   * leaves the surrounding Postgres transaction aborted for every query
   * after it.
   */
  private async reserveCounterSlot(
    tx: Tx,
    params: { studioId: string; subject: RedemptionCounterSubject; subjectId: string; userId: string; limit: number },
  ): Promise<boolean> {
    const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
      INSERT INTO "redemption_counters" ("id", "studio_id", "subject", "subject_id", "user_id", "count", "updated_at")
      VALUES (${randomUUID()}::uuid, ${params.studioId}::uuid, ${params.subject}::"RedemptionCounterSubject", ${params.subjectId}::uuid, ${params.userId}::uuid, 1, now())
      ON CONFLICT ("studio_id", "subject", "subject_id", "user_id")
      DO UPDATE SET "count" = "redemption_counters"."count" + 1, "updated_at" = now()
      WHERE "redemption_counters"."count" < ${params.limit}
      RETURNING "id"
    `);
    return rows.length > 0;
  }

  // ---------------------------------------------------------------------------
  // Trial offers
  // ---------------------------------------------------------------------------

  /** Public: a studio's active trial offers by slug, no auth, minimal fields. */
  async listPublicTrialOffers(slug: string) {
    const studio = await this.prisma.studio.findFirst({ where: { slug, isActive: true } });
    if (!studio) throw new NotFoundException('İşletme bulunamadı');
    const offers = await this.prisma.packageDefinition.findMany({
      where: { studioId: studio.id, isTrial: true, isActive: true },
      orderBy: { price: 'asc' },
    });
    return offers.map((o) => ({
      packageDefinitionId: o.id,
      name: o.name,
      price: o.price.toFixed(2),
      currency: 'TRY',
      totalUnits: o.totalUnits,
      validityDays: o.validityDays,
    }));
  }

  /**
   * Reserves a trial slot for this user + trial package inside the sale's
   * transaction. Throws if the studio-wide per-user limit on this trial
   * package is already used up. Call `recordTrialRedemption` afterwards,
   * once the MemberPackage exists, to keep the audit trail.
   */
  async reserveTrialSlot(tx: Tx, studioId: string, userId: string, pkgDef: PackageDefinition): Promise<void> {
    if (!pkgDef.isTrial) return;
    const ok = await this.reserveCounterSlot(tx, {
      studioId,
      subject: RedemptionCounterSubject.TRIAL_PACKAGE,
      subjectId: pkgDef.id,
      userId,
      limit: pkgDef.trialLimitPerUser,
    });
    if (!ok) {
      throw new ConflictException('Bu deneme seansı hakkınız bu işletmede daha önce kullanılmış');
    }
  }

  async recordTrialRedemption(tx: Tx, studioId: string, userId: string, packageDefinitionId: string, memberPackageId: string) {
    await tx.trialRedemption.create({ data: { studioId, userId, packageDefinitionId, memberPackageId } });
  }

  // ---------------------------------------------------------------------------
  // Promo codes: staff CRUD
  // ---------------------------------------------------------------------------

  async createPromoCode(tenant: TenantContext, actorUserId: string, dto: CreatePromoCodeInput) {
    const code = dto.code.trim().toUpperCase();
    try {
      return await this.prisma.promoCode.create({
        data: {
          studioId: tenant.studioId,
          code,
          kind: dto.kind,
          value: dto.value,
          validFrom: dto.validFrom ? new Date(dto.validFrom) : null,
          validTo: dto.validTo ? new Date(dto.validTo) : null,
          maxRedemptions: dto.maxRedemptions,
          perUserLimit: dto.perUserLimit,
          minAmount: dto.minAmount,
          applicablePackageDefinitionIds: dto.applicablePackageDefinitionIds,
          newMembersOnly: dto.newMembersOnly,
          isActive: dto.isActive,
          createdByUserId: actorUserId,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('Bu kod bu işletmede zaten kullanımda');
      }
      throw err;
    }
  }

  async updatePromoCode(tenant: TenantContext, promoCodeId: string, dto: UpdatePromoCodeInput) {
    const existing = await this.prisma.promoCode.findFirst({ where: { id: promoCodeId, studioId: tenant.studioId } });
    if (!existing) throw new NotFoundException('Promosyon kodu bulunamadı');
    return this.prisma.promoCode.update({
      where: { id: existing.id },
      data: {
        validFrom: dto.validFrom !== undefined ? new Date(dto.validFrom) : undefined,
        validTo: dto.validTo !== undefined ? new Date(dto.validTo) : undefined,
        maxRedemptions: dto.maxRedemptions,
        perUserLimit: dto.perUserLimit,
        minAmount: dto.minAmount,
        applicablePackageDefinitionIds: dto.applicablePackageDefinitionIds,
        newMembersOnly: dto.newMembersOnly,
        isActive: dto.isActive,
      },
    });
  }

  async listPromoCodes(tenant: TenantContext) {
    return this.prisma.promoCode.findMany({ where: { studioId: tenant.studioId }, orderBy: { createdAt: 'desc' } });
  }

  async getPromoCode(tenant: TenantContext, promoCodeId: string) {
    const promo = await this.prisma.promoCode.findFirst({ where: { id: promoCodeId, studioId: tenant.studioId } });
    if (!promo) throw new NotFoundException('Promosyon kodu bulunamadı');
    return promo;
  }

  async listPromoRedemptions(tenant: TenantContext, promoCodeId: string) {
    await this.getPromoCode(tenant, promoCodeId);
    return this.prisma.promoRedemption.findMany({ where: { studioId: tenant.studioId, promoCodeId }, orderBy: { createdAt: 'desc' } });
  }

  // ---------------------------------------------------------------------------
  // Promo codes: member preview (no redemption)
  // ---------------------------------------------------------------------------

  async previewPromoCode(tenant: TenantContext, code: string, packageDefinitionId: string) {
    const pkgDef = await this.prisma.packageDefinition.findFirst({
      where: { id: packageDefinitionId, studioId: tenant.studioId },
    });
    if (!pkgDef) throw new NotFoundException('Paket tanımı bulunamadı');
    const basePrice = pkgDef.price;

    if (!tenant.memberProfileId) throw new ForbiddenException('Bu işlem yalnızca üyeler içindir');
    const userId = await this.resolveUserIdForMember(tenant.studioId, tenant.memberProfileId);

    const promo = await this.findActivePromoCode(tenant.studioId, code);
    if (!promo) {
      return { valid: false, reason: 'Kod bulunamadı veya pasif', basePrice: basePrice.toFixed(2), discountAmount: '0.00', finalAmount: basePrice.toFixed(2), bonusUnits: 0 };
    }
    const validation = await this.validatePromoRules(promo, pkgDef, basePrice, userId);
    if (!validation.valid) {
      return { valid: false, reason: validation.reason, basePrice: basePrice.toFixed(2), discountAmount: '0.00', finalAmount: basePrice.toFixed(2), bonusUnits: 0 };
    }
    const { discountAmount, finalAmount, bonusUnits } = computePromoDiscount(promo.kind, promo.value, basePrice);
    return {
      valid: true,
      basePrice: basePrice.toFixed(2),
      discountAmount: discountAmount.toFixed(2),
      finalAmount: finalAmount.toFixed(2),
      bonusUnits,
    };
  }

  private async resolveUserIdForMember(studioId: string, memberProfileId: string): Promise<string> {
    const member = await this.prisma.memberProfile.findFirstOrThrow({
      where: { id: memberProfileId, studioId },
      include: { membership: true },
    });
    return member.membership.userId;
  }

  private async findActivePromoCode(studioId: string, code: string): Promise<PromoCode | null> {
    return this.prisma.promoCode.findFirst({
      where: { studioId, code: code.trim().toUpperCase(), isActive: true },
    });
  }

  private async validatePromoRules(
    promo: PromoCode,
    pkgDef: PackageDefinition,
    basePrice: Prisma.Decimal,
    userId: string,
  ): Promise<{ valid: true } | { valid: false; reason: string }> {
    const now = new Date();
    if (promo.validFrom && now < promo.validFrom) return { valid: false, reason: 'Kodun geçerlilik tarihi henüz başlamadı' };
    if (promo.validTo && now > promo.validTo) return { valid: false, reason: 'Kodun süresi dolmuş' };
    if (
      promo.applicablePackageDefinitionIds.length > 0 &&
      !promo.applicablePackageDefinitionIds.includes(pkgDef.id)
    ) {
      return { valid: false, reason: 'Kod bu paket için geçerli değil' };
    }
    if (promo.minAmount && basePrice.lt(promo.minAmount)) {
      return { valid: false, reason: 'Tutar bu kod için minimum tutarın altında' };
    }
    if (promo.maxRedemptions !== null && promo.redeemedCount >= promo.maxRedemptions) {
      return { valid: false, reason: 'Kod kullanım limitine ulaştı' };
    }
    if (promo.newMembersOnly) {
      const priorPayments = await this.prisma.payment.count({
        where: { studioId: promo.studioId, paymentStatus: 'COMPLETED', member: { membership: { userId } } },
      });
      if (priorPayments > 0) return { valid: false, reason: 'Kod yalnızca yeni üyeler içindir' };
    }
    const usedByUser = await this.prisma.promoRedemption.count({ where: { promoCodeId: promo.id, userId } });
    if (usedByUser >= promo.perUserLimit) {
      return { valid: false, reason: 'Bu kodu daha önce kullandınız' };
    }
    return { valid: true };
  }

  // ---------------------------------------------------------------------------
  // Sale pricing preview (read-only): resolves what a provider/card charge
  // should be for, before any mutation. The transactional apply methods
  // below re-validate and are authoritative for what actually gets recorded.
  // ---------------------------------------------------------------------------

  async previewSalePricing(
    studioId: string,
    userId: string,
    pkgDef: PackageDefinition,
    basePrice: Prisma.Decimal,
    opts: { promoCode?: string; giftCardCode?: string; giftCardAmount?: number },
  ): Promise<{ discountAmount: Prisma.Decimal; giftCardAmount: Prisma.Decimal; methodAmount: Prisma.Decimal }> {
    let discountAmount = new Prisma.Decimal(0);
    if (opts.promoCode) {
      const promo = await this.findActivePromoCode(studioId, opts.promoCode);
      if (!promo) throw new BadRequestException('Promosyon kodu bulunamadı veya pasif');
      const validation = await this.validatePromoRules(promo, pkgDef, basePrice, userId);
      if (!validation.valid) throw new BadRequestException(validation.reason);
      discountAmount = computePromoDiscount(promo.kind, promo.value, basePrice).discountAmount;
    }
    const afterDiscount = basePrice.minus(discountAmount);

    let giftCardAmount = new Prisma.Decimal(0);
    if (opts.giftCardCode) {
      const codeHash = hashGiftCardCode(opts.giftCardCode);
      const card = await this.prisma.giftCard.findFirst({ where: { studioId, codeHash } });
      if (!card) throw new BadRequestException('Hediye kartı bulunamadı');
      if (card.status !== GiftCardStatus.ACTIVE) throw new BadRequestException('Hediye kartı kullanılabilir durumda değil');
      if (card.expiresAt && card.expiresAt < new Date()) throw new BadRequestException('Hediye kartının süresi dolmuş');
      const requested = opts.giftCardAmount !== undefined ? new Prisma.Decimal(opts.giftCardAmount) : afterDiscount;
      giftCardAmount = Prisma.Decimal.min(requested, card.balance, afterDiscount).toDecimalPlaces(2);
    }
    const methodAmount = afterDiscount.minus(giftCardAmount);
    return { discountAmount, giftCardAmount, methodAmount: methodAmount.lt(0) ? new Prisma.Decimal(0) : methodAmount };
  }

  // ---------------------------------------------------------------------------
  // Promo codes: redemption inside the sale transaction
  // ---------------------------------------------------------------------------

  /**
   * Validates and atomically reserves a promo code redemption inside an
   * in-flight sale transaction. Returns null if no code was supplied.
   * Throws a user-facing error for any invalid/expired/exhausted code.
   */
  async applyPromoCodeTx(
    tx: Tx,
    studioId: string,
    userId: string,
    code: string,
    pkgDef: PackageDefinition,
    basePrice: Prisma.Decimal,
  ): Promise<PromoApplication> {
    const promo = await tx.promoCode.findFirst({ where: { studioId, code: code.trim().toUpperCase(), isActive: true } });
    if (!promo) throw new BadRequestException('Promosyon kodu bulunamadı veya pasif');

    const validation = await this.validatePromoRulesTx(tx, promo, pkgDef, basePrice, userId);
    if (!validation.valid) throw new BadRequestException(validation.reason);

    // Atomic: total redemptions across every user can never exceed maxRedemptions.
    if (promo.maxRedemptions !== null) {
      const reserved = await tx.promoCode.updateMany({
        where: { id: promo.id, studioId, redeemedCount: { lt: promo.maxRedemptions } },
        data: { redeemedCount: { increment: 1 } },
      });
      if (reserved.count === 0) throw new ConflictException('Kod kullanım limitine ulaştı');
    } else {
      await tx.promoCode.update({ where: { id: promo.id }, data: { redeemedCount: { increment: 1 } } });
    }

    // Atomic: this user's own per-code limit, race-safe against parallel checkouts.
    const slot = await this.reserveCounterSlot(tx, {
      studioId,
      subject: RedemptionCounterSubject.PROMO_CODE,
      subjectId: promo.id,
      userId,
      limit: promo.perUserLimit,
    });
    if (!slot) throw new ConflictException('Bu kodu daha önce kullandınız');

    const { discountAmount, bonusUnits } = computePromoDiscount(promo.kind, promo.value, basePrice);
    return { promoCode: promo, discountAmount, bonusUnits };
  }

  private async validatePromoRulesTx(
    tx: Tx,
    promo: PromoCode,
    pkgDef: PackageDefinition,
    basePrice: Prisma.Decimal,
    userId: string,
  ): Promise<{ valid: true } | { valid: false; reason: string }> {
    const now = new Date();
    if (promo.validFrom && now < promo.validFrom) return { valid: false, reason: 'Kodun geçerlilik tarihi henüz başlamadı' };
    if (promo.validTo && now > promo.validTo) return { valid: false, reason: 'Kodun süresi dolmuş' };
    if (promo.applicablePackageDefinitionIds.length > 0 && !promo.applicablePackageDefinitionIds.includes(pkgDef.id)) {
      return { valid: false, reason: 'Kod bu paket için geçerli değil' };
    }
    if (promo.minAmount && basePrice.lt(promo.minAmount)) {
      return { valid: false, reason: 'Tutar bu kod için minimum tutarın altında' };
    }
    if (promo.newMembersOnly) {
      const priorPayments = await tx.payment.count({
        where: { studioId: promo.studioId, paymentStatus: 'COMPLETED', member: { membership: { userId } } },
      });
      if (priorPayments > 0) return { valid: false, reason: 'Kod yalnızca yeni üyeler içindir' };
    }
    return { valid: true };
  }

  async recordPromoRedemption(tx: Tx, studioId: string, userId: string, promoCodeId: string, paymentId: string, discountAmount: Prisma.Decimal) {
    await tx.promoRedemption.create({ data: { studioId, userId, promoCodeId, paymentId, discountAmount } });
  }

  // ---------------------------------------------------------------------------
  // Gift cards: issue / list / get / cancel / adjust
  // ---------------------------------------------------------------------------

  async issueGiftCard(tenant: TenantContext, actorUserId: string, dto: IssueGiftCardInput) {
    const member = await this.prisma.memberProfile.findFirst({
      where: { id: dto.memberId, studioId: tenant.studioId },
      include: { membership: true },
    });
    if (!member) throw new NotFoundException('Üye bulunamadı');

    const branchId = dto.branchId ?? member.homeBranchId ?? null;
    if (branchId) assertBranchAccess(tenant, branchId);

    const amount = new Prisma.Decimal(dto.initialAmount).toDecimalPlaces(2);
    const code = generateGiftCardCode();
    const codeHash = hashGiftCardCode(code);
    const last4 = last4OfGiftCardCode(code);

    const { giftCard, payment } = await this.prisma.$transaction(async (tx) => {
      const giftCard = await tx.giftCard.create({
        data: {
          studioId: tenant.studioId,
          codeHash,
          last4,
          initialAmount: amount,
          balance: amount,
          currency: dto.currency,
          purchaserUserId: member.membership.userId,
          recipientName: dto.recipientName,
          recipientPhone: dto.recipientPhone,
          message: dto.message,
          expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        },
      });
      const payment = await tx.payment.create({
        data: {
          studioId: tenant.studioId,
          memberId: dto.memberId,
          branchId,
          amount,
          currency: dto.currency,
          paymentMethod: dto.paymentMethod,
          paymentStatus: 'COMPLETED',
          notes: `Hediye kartı satışı (${giftCard.last4})`,
        },
      });
      await tx.giftCardTransaction.create({
        data: { giftCardId: giftCard.id, studioId: tenant.studioId, type: GiftCardTransactionType.ISSUE, amount, paymentId: payment.id, actorUserId },
      });
      return { giftCard, payment };
    });

    return { ...giftCard, code, payment };
  }

  async listGiftCards(tenant: TenantContext) {
    const cards = await this.prisma.giftCard.findMany({ where: { studioId: tenant.studioId }, orderBy: { createdAt: 'desc' } });
    return cards;
  }

  /** Member self-service: the gift cards this member purchased (never someone else's). */
  async listMyGiftCards(tenant: TenantContext, actorUserId: string) {
    return this.prisma.giftCard.findMany({
      where: { studioId: tenant.studioId, purchaserUserId: actorUserId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getGiftCard(tenant: TenantContext, giftCardId: string) {
    const card = await this.prisma.giftCard.findFirst({ where: { id: giftCardId, studioId: tenant.studioId } });
    if (!card) throw new NotFoundException('Hediye kartı bulunamadı');
    return card;
  }

  async cancelGiftCard(tenant: TenantContext, actorUserId: string, giftCardId: string) {
    const card = await this.getGiftCard(tenant, giftCardId);
    if (card.status === GiftCardStatus.CANCELLED) throw new BadRequestException('Kart zaten iptal edilmiş');
    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.giftCard.updateMany({
        where: { id: card.id, studioId: tenant.studioId, status: { not: GiftCardStatus.CANCELLED } },
        data: { status: GiftCardStatus.CANCELLED },
      });
      if (result.count === 0) throw new ConflictException('Kart durumu az önce değişti, tekrar deneyin');
      await tx.auditLog.create({
        data: { studioId: tenant.studioId, userId: actorUserId, action: 'promotions.gift_card.cancel', entityType: 'GiftCard', entityId: card.id },
      });
      return tx.giftCard.findUniqueOrThrow({ where: { id: card.id } });
    });
    return updated;
  }

  /** Manual balance correction, always audited. Positive credits, negative debits (never below zero). */
  async adjustGiftCard(tenant: TenantContext, actorUserId: string, giftCardId: string, dto: AdjustGiftCardInput) {
    const card = await this.getGiftCard(tenant, giftCardId);
    const delta = new Prisma.Decimal(dto.amount).toDecimalPlaces(2);
    const newBalance = card.balance.plus(delta);
    if (newBalance.lt(0)) throw new BadRequestException('Bakiye negatif olamaz');

    return this.prisma.$transaction(async (tx) => {
      const result = await tx.giftCard.updateMany({
        where: { id: card.id, studioId: tenant.studioId, balance: card.balance },
        data: { balance: newBalance },
      });
      if (result.count === 0) throw new ConflictException('Kart bakiyesi az önce değişti, tekrar deneyin');
      await tx.giftCardTransaction.create({
        data: { giftCardId: card.id, studioId: tenant.studioId, type: GiftCardTransactionType.ADJUST, amount: delta, actorUserId, note: dto.note },
      });
      await tx.auditLog.create({
        data: {
          studioId: tenant.studioId,
          userId: actorUserId,
          action: 'promotions.gift_card.adjust',
          entityType: 'GiftCard',
          entityId: card.id,
          metadata: { amount: delta.toFixed(2), note: dto.note },
        },
      });
      return tx.giftCard.findUniqueOrThrow({ where: { id: card.id } });
    });
  }

  async listGiftCardTransactions(tenant: TenantContext, giftCardId: string) {
    await this.getGiftCard(tenant, giftCardId);
    return this.prisma.giftCardTransaction.findMany({ where: { studioId: tenant.studioId, giftCardId }, orderBy: { createdAt: 'desc' } });
  }

  // ---------------------------------------------------------------------------
  // Gift cards: member self-service balance check and redemption
  // ---------------------------------------------------------------------------

  /**
   * Constant-time by construction: the code is never compared character by
   * character, only looked up by its sha256 hash through the unique index.
   */
  async checkGiftCardBalance(tenant: TenantContext, code: string) {
    const codeHash = hashGiftCardCode(code);
    const card = await this.prisma.giftCard.findFirst({ where: { studioId: tenant.studioId, codeHash } });
    if (!card) throw new NotFoundException('Hediye kartı bulunamadı');
    const status = this.effectiveStatus(card);
    return { last4: card.last4, balance: card.balance.toFixed(2), currency: card.currency, status, expiresAt: card.expiresAt };
  }

  private effectiveStatus(card: { status: GiftCardStatus; expiresAt: Date | null }): GiftCardStatus {
    if (card.status === GiftCardStatus.ACTIVE && card.expiresAt && card.expiresAt < new Date()) {
      return GiftCardStatus.EXPIRED;
    }
    return card.status;
  }

  /**
   * Atomically debits a gift card by up to `requestedAmount` (capped by its
   * balance) inside an in-flight sale transaction. Returns null if no code
   * was supplied. Throws if the card is invalid, expired, cancelled, or a
   * concurrent spend already took the balance below what is requested.
   */
  async applyGiftCardTx(tx: Tx, studioId: string, code: string, requestedAmount: Prisma.Decimal): Promise<GiftCardApplication> {
    const codeHash = hashGiftCardCode(code);
    const card = await tx.giftCard.findFirst({ where: { studioId, codeHash } });
    if (!card) throw new BadRequestException('Hediye kartı bulunamadı');
    if (card.status !== GiftCardStatus.ACTIVE) throw new BadRequestException('Hediye kartı kullanılabilir durumda değil');
    if (card.expiresAt && card.expiresAt < new Date()) throw new BadRequestException('Hediye kartının süresi dolmuş');

    const amount = Prisma.Decimal.min(requestedAmount, card.balance).toDecimalPlaces(2);
    if (amount.lte(0)) throw new BadRequestException('Hediye kartı bakiyesi yetersiz');

    const remaining = card.balance.minus(amount);
    const reserved = await tx.giftCard.updateMany({
      where: { id: card.id, studioId, status: GiftCardStatus.ACTIVE, balance: { gte: amount } },
      data: { balance: remaining, status: remaining.lte(0) ? GiftCardStatus.REDEEMED : GiftCardStatus.ACTIVE },
    });
    if (reserved.count === 0) {
      throw new ConflictException('Hediye kartı bakiyesi başka bir işlemde kullanıldı, tekrar deneyin');
    }
    return { giftCardId: card.id, amountApplied: amount };
  }

  async recordGiftCardRedemption(tx: Tx, studioId: string, giftCardId: string, amount: Prisma.Decimal, paymentId: string, actorUserId: string) {
    await tx.giftCardTransaction.create({
      data: { giftCardId, studioId, type: GiftCardTransactionType.REDEEM, amount, paymentId, actorUserId },
    });
  }

  /** Credits an amount back to a gift card on refund of the payment that used it. */
  async refundToGiftCard(tx: Tx, studioId: string, giftCardId: string, amount: Prisma.Decimal, paymentId: string, actorUserId: string) {
    if (amount.lte(0)) return;
    await tx.giftCard.update({
      where: { id: giftCardId },
      data: { balance: { increment: amount }, status: GiftCardStatus.ACTIVE },
    });
    await tx.giftCardTransaction.create({
      data: { giftCardId, studioId, type: GiftCardTransactionType.REFUND, amount, paymentId, actorUserId },
    });
  }
}
