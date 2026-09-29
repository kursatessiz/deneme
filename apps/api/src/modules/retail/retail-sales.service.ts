import { Injectable, Logger, Optional } from '@nestjs/common';
import { PaymentMethod, PaymentStatus, Prisma, SaleStatus, StockMovementType } from '@platform/database';
import type { Sale, SaleLine, SaleRefund, SaleRefundLine } from '@platform/database';
import {
  computeCartTotals,
  formatReceiptNumber,
  fromRetailMinor,
  lineRefundAmount,
  saleStatusAfterRefund,
  toRetailMinor,
} from '@platform/shared';
import type {
  CheckoutInput,
  RefundSaleInput,
  RetailSalesReportDTO,
  SaleDTO,
  SaleListItemDTO,
  SalesQuery,
  ReportRange,
} from '@platform/shared';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import type { TenantContext } from '../auth/tenant-context';
import { assertBranchAccess } from '../branches/branch-access';
import { PromotionsService } from '../promotions/promotions.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { CrmHooksService } from '../crm/hooks/crm-hooks.service';
import { retailError } from './retail.errors';
import { applyStockChange, loadTaxContext } from './retail-stock';
import { RetailCatalogService } from './retail-catalog.service';

type SaleWithRelations = Sale & {
  lines: SaleLine[];
  refunds: (SaleRefund & { lines: SaleRefundLine[] })[];
  branch: { name: string };
};

const ZERO = new Prisma.Decimal(0);

/**
 * Desk sales (G3c-2, docs/PERAKENDE.md): checkout, sales history, refunds
 * and voids, and the sales report. A checkout is one transaction: receipt
 * number, stock decrements, the sale and its lines, and (when a member is
 * the customer) the Payment row with its promo redemption. CRM, loyalty and
 * webhooks run after commit through the same hooks as package payments.
 */
@Injectable()
export class RetailSalesService {
  private readonly logger = new Logger(RetailSalesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: RetailCatalogService,
    private readonly promotions: PromotionsService,
    private readonly webhooks: WebhooksService,
    @Optional() private readonly crm?: CrmHooksService,
  ) {}

  // -- Checkout -------------------------------------------------------------

  async checkout(tenant: TenantContext, actorUserId: string, dto: CheckoutInput): Promise<SaleDTO & { duplicate: boolean }> {
    const studioId = tenant.studioId;
    if (dto.idempotencyKey) {
      const existing = await this.prisma.sale.findFirst({ where: { studioId, idempotencyKey: dto.idempotencyKey }, select: { id: true } });
      if (existing) return { ...(await this.getSale(tenant, existing.id)), duplicate: true };
    }
    await this.catalog.assertBranch(tenant, dto.branchId);

    const productIds = [...new Set(dto.lines.map((l) => l.productId))];
    const products = await this.prisma.product.findMany({ where: { studioId, id: { in: productIds } } });
    const byId = new Map(products.map((p) => [p.id, p]));
    for (const id of productIds) {
      const product = byId.get(id);
      if (!product) throw retailError('RETAIL_PRODUCT_NOT_FOUND', { productId: id });
      if (!product.isActive) throw retailError('RETAIL_PRODUCT_INACTIVE', { productId: id });
    }
    const tax = await loadTaxContext(this.prisma, studioId);
    if (products.some((p) => p.currency !== tax.currency)) throw retailError('RETAIL_CURRENCY_MISMATCH');

    // Customer: a member of this studio and/or a CRM contact, both optional.
    let customerName: string | null = null;
    let memberUserId: string | null = null;
    if (dto.memberId) {
      const member = await this.prisma.memberProfile.findFirst({
        where: { id: dto.memberId, studioId },
        include: { membership: { include: { user: { select: { id: true, firstName: true, lastName: true } } } } },
      });
      if (!member) throw retailError('RETAIL_CUSTOMER_NOT_FOUND');
      memberUserId = member.membership.user.id;
      customerName = `${member.membership.user.firstName} ${member.membership.user.lastName}`.trim();
    }
    if (dto.contactId) {
      const contact = await this.prisma.contact.findFirst({ where: { id: dto.contactId, studioId, mergedIntoId: null } });
      if (!contact) throw retailError('RETAIL_CUSTOMER_NOT_FOUND');
      customerName ??= [contact.firstName, contact.lastName].filter(Boolean).join(' ').trim() || null;
    }
    if (dto.promoCode && !memberUserId) throw retailError('RETAIL_PROMO_REQUIRES_MEMBER');

    const cartLines = dto.lines.map((line) => {
      const product = byId.get(line.productId)!;
      return {
        unitPrice: product.price.toFixed(2),
        quantity: line.quantity,
        discount: line.discount,
        taxRate: product.taxRate ? product.taxRate.toString() : tax.defaultTaxRate,
      };
    });
    const base = computeCartTotals({ currency: tax.currency, pricesIncludeTax: tax.pricesIncludeTax, lines: cartLines });

    const saleId = randomUUID();
    let paymentId: string | null = null;
    try {
      paymentId = await this.prisma.$transaction(
        async (tx) => {
          // Gapless receipt sequence; the row lock also serialises checkouts of one studio.
          const [counter] = await tx.$queryRaw<{ last_receipt_seq: number; receipt_prefix: string; allow_backorder: boolean }[]>(Prisma.sql`
            INSERT INTO "retail_settings" ("studio_id", "last_receipt_seq", "updated_at")
            VALUES (${studioId}::uuid, 1, now())
            ON CONFLICT ("studio_id") DO UPDATE SET "last_receipt_seq" = "retail_settings"."last_receipt_seq" + 1, "updated_at" = now()
            RETURNING "last_receipt_seq", "receipt_prefix", "allow_backorder"`);
          const receiptNumber = formatReceiptNumber(counter.receipt_prefix, counter.last_receipt_seq);

          let promo: { id: string; code: string; discount: Prisma.Decimal } | null = null;
          let totals = base;
          if (dto.promoCode && memberUserId) {
            const applied = await this.promotions.applyPromoCodeTx(tx, studioId, memberUserId, dto.promoCode, null, new Prisma.Decimal(base.discountableAmount));
            const discount = fromRetailMinor(toRetailMinor(applied.discountAmount.toFixed(2), tax.currency), tax.currency);
            promo = { id: applied.promoCode.id, code: applied.promoCode.code, discount: new Prisma.Decimal(discount) };
            totals = computeCartTotals({ currency: tax.currency, pricesIncludeTax: tax.pricesIncludeTax, lines: cartLines, orderDiscount: discount });
          }

          // Stock out, one conditional update per tracked product in id order (no lock-order deadlocks).
          const perProduct = new Map<string, number>();
          for (const line of dto.lines) {
            if (byId.get(line.productId)!.trackStock) perProduct.set(line.productId, (perProduct.get(line.productId) ?? 0) + line.quantity);
          }
          for (const productId of [...perProduct.keys()].sort()) {
            await applyStockChange(tx, {
              studioId,
              productId,
              branchId: dto.branchId,
              delta: -(perProduct.get(productId) as number),
              type: StockMovementType.SALE,
              allowNegative: counter.allow_backorder,
              reference: receiptNumber,
              saleId,
              actorUserId,
            });
          }

          let payment: { id: string } | null = null;
          if (dto.memberId) {
            payment = await tx.payment.create({
              data: {
                studioId,
                memberId: dto.memberId,
                branchId: dto.branchId,
                amount: new Prisma.Decimal(totals.total),
                currency: tax.currency,
                paymentMethod: dto.paymentMethod as PaymentMethod,
                paymentStatus: PaymentStatus.COMPLETED,
                receiptNumber,
                notes: dto.note,
                promoCodeId: promo?.id,
                discountAmount: promo?.discount ?? ZERO,
                metadata: { saleId, kind: 'retail' },
              },
              select: { id: true },
            });
          }

          await tx.sale.create({
            data: {
              id: saleId,
              studioId,
              branchId: dto.branchId,
              receiptSeq: counter.last_receipt_seq,
              receiptNumber,
              status: SaleStatus.COMPLETED,
              memberId: dto.memberId ?? null,
              contactId: dto.contactId ?? null,
              customerName,
              currency: tax.currency,
              pricesIncludeTax: tax.pricesIncludeTax,
              subtotal: new Prisma.Decimal(totals.subtotal),
              discountTotal: new Prisma.Decimal(totals.discountTotal),
              netTotal: new Prisma.Decimal(totals.netTotal),
              taxTotal: new Prisma.Decimal(totals.taxTotal),
              total: new Prisma.Decimal(totals.total),
              paymentMethod: dto.paymentMethod as PaymentMethod,
              paymentId: payment?.id ?? null,
              promoCode: promo?.code ?? null,
              promoDiscount: promo?.discount ?? ZERO,
              note: dto.note ?? null,
              idempotencyKey: dto.idempotencyKey ?? null,
              soldByUserId: actorUserId,
            },
          });
          await tx.saleLine.createMany({
            data: dto.lines.map((line, i) => {
              const product = byId.get(line.productId)!;
              const t = totals.lines[i];
              return {
                studioId,
                saleId,
                productId: product.id,
                productName: product.name,
                sku: product.sku,
                stockTracked: product.trackStock,
                quantity: line.quantity,
                unitPrice: product.price,
                unitCost: product.costPrice,
                lineDiscount: new Prisma.Decimal(t.lineDiscount),
                orderDiscount: new Prisma.Decimal(t.orderDiscount),
                taxRate: new Prisma.Decimal(cartLines[i].taxRate),
                netAmount: new Prisma.Decimal(t.netAmount),
                taxAmount: new Prisma.Decimal(t.taxAmount),
                total: new Prisma.Decimal(t.total),
              };
            }),
          });

          if (promo && payment && memberUserId) {
            await this.promotions.recordPromoRedemption(tx, studioId, memberUserId, promo.id, payment.id, promo.discount);
          }
          await tx.auditLog.create({
            data: { studioId, userId: actorUserId, action: 'retail.sale.create', entityType: 'Sale', entityId: saleId, metadata: { receiptNumber, total: totals.total } },
          });
          return payment?.id ?? null;
        },
        { timeout: 20_000, maxWait: 20_000 },
      );
    } catch (err) {
      // Two submits with the same key racing: the loser returns the winner's sale.
      if (dto.idempotencyKey && err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const existing = await this.prisma.sale.findFirst({ where: { studioId, idempotencyKey: dto.idempotencyKey }, select: { id: true } });
        if (existing) return { ...(await this.getSale(tenant, existing.id)), duplicate: true };
      }
      throw err;
    }

    if (paymentId) {
      // Same post-commit hooks as a package payment: CRM purchase conversion
      // and loyalty points (never throws), then the payment.completed webhook.
      await this.crm?.onPaymentCompleted(studioId, paymentId);
      await this.safeEmit(studioId, 'payment.completed', { paymentId });
    }
    return { ...(await this.getSale(tenant, saleId)), duplicate: false };
  }

  // -- Refunds --------------------------------------------------------------

  /**
   * Full or per-line refund. The sale row is locked first, so two refunds of
   * the same sale run one after the other; the linked payment's refunded
   * amount and status move in the same transaction (conditional on its
   * current values), and restocked units go back through RETURN movements.
   */
  async refund(tenant: TenantContext, actorUserId: string, saleId: string, dto: RefundSaleInput, opts: { void?: boolean } = {}): Promise<SaleDTO> {
    const studioId = tenant.studioId;
    const result = await this.prisma.$transaction(
      async (tx) => {
        const locked = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
          SELECT "id" FROM "sales" WHERE "id" = ${saleId}::uuid AND "studio_id" = ${studioId}::uuid FOR UPDATE`);
        if (locked.length === 0) throw retailError('RETAIL_SALE_NOT_FOUND');
        const sale = await tx.sale.findUniqueOrThrow({ where: { id: saleId }, include: { lines: true } });
        assertBranchAccess(tenant, sale.branchId);
        if (sale.status === SaleStatus.VOID || sale.status === SaleStatus.REFUNDED) throw retailError('RETAIL_SALE_NOT_REFUNDABLE');
        if (opts.void && sale.lines.some((l) => l.refundedQuantity > 0)) throw retailError('RETAIL_SALE_HAS_REFUNDS');

        const requested = new Map<string, { quantity: number; restock: boolean }>();
        const source = opts.void || !dto.lines ? sale.lines.map((l) => ({ saleLineId: l.id, quantity: l.quantity - l.refundedQuantity, restock: true })) : dto.lines;
        for (const r of source) {
          if (r.quantity <= 0) continue;
          const prev = requested.get(r.saleLineId);
          requested.set(r.saleLineId, { quantity: (prev?.quantity ?? 0) + r.quantity, restock: prev ? prev.restock && r.restock : r.restock });
        }
        if (requested.size === 0) throw retailError('RETAIL_SALE_NOT_REFUNDABLE');

        const plan = [...requested.entries()].map(([lineId, r]) => {
          const line = sale.lines.find((l) => l.id === lineId);
          if (!line || r.quantity > line.quantity - line.refundedQuantity) throw retailError('RETAIL_REFUND_EXCEEDS_SOLD', { saleLineId: lineId });
          const amount = lineRefundAmount({
            lineTotal: line.total.toFixed(2),
            lineQuantity: line.quantity,
            refundedQuantity: line.refundedQuantity,
            refundedAmount: line.refundedAmount.toFixed(2),
            quantity: r.quantity,
            currency: sale.currency,
          });
          return { line, quantity: r.quantity, restock: r.restock, amount: new Prisma.Decimal(amount) };
        });
        const amount = plan.reduce((sum, p) => sum.plus(p.amount), ZERO);
        const nextStatus = opts.void
          ? SaleStatus.VOID
          : saleStatusAfterRefund(
              sale.lines.map((l) => ({ quantity: l.quantity, refundedQuantity: l.refundedQuantity + (requested.get(l.id)?.quantity ?? 0) })),
            );
        const fullyRefunded = nextStatus === SaleStatus.VOID || nextStatus === SaleStatus.REFUNDED;

        if (sale.paymentId) {
          const payment = await tx.payment.findFirst({ where: { id: sale.paymentId, studioId } });
          if (!payment || payment.paymentStatus !== PaymentStatus.COMPLETED) throw retailError('RETAIL_PAYMENT_CONFLICT');
          const newRefunded = payment.refundedAmount.plus(amount);
          if (newRefunded.gt(payment.amount)) throw retailError('RETAIL_PAYMENT_CONFLICT');
          const moved = await tx.payment.updateMany({
            where: { id: payment.id, studioId, paymentStatus: PaymentStatus.COMPLETED, refundedAmount: payment.refundedAmount },
            data: { refundedAmount: newRefunded, paymentStatus: fullyRefunded ? PaymentStatus.REFUNDED : PaymentStatus.COMPLETED },
          });
          if (moved.count === 0) throw retailError('RETAIL_PAYMENT_CONFLICT');
        }

        const refund = await tx.saleRefund.create({
          data: {
            studioId,
            saleId,
            amount,
            currency: sale.currency,
            reason: opts.void ? `VOID: ${dto.reason}` : dto.reason,
            actorUserId,
            lines: {
              create: plan.map((p) => ({ studioId, saleLineId: p.line.id, quantity: p.quantity, amount: p.amount, restocked: p.restock && p.line.stockTracked })),
            },
          },
        });

        const restock = new Map<string, number>();
        for (const p of plan) {
          if (p.restock && p.line.stockTracked) restock.set(p.line.productId, (restock.get(p.line.productId) ?? 0) + p.quantity);
          await tx.saleLine.update({
            where: { id: p.line.id },
            data: { refundedQuantity: { increment: p.quantity }, refundedAmount: { increment: p.amount } },
          });
        }
        for (const productId of [...restock.keys()].sort()) {
          await applyStockChange(tx, {
            studioId,
            productId,
            branchId: sale.branchId,
            delta: restock.get(productId) as number,
            type: StockMovementType.RETURN,
            allowNegative: false,
            reason: dto.reason,
            reference: sale.receiptNumber,
            saleId,
            saleRefundId: refund.id,
            actorUserId,
          });
        }
        await tx.sale.update({ where: { id: saleId }, data: { status: nextStatus, refundedAmount: { increment: amount } } });
        await tx.auditLog.create({
          data: {
            studioId,
            userId: actorUserId,
            action: opts.void ? 'retail.sale.void' : 'retail.sale.refund',
            entityType: 'Sale',
            entityId: saleId,
            metadata: { amount: amount.toFixed(2), reason: dto.reason, refundId: refund.id },
          },
        });
        return { paymentId: sale.paymentId, amount, fullyRefunded };
      },
      { timeout: 20_000, maxWait: 20_000 },
    );

    if (result.paymentId) {
      await this.safeEmit(studioId, 'payment.refunded', { paymentId: result.paymentId, amount: result.amount.toFixed(2), fullyRefunded: result.fullyRefunded });
    }
    return this.getSale(tenant, saleId);
  }

  // -- Reads ----------------------------------------------------------------

  async listSales(tenant: TenantContext, query: SalesQuery): Promise<{ items: SaleListItemDTO[]; total: number; page: number; limit: number }> {
    if (query.branchId) assertBranchAccess(tenant, query.branchId);
    const where: Prisma.SaleWhereInput = {
      studioId: tenant.studioId,
      ...(query.branchId ? { branchId: query.branchId } : tenant.branchIds ? { branchId: { in: [...tenant.branchIds] } } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.memberId ? { memberId: query.memberId } : {}),
      ...(query.receipt ? { receiptNumber: { contains: query.receipt.toUpperCase() } } : {}),
      ...(query.from || query.to ? { createdAt: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.sale.findMany({
        where,
        include: { branch: { select: { name: true } }, lines: { select: { quantity: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.sale.count({ where }),
    ]);
    return {
      items: rows.map((s) => ({
        id: s.id,
        receiptNumber: s.receiptNumber,
        status: s.status,
        branchName: s.branch.name,
        customerName: s.customerName,
        currency: s.currency,
        total: s.total.toFixed(2),
        refundedAmount: s.refundedAmount.toFixed(2),
        paymentMethod: s.paymentMethod as SaleListItemDTO['paymentMethod'],
        itemCount: s.lines.reduce((sum, l) => sum + l.quantity, 0),
        createdAt: s.createdAt.toISOString(),
      })),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  async getSale(tenant: TenantContext, saleId: string): Promise<SaleDTO> {
    const sale = await this.prisma.sale.findFirst({
      where: { id: saleId, studioId: tenant.studioId },
      include: {
        lines: { orderBy: { id: 'asc' } },
        refunds: { include: { lines: true }, orderBy: { createdAt: 'asc' } },
        branch: { select: { name: true } },
      },
    });
    if (!sale) throw retailError('RETAIL_SALE_NOT_FOUND');
    assertBranchAccess(tenant, sale.branchId);
    return this.toSaleDTO(sale);
  }

  private async toSaleDTO(sale: SaleWithRelations): Promise<SaleDTO> {
    const names = await this.catalog.userNames([sale.soldByUserId, ...sale.refunds.map((r) => r.actorUserId)]);
    return {
      id: sale.id,
      receiptNumber: sale.receiptNumber,
      status: sale.status,
      branchId: sale.branchId,
      branchName: sale.branch.name,
      memberId: sale.memberId,
      contactId: sale.contactId,
      customerName: sale.customerName,
      currency: sale.currency,
      pricesIncludeTax: sale.pricesIncludeTax,
      subtotal: sale.subtotal.toFixed(2),
      discountTotal: sale.discountTotal.toFixed(2),
      netTotal: sale.netTotal.toFixed(2),
      taxTotal: sale.taxTotal.toFixed(2),
      total: sale.total.toFixed(2),
      refundedAmount: sale.refundedAmount.toFixed(2),
      paymentMethod: sale.paymentMethod as SaleDTO['paymentMethod'],
      paymentId: sale.paymentId,
      promoCode: sale.promoCode,
      promoDiscount: sale.promoDiscount.toFixed(2),
      note: sale.note,
      soldByName: names.get(sale.soldByUserId) ?? null,
      createdAt: sale.createdAt.toISOString(),
      lines: sale.lines.map((l) => ({
        id: l.id,
        productId: l.productId,
        productName: l.productName,
        sku: l.sku,
        quantity: l.quantity,
        unitPrice: l.unitPrice.toFixed(2),
        lineDiscount: l.lineDiscount.toFixed(2),
        orderDiscount: l.orderDiscount.toFixed(2),
        taxRate: l.taxRate.toString(),
        netAmount: l.netAmount.toFixed(2),
        taxAmount: l.taxAmount.toFixed(2),
        total: l.total.toFixed(2),
        refundedQuantity: l.refundedQuantity,
        refundedAmount: l.refundedAmount.toFixed(2),
      })),
      refunds: sale.refunds.map((r) => ({
        id: r.id,
        amount: r.amount.toFixed(2),
        reason: r.reason,
        actorName: names.get(r.actorUserId) ?? null,
        createdAt: r.createdAt.toISOString(),
        lines: r.lines.map((rl) => ({ saleLineId: rl.saleLineId, quantity: rl.quantity, amount: rl.amount.toFixed(2), restocked: rl.restocked })),
      })),
    };
  }

  // -- Report ---------------------------------------------------------------

  /**
   * Sales in [from, to), voided sales excluded. Revenue is what customers
   * paid minus refunds; margin compares the tax-exclusive revenue kept with
   * the cost snapshot of lines whose product had a cost price.
   */
  async salesReport(tenant: TenantContext, range: ReportRange, branchId?: string): Promise<RetailSalesReportDTO> {
    if (branchId) assertBranchAccess(tenant, branchId);
    const tax = await loadTaxContext(this.prisma, tenant.studioId);
    const sales = await this.prisma.sale.findMany({
      where: {
        studioId: tenant.studioId,
        status: { not: SaleStatus.VOID },
        createdAt: { gte: range.from, lt: range.to },
        ...(branchId ? { branchId } : tenant.branchIds ? { branchId: { in: [...tenant.branchIds] } } : {}),
      },
      include: { lines: true },
      orderBy: { createdAt: 'asc' },
    });

    const dayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: tax.timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
    const byDay = new Map<string, { saleCount: number; gross: Prisma.Decimal; refunded: Prisma.Decimal }>();
    const byProduct = new Map<string, { productName: string; quantity: number; refundedQuantity: number; revenue: Prisma.Decimal; cost: Prisma.Decimal; margin: Prisma.Decimal }>();
    let gross = ZERO;
    let refunded = ZERO;
    let taxTotal = ZERO;
    let cost = ZERO;
    let margin = ZERO;
    let itemCount = 0;
    for (const sale of sales) {
      gross = gross.plus(sale.total);
      refunded = refunded.plus(sale.refundedAmount);
      taxTotal = taxTotal.plus(sale.taxTotal);
      const day = dayFormat.format(sale.createdAt);
      const d = byDay.get(day) ?? { saleCount: 0, gross: ZERO, refunded: ZERO };
      byDay.set(day, { saleCount: d.saleCount + 1, gross: d.gross.plus(sale.total), refunded: d.refunded.plus(sale.refundedAmount) });
      for (const line of sale.lines) {
        const kept = line.quantity - line.refundedQuantity;
        itemCount += kept;
        const p = byProduct.get(line.productId) ?? { productName: line.productName, quantity: 0, refundedQuantity: 0, revenue: ZERO, cost: ZERO, margin: ZERO };
        p.quantity += line.quantity;
        p.refundedQuantity += line.refundedQuantity;
        p.revenue = p.revenue.plus(line.total.minus(line.refundedAmount));
        if (line.unitCost) {
          const lineCost = line.unitCost.times(kept);
          const netKept = line.netAmount.times(kept).dividedBy(line.quantity).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
          p.cost = p.cost.plus(lineCost);
          p.margin = p.margin.plus(netKept.minus(lineCost));
          cost = cost.plus(lineCost);
          margin = margin.plus(netKept.minus(lineCost));
        }
        byProduct.set(line.productId, p);
      }
    }

    return {
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      currency: tax.currency,
      totals: {
        saleCount: sales.length,
        itemCount,
        gross: gross.toFixed(2),
        refunded: refunded.toFixed(2),
        net: gross.minus(refunded).toFixed(2),
        tax: taxTotal.toFixed(2),
        cost: cost.toFixed(2),
        margin: margin.toFixed(2),
      },
      byProduct: [...byProduct.entries()]
        .map(([productId, p]) => ({
          productId,
          productName: p.productName,
          quantity: p.quantity,
          refundedQuantity: p.refundedQuantity,
          revenue: p.revenue.toFixed(2),
          cost: p.cost.toFixed(2),
          margin: p.margin.toFixed(2),
        }))
        .sort((a, b) => Number(b.revenue) - Number(a.revenue) || a.productName.localeCompare(b.productName)),
      byDay: [...byDay.entries()].map(([date, d]) => ({ date, saleCount: d.saleCount, gross: d.gross.toFixed(2), refunded: d.refunded.toFixed(2) })),
    };
  }

  private async safeEmit(studioId: string, event: 'payment.completed' | 'payment.refunded', payload: Record<string, unknown>): Promise<void> {
    try {
      await this.webhooks.emit(studioId, event, payload);
    } catch (err) {
      this.logger.warn(`Webhook ${event} failed for studio ${studioId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

