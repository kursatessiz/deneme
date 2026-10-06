import { BadRequestException, Injectable } from '@nestjs/common';
import { PaymentStatus, Prisma } from '@platform/database';
import {
  EXPENSE_JOURNAL_COLUMNS,
  SALES_JOURNAL_COLUMNS,
  SUMMARY_COLUMNS,
  buildAccountingJson,
  buildAccountingSummary,
  buildExpenseJournal,
  buildSalesJournal,
  defaultRetailTaxRate,
  renderAccountingCsv,
} from '@platform/shared';
import type {
  AccountingColumn,
  AccountingExpenseSource,
  AccountingExportQuery,
  AccountingJsonExport,
  AccountingPaymentSource,
  AccountingRefundSource,
  AccountingTaxComponent,
} from '@platform/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { TenantContext } from '../auth/tenant-context';
import { branchScope } from '../branches/branch-access';
import { I18nService } from '../i18n/i18n.service';
import { exportTranslator } from './accounting-i18n';
import { buildAccountingWorkbook } from './accounting-xlsx';
import { apiError } from '../../common/api-error';

/** Upper bound of payments in one export; a longer period is exported in parts. */
export const ACCOUNTING_MAX_PAYMENTS = 50_000;

export type AccountingExportResult =
  | { format: 'xlsx'; filename: string; body: Buffer }
  | { format: 'csv'; filename: string; body: string }
  | { format: 'json'; filename: string; body: AccountingJsonExport<object> };

const PAYMENT_INCLUDE = {
  member: { include: { membership: { include: { user: { select: { firstName: true, lastName: true } } } } } },
  contact: { select: { firstName: true, lastName: true } },
  memberPackage: { include: { packageDefinition: { select: { name: true } } } },
  memberSubscription: { include: { packageDefinition: { select: { name: true } } } },
  invoice: { select: { number: true, status: true } },
  retailSale: { include: { lines: { orderBy: { position: 'asc' } }, refunds: { select: { amount: true, createdAt: true } } } },
  eventRegistration: { include: { event: { select: { title: true } }, ticketType: { select: { name: true } } } },
} satisfies Prisma.PaymentInclude;

type PaymentRow = Prisma.PaymentGetPayload<{ include: typeof PAYMENT_INCLUDE }>;

/** Reads `metadata.amount` of a `payments.refund` audit row; anything else is ignored rather than guessed. */
function refundAmountOf(metadata: Prisma.JsonValue | null): string | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const amount = metadata.amount;
  if (typeof amount === 'string' && /^\d+(\.\d+)?$/.test(amount)) return amount;
  if (typeof amount === 'number' && Number.isFinite(amount) && amount > 0) return amount.toFixed(2);
  return null;
}

/**
 * Accounting export (G3c-3, docs/MUHASEBE.md): reads the payments, refunds
 * and expenses that already exist and hands them to the pure row builders in
 * packages/shared. It writes nothing but an audit row. Every query filters
 * by the tenant's studioId and by the caller's branch scope.
 */
@Injectable()
export class AccountingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly i18n: I18nService,
  ) {}

  async export(tenant: TenantContext, actorUserId: string, query: AccountingExportQuery): Promise<AccountingExportResult> {
    const studioId = tenant.studioId;
    const studio = await this.prisma.studio.findUniqueOrThrow({
      where: { id: studioId },
      select: { currency: true, taxRegime: true, defaultLocale: true, invoiceSettings: { select: { defaultVatRate: true } } },
    });
    const range = { from: query.from, to: query.to };
    const locale = query.locale ?? studio.defaultLocale;
    // Headers and labels in the requested language, uploaded packs and overrides included.
    const t = await exportTranslator(this.i18n, locale);
    const branch = branchScope(tenant, query.branchId);
    const defaultTaxRate = defaultRetailTaxRate(studio.taxRegime, studio.invoiceSettings ? studio.invoiceSettings.defaultVatRate.toString() : null);

    const wantSales = query.kind === 'sales' || query.kind === 'summary';
    const wantExpenses = query.kind === 'expenses' || query.kind === 'summary';
    const walkIn = t('finance.payments.walkIn');
    const sales = wantSales ? buildSalesJournal(await this.loadPaymentSources(studioId, branch, range, defaultTaxRate, walkIn), range) : [];
    const expenses = wantExpenses ? buildExpenseJournal(await this.loadExpenseSources(studioId, branch, range), studio.currency, range) : [];

    let columns: readonly AccountingColumn<never>[];
    let rows: readonly object[];
    if (query.kind === 'sales') {
      columns = SALES_JOURNAL_COLUMNS as readonly AccountingColumn<never>[];
      rows = sales;
    } else if (query.kind === 'expenses') {
      columns = EXPENSE_JOURNAL_COLUMNS as readonly AccountingColumn<never>[];
      rows = expenses;
    } else {
      columns = SUMMARY_COLUMNS as readonly AccountingColumn<never>[];
      rows = buildAccountingSummary(sales, expenses);
    }

    await this.prisma.auditLog
      .create({
        data: {
          studioId,
          userId: actorUserId,
          action: 'accounting.export',
          entityType: 'Studio',
          entityId: studioId,
          metadata: { kind: query.kind, format: query.format, from: range.from.toISOString(), to: range.to.toISOString(), branchId: query.branchId ?? null, rows: rows.length },
        },
      })
      .catch(() => undefined);

    const day = (d: Date) => d.toISOString().slice(0, 10);
    const filename = `accounting-${query.kind}-${day(range.from)}_${day(range.to)}.${query.format}`;
    if (query.format === 'json') {
      return { format: 'json', filename, body: buildAccountingJson(query.kind, range, query.branchId ?? null, [...rows]) };
    }
    if (query.format === 'xlsx') {
      const body = buildAccountingWorkbook({
        columns: columns as readonly AccountingColumn<{ currency: string }>[],
        rows: rows as readonly { currency: string }[],
        t,
        fallbackCurrency: studio.currency,
        totals: query.kind !== 'summary',
      });
      return { format: 'xlsx', filename, body };
    }
    return { format: 'csv', filename, body: renderAccountingCsv(columns as readonly AccountingColumn<object>[], rows, t, query.delimiter) };
  }

  // ---------------------------------------------------------------------------
  // Loading
  // ---------------------------------------------------------------------------

  private async loadPaymentSources(
    studioId: string,
    branch: ReturnType<typeof branchScope>,
    range: { from: Date; to: Date },
    defaultTaxRate: string,
    walkInLabel: string,
  ): Promise<AccountingPaymentSource[]> {
    // A payment belongs to the export when it was paid inside the range or
    // when it was refunded inside it (the refund line lands in this period).
    const [auditRefunds, saleRefunds] = await Promise.all([
      this.prisma.auditLog.findMany({
        where: { studioId, action: 'payments.refund', entityType: 'Payment', createdAt: { gte: range.from, lte: range.to } },
        select: { entityId: true },
      }),
      this.prisma.saleRefund.findMany({
        where: { studioId, createdAt: { gte: range.from, lte: range.to }, sale: { paymentId: { not: null } } },
        select: { sale: { select: { paymentId: true } } },
      }),
    ]);
    const refundedIds = new Set<string>();
    for (const r of auditRefunds) if (r.entityId) refundedIds.add(r.entityId);
    for (const r of saleRefunds) if (r.sale.paymentId) refundedIds.add(r.sale.paymentId);
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    const payments = await this.prisma.payment.findMany({
      where: {
        studioId,
        ...branch,
        paymentStatus: { in: [PaymentStatus.COMPLETED, PaymentStatus.REFUNDED] },
        OR: [{ paidAt: { gte: range.from, lte: range.to } }, { id: { in: [...refundedIds].filter((id) => uuid.test(id)) } }],
      },
      include: PAYMENT_INCLUDE,
      orderBy: { paidAt: 'asc' },
      take: ACCOUNTING_MAX_PAYMENTS + 1,
    });
    if (payments.length > ACCOUNTING_MAX_PAYMENTS) {
      throw new BadRequestException(apiError('apiErrors.accounting.tooManyPaymentsSelectedPeriodNarrow'));
    }

    // Refunds of payments that are not retail sales come from the audit
    // trail written by PaymentsService.refundPayment.
    const nonRetailIds = payments.filter((p) => !p.retailSale).map((p) => p.id);
    const refundLogs = nonRetailIds.length
      ? await this.prisma.auditLog.findMany({
          where: { studioId, action: 'payments.refund', entityType: 'Payment', entityId: { in: nonRetailIds } },
          select: { entityId: true, createdAt: true, metadata: true },
          orderBy: { createdAt: 'asc' },
        })
      : [];
    const refundsByPayment = new Map<string, AccountingRefundSource[]>();
    for (const log of refundLogs) {
      const amount = refundAmountOf(log.metadata);
      if (!log.entityId || !amount) continue;
      const list = refundsByPayment.get(log.entityId) ?? [];
      list.push({ at: log.createdAt, amount });
      refundsByPayment.set(log.entityId, list);
    }

    return payments.map((p) => this.toSource(p, refundsByPayment.get(p.id) ?? [], defaultTaxRate, walkInLabel));
  }

  private toSource(p: PaymentRow, auditRefunds: AccountingRefundSource[], defaultTaxRate: string, walkInLabel: string): AccountingPaymentSource {
    const sale = p.retailSale;
    // Member, then the guest's CRM contact, then the translated walk-in label
    // (an anonymous retail sale has neither); a sale keeps its receipt name.
    const person = p.member?.membership.user ?? p.contact;
    const personName = person ? `${person.firstName} ${person.lastName}`.trim() : '';
    const customerName = (sale?.customerName ?? '').trim() || personName || walkInLabel;

    let description = p.notes ?? '';
    let taxComponents: AccountingTaxComponent[];
    let refunds = auditRefunds;
    if (sale) {
      description = sale.lines.map((l) => `${l.productName} x${l.quantity}`).join(', ').slice(0, 300);
      const byRate = new Map<string, Prisma.Decimal>();
      for (const line of sale.lines) {
        const key = line.taxRate.toString();
        byRate.set(key, (byRate.get(key) ?? new Prisma.Decimal(0)).plus(line.total));
      }
      taxComponents = [...byRate.entries()].map(([taxRate, gross]) => ({ taxRate, gross: gross.toFixed(2) }));
      refunds = sale.refunds.map((r) => ({ at: r.createdAt, amount: r.amount.toFixed(2) }));
    } else {
      if (p.eventRegistration) description = `${p.eventRegistration.event.title} - ${p.eventRegistration.ticketType.name}`;
      else if (p.memberPackage) description = p.memberPackage.packageDefinition.name;
      else if (p.memberSubscription) description = p.memberSubscription.packageDefinition.name;
      // Payments carry no tax split of their own: the studio default rate
      // applies to the tax-inclusive amount, the same rule the e-invoice uses.
      taxComponents = [{ taxRate: defaultTaxRate, gross: p.amount.toFixed(2) }];
    }

    return {
      paymentId: p.id,
      branchId: p.branchId,
      paidAt: p.paidAt,
      receiptNumber: sale?.receiptNumber ?? p.receiptNumber,
      invoiceNumber: p.invoice && p.invoice.status !== 'CANCELLED' ? p.invoice.number : null,
      customerName,
      description,
      currency: p.currency,
      gross: p.amount.toFixed(2),
      paymentMethod: p.paymentMethod,
      providerReference: p.providerReference,
      taxComponents,
      refunds,
    };
  }

  private async loadExpenseSources(studioId: string, branch: ReturnType<typeof branchScope>, range: { from: Date; to: Date }): Promise<AccountingExpenseSource[]> {
    const rows = await this.prisma.expense.findMany({
      where: { studioId, ...branch, spentAt: { gte: range.from, lte: range.to } },
      orderBy: { spentAt: 'asc' },
      take: ACCOUNTING_MAX_PAYMENTS,
    });
    return rows.map((e) => ({ expenseId: e.id, branchId: e.branchId, spentAt: e.spentAt, category: e.category, note: e.note, amount: e.amount.toFixed(2) }));
  }
}
