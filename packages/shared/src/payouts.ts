import { z } from 'zod';
import { ACCOUNTING_DELIMITERS, ACCOUNTING_MAX_RANGE_DAYS, amountToMinor, minorToAmount } from './accounting';
import type { AccountingColumn } from './accounting';
import { vmsg } from './validation-key';

/**
 * Bank payouts and reconciliation (G5d-2, docs/BANKA_ODEMELERI.md): pure
 * rules shared by the API, the web panel and the tests. A payout is a batch
 * transfer from a payment provider to the studio's bank account; its items
 * are the charges, refunds, fees and adjustments inside it. Amounts are
 * decimal strings in the payout's own currency (never a hard-coded one),
 * arithmetic runs on integer minor units in BigInt.
 */

// ---------------------------------------------------------------------------
// Vocabulary (mirrors the Prisma enums)
// ---------------------------------------------------------------------------

/** Providers a payout can come from. Wider than the legacy `PaymentProvider` enum, which predates Stripe. */
export const PAYOUT_PROVIDERS = ['MOCK', 'IYZICO', 'PAYTR', 'STRIPE'] as const;
export type PayoutProvider = (typeof PAYOUT_PROVIDERS)[number];

export const PAYOUT_STATUSES = ['PENDING', 'IN_TRANSIT', 'PAID', 'FAILED', 'CANCELED'] as const;
export type PayoutStatusValue = (typeof PAYOUT_STATUSES)[number];

export const PAYOUT_ITEM_TYPES = ['CHARGE', 'REFUND', 'FEE', 'ADJUSTMENT'] as const;
export type PayoutItemTypeValue = (typeof PAYOUT_ITEM_TYPES)[number];

export const PAYOUT_RECONCILIATION_STATUSES = ['MATCHED', 'PARTIAL', 'UNMATCHED'] as const;
export type PayoutReconciliationStatusValue = (typeof PAYOUT_RECONCILIATION_STATUSES)[number];

export const PAYOUT_MATCH_SOURCES = ['AUTO', 'MANUAL', 'UNMATCHED_MANUAL'] as const;
export type PayoutMatchSourceValue = (typeof PAYOUT_MATCH_SOURCES)[number];

/** Only charges and refunds stand for a payment of ours; fees and adjustments have nothing to match. */
export function isMatchableItemType(type: PayoutItemTypeValue): boolean {
  return type === 'CHARGE' || type === 'REFUND';
}

/** Stable API error codes of the payout endpoints; the web BFF translates them (TRANSLATED_API_ERROR_CODES). */
export const PAYOUT_ERROR_CODES = {
  notFound: 'PAYOUT_NOT_FOUND',
  itemNotFound: 'PAYOUT_ITEM_NOT_FOUND',
  itemNotMatchable: 'PAYOUT_ITEM_NOT_MATCHABLE',
  paymentNotFound: 'PAYOUT_PAYMENT_NOT_FOUND',
  currencyMismatch: 'PAYOUT_CURRENCY_MISMATCH',
  tooManyRows: 'PAYOUT_TOO_MANY_ROWS',
  unknownProvider: 'PAYOUT_UNKNOWN_PROVIDER',
} as const;

export const PAYOUT_MAX_PAGE_SIZE = 100;
export const PAYOUT_EXPORT_MAX_ROWS = 50_000;
export const PAYOUT_EXPORT_KINDS = ['payouts', 'items'] as const;
export type PayoutExportKind = (typeof PAYOUT_EXPORT_KINDS)[number];
export const PAYOUT_EXPORT_FORMATS = ['xlsx', 'csv'] as const;
export type PayoutExportFormat = (typeof PAYOUT_EXPORT_FORMATS)[number];

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

export const ListPayoutsQuerySchema = z
  .object({
    /** Arrival date range (inclusive). */
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    provider: z.enum(PAYOUT_PROVIDERS).optional(),
    status: z.enum(PAYOUT_STATUSES).optional(),
    reconciliationStatus: z.enum(PAYOUT_RECONCILIATION_STATUSES).optional(),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(PAYOUT_MAX_PAGE_SIZE).default(25),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, { message: vmsg('validation.startDateAfterEndDate'), path: ['from'] });
export type ListPayoutsQuery = z.infer<typeof ListPayoutsQuerySchema>;

export const MatchPayoutItemSchema = z.object({ paymentId: z.string().uuid() }).strict();
export type MatchPayoutItemInput = z.infer<typeof MatchPayoutItemSchema>;

/** Provider account ids (Stripe `acct_...`) are short tokens; a character class checked in linear time. */
export const UpdatePayoutConnectionSchema = z
  .object({
    providerAccountId: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .regex(/^[A-Za-z0-9_-]+$/, vmsg('validation.invalidAccountId'))
      .nullable(),
  })
  .strict();
export type UpdatePayoutConnectionInput = z.infer<typeof UpdatePayoutConnectionSchema>;

export const PayoutExportQuerySchema = z
  .object({
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    provider: z.enum(PAYOUT_PROVIDERS).optional(),
    kind: z.enum(PAYOUT_EXPORT_KINDS).default('payouts'),
    format: z.enum(PAYOUT_EXPORT_FORMATS).default('xlsx'),
    delimiter: z
      .enum(['semicolon', 'comma', ';', ','])
      .default('semicolon')
      .transform((v): keyof typeof ACCOUNTING_DELIMITERS => (v === ',' || v === 'comma' ? 'comma' : 'semicolon')),
    locale: z
      .string()
      .regex(/^[a-z]{2,3}(-[A-Z]{2})?$/, vmsg('validation.invalidLanguageCode'))
      .optional(),
  })
  .transform(({ from, to, ...rest }) => {
    // Pending payouts arrive in the coming days, so the default range reaches a week ahead.
    const end = to ?? new Date(Date.now() + 7 * DAY_MS);
    const start = from ?? new Date(end.getTime() - 90 * DAY_MS);
    return { ...rest, from: start, to: end };
  })
  .refine((q) => q.from <= q.to, { message: vmsg('validation.startDateAfterEndDate'), path: ['from'] })
  .refine((q) => q.to.getTime() - q.from.getTime() <= ACCOUNTING_MAX_RANGE_DAYS * DAY_MS, {
    message: vmsg('validation.exportRangeMostOneYear'),
    path: ['to'],
  });
export type PayoutExportQuery = z.infer<typeof PayoutExportQuerySchema>;

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

export interface PayoutDTO {
  id: string;
  provider: PayoutProvider;
  providerPayoutId: string;
  status: PayoutStatusValue;
  arrivalDate: string;
  grossAmount: string;
  feeAmount: string;
  refundAmount: string;
  netAmount: string;
  currency: string;
  itemCount: number;
  matchedItemCount: number;
  matchableItemCount: number;
  reconciliationStatus: PayoutReconciliationStatusValue;
  syncedAt: string;
}

export interface PayoutPaymentSummaryDTO {
  id: string;
  amount: string;
  currency: string;
  refundedAmount: string;
  paidAt: string;
  receiptNumber: string | null;
  providerReference: string | null;
  paymentMethod: string;
}

export interface PayoutItemDTO {
  id: string;
  type: PayoutItemTypeValue;
  providerReference: string | null;
  relatedReference: string | null;
  amount: string;
  fee: string;
  net: string;
  currency: string;
  occurredAt: string;
  description: string | null;
  matchSource: PayoutMatchSourceValue | null;
  payment: PayoutPaymentSummaryDTO | null;
}

export interface PayoutDetailDTO extends PayoutDTO {
  items: PayoutItemDTO[];
  /** Sum of the item nets. */
  itemsNetAmount: string;
  /** netAmount minus itemsNetAmount; anything but zero means the provider's items do not add up to its transfer. */
  netDifference: string;
}

export interface PayoutListDTO {
  items: PayoutDTO[];
  page: number;
  pageSize: number;
  total: number;
}

export type PayoutSyncOutcome = 'SYNCED' | 'UNSUPPORTED' | 'NOT_CONFIGURED' | 'FAILED' | 'SKIPPED';

export interface PayoutSyncResultDTO {
  provider: PayoutProvider;
  outcome: PayoutSyncOutcome;
  payouts: number;
  items: number;
  matched: number;
}

export interface PayoutConnectionDTO {
  provider: PayoutProvider;
  /** False for providers without a payout adapter (iyzico, PayTR for now). */
  supported: boolean;
  /** True when a real sync needs `providerAccountId` and none is set. */
  accountRequired: boolean;
  providerAccountId: string | null;
  lastSyncedAt: string | null;
  lastError: string | null;
}

export interface PayoutPaymentCandidateDTO extends PayoutPaymentSummaryDTO {
  /** True when the candidate's amount equals the item's absolute amount. */
  exactAmount: boolean;
}

// ---------------------------------------------------------------------------
// Totals and reconciliation
// ---------------------------------------------------------------------------

export interface PayoutAmountLine {
  type: PayoutItemTypeValue;
  /** Signed gross amount. */
  amount: string;
  /** Provider fee of the line, positive. */
  fee: string;
  net: string;
}

export interface PayoutTotals {
  /** Sum of the charges. */
  gross: string;
  /** Item fees plus standalone fee lines, positive. */
  fee: string;
  /** Sum of the refunds, positive. */
  refund: string;
  /** Sum of the adjustment nets, signed. */
  adjustments: string;
  /** Sum of every line's net. */
  itemsNet: string;
}

/** Totals of a payout's items, computed in integer minor units of `currency`. */
export function summarizePayoutItems(items: readonly PayoutAmountLine[], currency: string): PayoutTotals {
  let gross = 0n;
  let fee = 0n;
  let refund = 0n;
  let adjustments = 0n;
  let itemsNet = 0n;
  for (const item of items) {
    const amount = amountToMinor(item.amount, currency);
    fee += amountToMinor(item.fee, currency);
    itemsNet += amountToMinor(item.net, currency);
    switch (item.type) {
      case 'CHARGE':
        gross += amount;
        break;
      case 'REFUND':
        refund += amount < 0n ? -amount : amount;
        break;
      case 'FEE':
        fee += amount < 0n ? -amount : amount;
        break;
      case 'ADJUSTMENT':
        adjustments += amountToMinor(item.net, currency);
        break;
    }
  }
  return {
    gross: minorToAmount(gross, currency),
    fee: minorToAmount(fee, currency),
    refund: minorToAmount(refund, currency),
    adjustments: minorToAmount(adjustments, currency),
    itemsNet: minorToAmount(itemsNet, currency),
  };
}

/** The provider's transferred net minus what the items add up to; "0.00" when they agree. */
export function payoutNetDifference(netAmount: string, itemsNet: string, currency: string): string {
  return minorToAmount(amountToMinor(netAmount, currency) - amountToMinor(itemsNet, currency), currency);
}

export interface ReconciliationCounts {
  /** All items of the payout. */
  total: number;
  /** Charges and refunds. */
  matchable: number;
  /** Charges and refunds linked to a payment. */
  matched: number;
}

/**
 * MATCHED when every charge and refund is linked to a payment (a payout
 * with only fees and adjustments has nothing to match), UNMATCHED when none
 * is, PARTIAL in between. A payout without any item is UNMATCHED: nothing
 * explains its amount yet.
 */
export function reconciliationStatusOf(counts: ReconciliationCounts): PayoutReconciliationStatusValue {
  if (counts.total === 0) return 'UNMATCHED';
  if (counts.matchable === 0) return 'MATCHED';
  if (counts.matched >= counts.matchable) return 'MATCHED';
  if (counts.matched === 0) return 'UNMATCHED';
  return 'PARTIAL';
}

export interface MatchableItem {
  id: string;
  type: PayoutItemTypeValue;
  providerReference: string | null;
  relatedReference: string | null;
  currency: string;
  paymentId: string | null;
  matchSource: PayoutMatchSourceValue | null;
}

export interface MatchablePayment {
  id: string;
  providerReference: string | null;
  currency: string;
}

/** The provider references an item can be matched on, most specific first, without duplicates or blanks. */
export function itemMatchReferences(item: Pick<MatchableItem, 'providerReference' | 'relatedReference'>): string[] {
  const refs: string[] = [];
  for (const ref of [item.providerReference, item.relatedReference]) {
    if (ref && !refs.includes(ref)) refs.push(ref);
  }
  return refs;
}

/**
 * Links charge and refund items to payments by provider reference. Items a
 * person already handled (matched or unmatched by hand) and items that are
 * already linked are left alone; a reference shared by several payments is
 * ambiguous and matches nothing; a currency mismatch never matches. The
 * caller passes only payments of the same studio and provider.
 */
export function autoMatchItems(items: readonly MatchableItem[], payments: readonly MatchablePayment[]): { itemId: string; paymentId: string }[] {
  const byReference = new Map<string, MatchablePayment[]>();
  for (const payment of payments) {
    if (!payment.providerReference) continue;
    const list = byReference.get(payment.providerReference) ?? [];
    list.push(payment);
    byReference.set(payment.providerReference, list);
  }
  const matches: { itemId: string; paymentId: string }[] = [];
  for (const item of items) {
    if (!isMatchableItemType(item.type) || item.paymentId || item.matchSource === 'MANUAL' || item.matchSource === 'UNMATCHED_MANUAL') continue;
    for (const ref of itemMatchReferences(item)) {
      const candidates = (byReference.get(ref) ?? []).filter((p) => p.currency.toUpperCase() === item.currency.toUpperCase());
      if (candidates.length === 1) {
        matches.push({ itemId: item.id, paymentId: candidates[0].id });
        break;
      }
    }
  }
  return matches;
}

// ---------------------------------------------------------------------------
// Export rows (accounting export format: one sheet per currency)
// ---------------------------------------------------------------------------

export interface PayoutJournalSource {
  arrivalDate: Date;
  provider: string;
  providerPayoutId: string;
  status: string;
  reconciliationStatus: string;
  itemCount: number;
  matchedItemCount: number;
  grossAmount: string;
  feeAmount: string;
  refundAmount: string;
  netAmount: string;
  currency: string;
}

export interface PayoutJournalRow {
  arrivalDate: string;
  provider: string;
  providerPayoutId: string;
  status: string;
  reconciliationStatus: string;
  itemCount: string;
  matchedItemCount: string;
  gross: string;
  fee: string;
  refund: string;
  net: string;
  currency: string;
}

export const PAYOUT_JOURNAL_COLUMNS: readonly AccountingColumn<PayoutJournalRow>[] = [
  { key: 'arrivalDate', labelKey: 'payouts.col.arrivalDate', cell: 'date' },
  { key: 'provider', labelKey: 'payouts.col.provider' },
  { key: 'providerPayoutId', labelKey: 'payouts.col.providerPayoutId' },
  { key: 'status', labelKey: 'payouts.col.status' },
  { key: 'reconciliationStatus', labelKey: 'payouts.col.reconciliationStatus' },
  { key: 'itemCount', labelKey: 'payouts.col.itemCount', numeric: true, cell: 'count' },
  { key: 'matchedItemCount', labelKey: 'payouts.col.matchedItemCount', numeric: true, cell: 'count' },
  { key: 'gross', labelKey: 'payouts.col.gross', numeric: true, cell: 'amount' },
  { key: 'fee', labelKey: 'payouts.col.fee', numeric: true, cell: 'amount' },
  { key: 'refund', labelKey: 'payouts.col.refund', numeric: true, cell: 'amount' },
  { key: 'net', labelKey: 'payouts.col.net', numeric: true, cell: 'amount' },
  { key: 'currency', labelKey: 'payouts.col.currency' },
];

/** One row per payout, sorted by arrival date then provider payout id. */
export function buildPayoutJournal(sources: readonly PayoutJournalSource[]): PayoutJournalRow[] {
  return sources
    .map((p) => ({
      arrivalDate: p.arrivalDate.toISOString(),
      provider: p.provider,
      providerPayoutId: p.providerPayoutId,
      status: p.status,
      reconciliationStatus: p.reconciliationStatus,
      itemCount: String(p.itemCount),
      matchedItemCount: String(p.matchedItemCount),
      gross: minorToAmount(amountToMinor(p.grossAmount, p.currency), p.currency),
      fee: minorToAmount(amountToMinor(p.feeAmount, p.currency), p.currency),
      refund: minorToAmount(amountToMinor(p.refundAmount, p.currency), p.currency),
      net: minorToAmount(amountToMinor(p.netAmount, p.currency), p.currency),
      currency: p.currency,
    }))
    .sort((a, b) => a.arrivalDate.localeCompare(b.arrivalDate) || a.providerPayoutId.localeCompare(b.providerPayoutId));
}

export interface PayoutItemJournalSource {
  arrivalDate: Date;
  provider: string;
  providerPayoutId: string;
  type: string;
  providerReference: string | null;
  occurredAt: Date;
  amount: string;
  fee: string;
  net: string;
  currency: string;
  paymentId: string | null;
  receiptNumber: string | null;
}

export interface PayoutItemJournalRow {
  arrivalDate: string;
  provider: string;
  providerPayoutId: string;
  type: string;
  providerReference: string;
  occurredAt: string;
  amount: string;
  fee: string;
  net: string;
  currency: string;
  receiptNumber: string;
  paymentId: string;
}

export const PAYOUT_ITEM_JOURNAL_COLUMNS: readonly AccountingColumn<PayoutItemJournalRow>[] = [
  { key: 'arrivalDate', labelKey: 'payouts.col.arrivalDate', cell: 'date' },
  { key: 'provider', labelKey: 'payouts.col.provider' },
  { key: 'providerPayoutId', labelKey: 'payouts.col.providerPayoutId' },
  { key: 'type', labelKey: 'payouts.col.type' },
  { key: 'providerReference', labelKey: 'payouts.col.providerReference' },
  { key: 'occurredAt', labelKey: 'payouts.col.occurredAt', cell: 'date' },
  { key: 'amount', labelKey: 'payouts.col.amount', numeric: true, cell: 'amount' },
  { key: 'fee', labelKey: 'payouts.col.fee', numeric: true, cell: 'amount' },
  { key: 'net', labelKey: 'payouts.col.net', numeric: true, cell: 'amount' },
  { key: 'currency', labelKey: 'payouts.col.currency' },
  { key: 'receiptNumber', labelKey: 'payouts.col.receiptNumber' },
  { key: 'paymentId', labelKey: 'payouts.col.paymentId' },
];

/** One row per payout item, sorted by arrival date, payout id, then time. */
export function buildPayoutItemJournal(sources: readonly PayoutItemJournalSource[]): PayoutItemJournalRow[] {
  return sources
    .map((i) => ({
      arrivalDate: i.arrivalDate.toISOString(),
      provider: i.provider,
      providerPayoutId: i.providerPayoutId,
      type: i.type,
      providerReference: i.providerReference ?? '',
      occurredAt: i.occurredAt.toISOString(),
      amount: minorToAmount(amountToMinor(i.amount, i.currency), i.currency),
      fee: minorToAmount(amountToMinor(i.fee, i.currency), i.currency),
      net: minorToAmount(amountToMinor(i.net, i.currency), i.currency),
      currency: i.currency,
      receiptNumber: i.receiptNumber ?? '',
      paymentId: i.paymentId ?? '',
    }))
    .sort((a, b) => a.arrivalDate.localeCompare(b.arrivalDate) || a.providerPayoutId.localeCompare(b.providerPayoutId) || a.occurredAt.localeCompare(b.occurredAt));
}
