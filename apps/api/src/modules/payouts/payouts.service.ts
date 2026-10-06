import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PaymentStatus, Prisma } from '@platform/database';
import {
  PAYOUT_ERROR_CODES,
  PAYOUT_EXPORT_MAX_ROWS,
  PAYOUT_ITEM_JOURNAL_COLUMNS,
  PAYOUT_JOURNAL_COLUMNS,
  amountToMinor,
  buildPayoutItemJournal,
  buildPayoutJournal,
  isMatchableItemType,
  payoutNetDifference,
  renderAccountingCsv,
  summarizePayoutItems,
} from '@platform/shared';
import type {
  AccountingColumn,
  ListPayoutsQuery,
  PayoutDTO,
  PayoutDetailDTO,
  PayoutExportQuery,
  PayoutItemDTO,
  PayoutItemTypeValue,
  PayoutListDTO,
  PayoutPaymentCandidateDTO,
  PayoutPaymentSummaryDTO,
} from '@platform/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { TenantContext } from '../auth/tenant-context';
import { I18nService } from '../i18n/i18n.service';
import { exportTranslator } from '../accounting/accounting-i18n';
import { buildAccountingWorkbook } from '../accounting/accounting-xlsx';
import { PayoutReconcileService } from './payout-reconcile.service';
import { codedError } from '../../common/api-error';

const DAY_MS = 24 * 60 * 60 * 1000;
const CANDIDATE_WINDOW_DAYS = 45;
const CANDIDATE_POOL = 100;
const CANDIDATE_LIMIT = 20;

export type PayoutExportResult = { format: 'xlsx'; filename: string; body: Buffer } | { format: 'csv'; filename: string; body: string };

const PAYMENT_SUMMARY_SELECT = {
  id: true,
  amount: true,
  currency: true,
  refundedAmount: true,
  paidAt: true,
  receiptNumber: true,
  providerReference: true,
  paymentMethod: true,
} satisfies Prisma.PaymentSelect;

type PaymentSummaryRow = Prisma.PaymentGetPayload<{ select: typeof PAYMENT_SUMMARY_SELECT }>;

function toPaymentSummary(p: PaymentSummaryRow): PayoutPaymentSummaryDTO {
  return {
    id: p.id,
    amount: p.amount.toFixed(2),
    currency: p.currency,
    refundedAmount: p.refundedAmount.toFixed(2),
    paidAt: p.paidAt.toISOString(),
    receiptNumber: p.receiptNumber,
    providerReference: p.providerReference,
    paymentMethod: p.paymentMethod,
  };
}

type PayoutRow = Prisma.PayoutGetPayload<object>;

function toPayoutDto(p: PayoutRow): PayoutDTO {
  return {
    id: p.id,
    provider: p.provider,
    providerPayoutId: p.providerPayoutId,
    status: p.status,
    arrivalDate: p.arrivalDate.toISOString(),
    grossAmount: p.grossAmount.toFixed(2),
    feeAmount: p.feeAmount.toFixed(2),
    refundAmount: p.refundAmount.toFixed(2),
    netAmount: p.netAmount.toFixed(2),
    currency: p.currency,
    itemCount: p.itemCount,
    matchedItemCount: p.matchedItemCount,
    matchableItemCount: p.matchableItemCount,
    reconciliationStatus: p.reconciliationStatus,
    syncedAt: p.syncedAt.toISOString(),
  };
}

const ITEM_INCLUDE = { payment: { select: PAYMENT_SUMMARY_SELECT } } satisfies Prisma.PayoutItemInclude;
type ItemRow = Prisma.PayoutItemGetPayload<{ include: typeof ITEM_INCLUDE }>;

function toItemDto(i: ItemRow): PayoutItemDTO {
  return {
    id: i.id,
    type: i.type,
    providerReference: i.providerReference,
    relatedReference: i.relatedReference,
    amount: i.amount.toFixed(2),
    fee: i.fee.toFixed(2),
    net: i.net.toFixed(2),
    currency: i.currency,
    occurredAt: i.occurredAt.toISOString(),
    description: i.description,
    matchSource: i.matchSource,
    payment: i.payment ? toPaymentSummary(i.payment) : null,
  };
}

/**
 * Bank payouts (G5d-2, docs/BANKA_ODEMELERI.md): listing, detail with items
 * and matched payments, manual match and unmatch (audit logged) and the
 * export in the accounting export format. Every query filters by the
 * tenant's studioId.
 */
@Injectable()
export class PayoutsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reconcile: PayoutReconcileService,
    private readonly i18n: I18nService,
  ) {}

  async list(tenant: TenantContext, query: ListPayoutsQuery): Promise<PayoutListDTO> {
    const where: Prisma.PayoutWhereInput = {
      studioId: tenant.studioId,
      ...(query.provider ? { provider: query.provider } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.reconciliationStatus ? { reconciliationStatus: query.reconciliationStatus } : {}),
      ...(query.from || query.to ? { arrivalDate: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.payout.findMany({
        where,
        orderBy: [{ arrivalDate: 'desc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.payout.count({ where }),
    ]);
    return { items: rows.map(toPayoutDto), page: query.page, pageSize: query.pageSize, total };
  }

  async detail(tenant: TenantContext, payoutId: string): Promise<PayoutDetailDTO> {
    const payout = await this.prisma.payout.findFirst({
      where: { id: payoutId, studioId: tenant.studioId },
      include: { items: { orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }], include: ITEM_INCLUDE } },
    });
    if (!payout) throw new NotFoundException(codedError(PAYOUT_ERROR_CODES.notFound, { statusCode: 404 }));
    const { items, ...row } = payout;
    const totals = summarizePayoutItems(
      items.map((i) => ({ type: i.type as PayoutItemTypeValue, amount: i.amount.toFixed(2), fee: i.fee.toFixed(2), net: i.net.toFixed(2) })),
      row.currency,
    );
    return {
      ...toPayoutDto(row),
      items: items.map(toItemDto),
      itemsNetAmount: totals.itemsNet,
      netDifference: payoutNetDifference(row.netAmount.toFixed(2), totals.itemsNet, row.currency),
    };
  }

  /** Payments a person can pick for an item: same studio and currency, paid near the item, exact amounts first. */
  async candidates(tenant: TenantContext, payoutId: string, itemId: string): Promise<PayoutPaymentCandidateDTO[]> {
    const item = await this.findItem(tenant.studioId, payoutId, itemId);
    const window = CANDIDATE_WINDOW_DAYS * DAY_MS;
    const rows = await this.prisma.payment.findMany({
      where: {
        studioId: tenant.studioId,
        currency: item.currency,
        paymentStatus: { in: [PaymentStatus.COMPLETED, PaymentStatus.REFUNDED] },
        paidAt: { gte: new Date(item.occurredAt.getTime() - window), lte: new Date(item.occurredAt.getTime() + window) },
      },
      select: PAYMENT_SUMMARY_SELECT,
      orderBy: { paidAt: 'desc' },
      take: CANDIDATE_POOL,
    });
    const target = amountToMinor(item.amount.abs().toFixed(2), item.currency);
    const scored = rows.map((p) => {
      const paid = amountToMinor(p.amount.toFixed(2), p.currency);
      const refunded = amountToMinor(p.refundedAmount.toFixed(2), p.currency);
      const exactAmount = item.type === 'REFUND' ? paid === target || refunded === target : paid === target;
      return { ...toPaymentSummary(p), exactAmount };
    });
    return scored.sort((a, b) => Number(b.exactAmount) - Number(a.exactAmount)).slice(0, CANDIDATE_LIMIT);
  }

  async match(tenant: TenantContext, actorUserId: string, payoutId: string, itemId: string, paymentId: string): Promise<PayoutDetailDTO> {
    const item = await this.findItem(tenant.studioId, payoutId, itemId);
    if (!isMatchableItemType(item.type as PayoutItemTypeValue)) {
      throw new BadRequestException(codedError(PAYOUT_ERROR_CODES.itemNotMatchable, { statusCode: 400 }));
    }
    const payment = await this.prisma.payment.findFirst({ where: { id: paymentId, studioId: tenant.studioId }, select: { id: true, currency: true } });
    if (!payment) throw new NotFoundException(codedError(PAYOUT_ERROR_CODES.paymentNotFound, { statusCode: 404 }));
    if (payment.currency.toUpperCase() !== item.currency.toUpperCase()) {
      throw new ConflictException(codedError(PAYOUT_ERROR_CODES.currencyMismatch, { statusCode: 409 }));
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.payoutItem.update({ where: { id: item.id }, data: { paymentId: payment.id, matchSource: 'MANUAL' } });
      await this.reconcile.reconcile(tx, tenant.studioId, payoutId);
      await tx.auditLog.create({
        data: {
          studioId: tenant.studioId,
          userId: actorUserId,
          action: 'payouts.match',
          entityType: 'Payout',
          entityId: payoutId,
          metadata: { itemId: item.id, paymentId: payment.id, previousPaymentId: item.paymentId },
        },
      });
    });
    return this.detail(tenant, payoutId);
  }

  async unmatch(tenant: TenantContext, actorUserId: string, payoutId: string, itemId: string): Promise<PayoutDetailDTO> {
    const item = await this.findItem(tenant.studioId, payoutId, itemId);
    if (!isMatchableItemType(item.type as PayoutItemTypeValue)) {
      throw new BadRequestException(codedError(PAYOUT_ERROR_CODES.itemNotMatchable, { statusCode: 400 }));
    }
    await this.prisma.$transaction(async (tx) => {
      // UNMATCHED_MANUAL keeps later syncs from linking it again.
      await tx.payoutItem.update({ where: { id: item.id }, data: { paymentId: null, matchSource: 'UNMATCHED_MANUAL' } });
      await this.reconcile.reconcile(tx, tenant.studioId, payoutId);
      await tx.auditLog.create({
        data: {
          studioId: tenant.studioId,
          userId: actorUserId,
          action: 'payouts.unmatch',
          entityType: 'Payout',
          entityId: payoutId,
          metadata: { itemId: item.id, previousPaymentId: item.paymentId },
        },
      });
    });
    return this.detail(tenant, payoutId);
  }

  private async findItem(studioId: string, payoutId: string, itemId: string) {
    const item = await this.prisma.payoutItem.findFirst({ where: { id: itemId, payoutId, studioId } });
    if (!item) throw new NotFoundException(codedError(PAYOUT_ERROR_CODES.itemNotFound, { statusCode: 404 }));
    return item;
  }

  // ---------------------------------------------------------------------------
  // Export
  // ---------------------------------------------------------------------------

  async export(tenant: TenantContext, actorUserId: string, query: PayoutExportQuery): Promise<PayoutExportResult> {
    const studioId = tenant.studioId;
    const studio = await this.prisma.studio.findUniqueOrThrow({ where: { id: studioId }, select: { currency: true, defaultLocale: true } });
    const t = await exportTranslator(this.i18n, query.locale ?? studio.defaultLocale);
    const arrival = { gte: query.from, lte: query.to };

    let columns: readonly AccountingColumn<never>[];
    let rows: readonly { currency: string }[];
    if (query.kind === 'items') {
      const items = await this.prisma.payoutItem.findMany({
        where: { studioId, payout: { studioId, arrivalDate: arrival, ...(query.provider ? { provider: query.provider } : {}) } },
        include: { payout: { select: { arrivalDate: true, provider: true, providerPayoutId: true } }, payment: { select: { receiptNumber: true } } },
        orderBy: { occurredAt: 'asc' },
        take: PAYOUT_EXPORT_MAX_ROWS + 1,
      });
      if (items.length > PAYOUT_EXPORT_MAX_ROWS) throw new BadRequestException(codedError(PAYOUT_ERROR_CODES.tooManyRows, { statusCode: 400 }));
      rows = buildPayoutItemJournal(
        items.map((i) => ({
          arrivalDate: i.payout.arrivalDate,
          provider: i.payout.provider,
          providerPayoutId: i.payout.providerPayoutId,
          type: i.type,
          providerReference: i.providerReference,
          occurredAt: i.occurredAt,
          amount: i.amount.toFixed(2),
          fee: i.fee.toFixed(2),
          net: i.net.toFixed(2),
          currency: i.currency,
          paymentId: i.paymentId,
          receiptNumber: i.payment?.receiptNumber ?? null,
        })),
      );
      columns = PAYOUT_ITEM_JOURNAL_COLUMNS as readonly AccountingColumn<never>[];
    } else {
      const payouts = await this.prisma.payout.findMany({
        where: { studioId, arrivalDate: arrival, ...(query.provider ? { provider: query.provider } : {}) },
        orderBy: { arrivalDate: 'asc' },
        take: PAYOUT_EXPORT_MAX_ROWS + 1,
      });
      if (payouts.length > PAYOUT_EXPORT_MAX_ROWS) throw new BadRequestException(codedError(PAYOUT_ERROR_CODES.tooManyRows, { statusCode: 400 }));
      rows = buildPayoutJournal(
        payouts.map((p) => ({
          arrivalDate: p.arrivalDate,
          provider: p.provider,
          providerPayoutId: p.providerPayoutId,
          status: p.status,
          reconciliationStatus: p.reconciliationStatus,
          itemCount: p.itemCount,
          matchedItemCount: p.matchedItemCount,
          grossAmount: p.grossAmount.toFixed(2),
          feeAmount: p.feeAmount.toFixed(2),
          refundAmount: p.refundAmount.toFixed(2),
          netAmount: p.netAmount.toFixed(2),
          currency: p.currency,
        })),
      );
      columns = PAYOUT_JOURNAL_COLUMNS as readonly AccountingColumn<never>[];
    }

    await this.prisma.auditLog
      .create({
        data: {
          studioId,
          userId: actorUserId,
          action: 'payouts.export',
          entityType: 'Studio',
          entityId: studioId,
          metadata: { kind: query.kind, format: query.format, from: query.from.toISOString(), to: query.to.toISOString(), provider: query.provider ?? null, rows: rows.length },
        },
      })
      .catch(() => undefined);

    const day = (d: Date) => d.toISOString().slice(0, 10);
    const filename = `payouts-${query.kind}-${day(query.from)}_${day(query.to)}.${query.format}`;
    if (query.format === 'xlsx') {
      const body = buildAccountingWorkbook({
        columns: columns as readonly AccountingColumn<{ currency: string }>[],
        rows,
        t,
        fallbackCurrency: studio.currency,
        totals: true,
      });
      return { format: 'xlsx', filename, body };
    }
    return { format: 'csv', filename, body: renderAccountingCsv(columns as readonly AccountingColumn<object>[], rows, t, query.delimiter) };
  }
}
