import { z } from 'zod';
import { currencyMinorUnitDigits } from './growth/regions';
import { allocateProportionally, roundDivHalfUp, taxRateToBasisPoints } from './retail';

/**
 * Accounting export (G3c-3, docs/MUHASEBE.md): pure row builders, currency
 * grouping and CSV rendering. No new money logic: every amount comes from
 * payments, refunds and expenses that already exist; this module only
 * reshapes them for a bookkeeper. Amounts are decimal strings, arithmetic
 * runs on integer minor units in BigInt, and totals are never mixed across
 * currencies.
 */

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

export const ACCOUNTING_KINDS = ['sales', 'expenses', 'summary'] as const;
export type AccountingKind = (typeof ACCOUNTING_KINDS)[number];

export const ACCOUNTING_FORMATS = ['csv', 'json'] as const;
export type AccountingFormat = (typeof ACCOUNTING_FORMATS)[number];

/** Delimiter names travel in the URL; the literal characters are accepted too. */
export const ACCOUNTING_DELIMITERS = { semicolon: ';', comma: ',' } as const;
export type AccountingDelimiterName = keyof typeof ACCOUNTING_DELIMITERS;

const DelimiterSchema = z
  .enum(['semicolon', 'comma', ';', ','])
  .default('semicolon')
  .transform((v): AccountingDelimiterName => (v === ',' || v === 'comma' ? 'comma' : 'semicolon'));

export const ACCOUNTING_MAX_RANGE_DAYS = 366;

export const AccountingExportQuerySchema = z
  .object({
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    branchId: z.string().uuid().optional(),
    kind: z.enum(ACCOUNTING_KINDS).default('sales'),
    format: z.enum(ACCOUNTING_FORMATS).default('csv'),
    delimiter: DelimiterSchema,
    /** Language of the CSV header row; defaults to the studio language. */
    locale: z
      .string()
      .regex(/^[a-z]{2,3}(-[A-Z]{2})?$/, 'Geçersiz dil kodu')
      .optional(),
  })
  .transform(({ from, to, ...rest }) => {
    const end = to ?? new Date();
    const start = from ?? new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
    return { ...rest, from: start, to: end };
  })
  .refine((q) => q.from <= q.to, { message: 'Başlangıç tarihi bitişten sonra olamaz', path: ['from'] })
  .refine((q) => q.to.getTime() - q.from.getTime() <= ACCOUNTING_MAX_RANGE_DAYS * 24 * 60 * 60 * 1000, {
    message: 'Dışa aktarım aralığı en fazla bir yıl olabilir',
    path: ['to'],
  });
export type AccountingExportQuery = z.infer<typeof AccountingExportQuerySchema>;

// ---------------------------------------------------------------------------
// Money helpers
// ---------------------------------------------------------------------------

const DECIMAL_RE = /^(-?)(\d+)(?:\.(\d+))?$/;

/** Digits printed for a currency: zero-decimal currencies print none, every other currency two (schema columns are Decimal(x, 2)). */
export function accountingMinorDigits(currency: string): 0 | 2 {
  return currencyMinorUnitDigits(currency) === 0 ? 0 : 2;
}

/** Parses a decimal string into signed minor units of the currency, rounding half away from zero. */
export function amountToMinor(amount: string | number, currency: string): bigint {
  const text = (typeof amount === 'number' ? String(amount) : amount).trim();
  const match = DECIMAL_RE.exec(text);
  if (!match) throw new Error(`Geçersiz tutar: ${text}`);
  const [, sign, whole, fraction = ''] = match;
  const digits = accountingMinorDigits(currency);
  const scale = 10n ** BigInt(fraction.length);
  const raw = BigInt(whole) * scale + (fraction ? BigInt(fraction) : 0n);
  const minor = roundDivHalfUp(raw * 10n ** BigInt(digits), scale);
  return sign === '-' ? -minor : minor;
}

/** Formats signed minor units with the currency's own digits ("12.50", "-300" for JPY). */
export function minorToAmount(minor: bigint, currency: string): string {
  const digits = accountingMinorDigits(currency);
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  const sign = negative && abs !== 0n ? '-' : '';
  if (digits === 0) return `${sign}${abs}`;
  return `${sign}${abs / 100n}.${(abs % 100n).toString().padStart(2, '0')}`;
}

/** Drops trailing '0' characters with a linear scan (no regex, so no backtracking on long input). */
function trimTrailingZeros(text: string): string {
  let end = text.length;
  while (end > 0 && text.charCodeAt(end - 1) === 48) end -= 1;
  return text.slice(0, end);
}

/** Tax percentage as it is printed: trailing zeros trimmed ("20.00" -> "20", "8.50" -> "8.5"). */
export function formatTaxRate(rate: string | number): string {
  const text = typeof rate === 'number' ? String(rate) : rate.trim();
  const match = DECIMAL_RE.exec(text);
  if (!match || match[1] === '-') throw new Error(`Geçersiz vergi oranı: ${text}`);
  const fraction = trimTrailingZeros(match[3] ?? '');
  return fraction ? `${match[2]}.${fraction}` : match[2];
}

/** Splits a tax-inclusive gross into net and tax (net rounded half-up, tax is the remainder). Sign-symmetric, so refunds mirror sales. */
export function splitInclusiveTax(grossMinor: bigint, taxRate: string): { net: bigint; tax: bigint } {
  const bp = taxRateToBasisPoints(taxRate);
  const net = roundDivHalfUp(grossMinor * 10000n, 10000n + bp);
  return { net, tax: grossMinor - net };
}

/** Allocates a signed total over non-negative weights so the parts always add up. */
function allocateSigned(total: bigint, weights: readonly bigint[]): bigint[] {
  if (total < 0n) return allocateProportionally(-total, weights).map((p) => -p);
  return allocateProportionally(total, weights);
}

// ---------------------------------------------------------------------------
// Sales journal
// ---------------------------------------------------------------------------

export type AccountingEntryType = 'SALE' | 'REFUND';

/** One tax bucket of a payment: gross weight (decimal string) at a tax percentage. */
export interface AccountingTaxComponent {
  taxRate: string;
  /** Gross amount that falls under this rate; only the proportions matter. */
  gross: string;
}

export interface AccountingRefundSource {
  at: Date;
  /** Positive refunded amount as a decimal string. */
  amount: string;
}

/** A completed (or since refunded) payment as the API loads it. */
export interface AccountingPaymentSource {
  paymentId: string;
  branchId: string | null;
  paidAt: Date;
  receiptNumber: string | null;
  invoiceNumber: string | null;
  customerName: string;
  description: string;
  currency: string;
  /** Gross amount of the payment (tax included). */
  gross: string;
  paymentMethod: string;
  providerReference: string | null;
  /** Empty means the payment carries no tax. */
  taxComponents: readonly AccountingTaxComponent[];
  refunds: readonly AccountingRefundSource[];
}

export interface SalesJournalRow {
  date: string;
  entryType: AccountingEntryType;
  documentNumber: string;
  invoiceNumber: string;
  customerName: string;
  description: string;
  net: string;
  taxRate: string;
  tax: string;
  gross: string;
  currency: string;
  paymentMethod: string;
  providerReference: string;
  paymentId: string;
  branchId: string;
}

function journalLines(source: AccountingPaymentSource, grossMinor: bigint): { taxRate: string; net: bigint; tax: bigint; gross: bigint }[] {
  const components = source.taxComponents.filter((c) => amountToMinor(c.gross, source.currency) > 0n);
  if (components.length === 0) return [{ taxRate: '0', net: grossMinor, tax: 0n, gross: grossMinor }];
  const weights = components.map((c) => amountToMinor(c.gross, source.currency));
  const shares = allocateSigned(grossMinor, weights);
  return components.map((c, i) => {
    const { net, tax } = splitInclusiveTax(shares[i], c.taxRate);
    return { taxRate: formatTaxRate(c.taxRate), net, tax, gross: shares[i] };
  });
}

/**
 * Journal lines for payments and refunds inside [from, to] (both inclusive).
 * A payment yields one line per tax rate; each refund inside the range
 * yields negative lines split over the same rates. Sorted by date, then
 * document number, then entry type (sales before refunds of the same day).
 */
export function buildSalesJournal(sources: readonly AccountingPaymentSource[], range: { from: Date; to: Date }): SalesJournalRow[] {
  const rows: SalesJournalRow[] = [];
  const inRange = (d: Date) => d.getTime() >= range.from.getTime() && d.getTime() <= range.to.getTime();
  const push = (source: AccountingPaymentSource, at: Date, type: AccountingEntryType, grossMinor: bigint) => {
    for (const line of journalLines(source, grossMinor)) {
      rows.push({
        date: at.toISOString(),
        entryType: type,
        documentNumber: source.receiptNumber ?? source.invoiceNumber ?? '',
        invoiceNumber: source.invoiceNumber ?? '',
        customerName: source.customerName,
        description: source.description,
        net: minorToAmount(line.net, source.currency),
        taxRate: line.taxRate,
        tax: minorToAmount(line.tax, source.currency),
        gross: minorToAmount(line.gross, source.currency),
        currency: source.currency,
        paymentMethod: source.paymentMethod,
        providerReference: source.providerReference ?? '',
        paymentId: source.paymentId,
        branchId: source.branchId ?? '',
      });
    }
  };
  for (const source of sources) {
    if (inRange(source.paidAt)) push(source, source.paidAt, 'SALE', amountToMinor(source.gross, source.currency));
    for (const refund of source.refunds) {
      if (!inRange(refund.at)) continue;
      const amount = amountToMinor(refund.amount, source.currency);
      if (amount > 0n) push(source, refund.at, 'REFUND', -amount);
    }
  }
  const typeOrder: Record<AccountingEntryType, number> = { SALE: 0, REFUND: 1 };
  return rows.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.documentNumber.localeCompare(b.documentNumber) ||
      typeOrder[a.entryType] - typeOrder[b.entryType] ||
      Number(a.taxRate) - Number(b.taxRate),
  );
}

// ---------------------------------------------------------------------------
// Expenses journal
// ---------------------------------------------------------------------------

export interface AccountingExpenseSource {
  expenseId: string;
  branchId: string | null;
  spentAt: Date;
  category: string;
  note: string | null;
  /** Decimal string in the studio currency. */
  amount: string;
}

export interface ExpenseJournalRow {
  date: string;
  category: string;
  description: string;
  amount: string;
  currency: string;
  expenseId: string;
  branchId: string;
}

/** Expenses carry no currency of their own: they are always booked in the studio currency (rule 8). */
export function buildExpenseJournal(sources: readonly AccountingExpenseSource[], currency: string, range: { from: Date; to: Date }): ExpenseJournalRow[] {
  return sources
    .filter((e) => e.spentAt.getTime() >= range.from.getTime() && e.spentAt.getTime() <= range.to.getTime())
    .map((e) => ({
      date: e.spentAt.toISOString(),
      category: e.category,
      description: e.note ?? '',
      amount: minorToAmount(amountToMinor(e.amount, currency), currency),
      currency,
      expenseId: e.expenseId,
      branchId: e.branchId ?? '',
    }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.category.localeCompare(b.category) || a.expenseId.localeCompare(b.expenseId));
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

export type AccountingSummarySection = 'taxRate' | 'paymentMethod' | 'expenseCategory' | 'total';

export interface SummaryRow {
  section: AccountingSummarySection;
  /** Tax percentage, payment method, expense category, or 'sales' / 'expenses' / 'result' for totals. */
  key: string;
  currency: string;
  /** Number of journal lines behind the row. */
  count: number;
  net: string;
  tax: string;
  gross: string;
}

interface Bucket {
  count: number;
  net: bigint;
  tax: bigint;
  gross: bigint;
}

function addTo(map: Map<string, { section: AccountingSummarySection; key: string; currency: string } & Bucket>, section: AccountingSummarySection, key: string, currency: string, v: Omit<Bucket, 'count'>): void {
  const id = `${section}\u0000${currency}\u0000${key}`;
  const b = map.get(id) ?? { section, key, currency, count: 0, net: 0n, tax: 0n, gross: 0n };
  b.count += 1;
  b.net += v.net;
  b.tax += v.tax;
  b.gross += v.gross;
  map.set(id, b);
}

const SECTION_ORDER: Record<AccountingSummarySection, number> = { taxRate: 0, paymentMethod: 1, expenseCategory: 2, total: 3 };
const TOTAL_ORDER: Record<string, number> = { sales: 0, expenses: 1, result: 2 };

function compareKeys(section: AccountingSummarySection, a: string, b: string): number {
  if (section === 'taxRate') return Number(a) - Number(b);
  if (section === 'total') return (TOTAL_ORDER[a] ?? 9) - (TOTAL_ORDER[b] ?? 9);
  return a.localeCompare(b);
}

/**
 * Per tax rate and per payment method (refunds netted in, as negative
 * lines), expenses per category, and totals. Every group is keyed by
 * currency first, so two currencies never share a total; the result total
 * (sales minus expenses) is only formed inside one currency.
 */
export function buildAccountingSummary(sales: readonly SalesJournalRow[], expenses: readonly ExpenseJournalRow[]): SummaryRow[] {
  const map = new Map<string, { section: AccountingSummarySection; key: string; currency: string } & Bucket>();
  for (const r of sales) {
    const v = { net: amountToMinor(r.net, r.currency), tax: amountToMinor(r.tax, r.currency), gross: amountToMinor(r.gross, r.currency) };
    addTo(map, 'taxRate', r.taxRate, r.currency, v);
    addTo(map, 'paymentMethod', r.paymentMethod, r.currency, v);
    addTo(map, 'total', 'sales', r.currency, v);
  }
  for (const e of expenses) {
    const amount = amountToMinor(e.amount, e.currency);
    addTo(map, 'expenseCategory', e.category, e.currency, { net: amount, tax: 0n, gross: amount });
    addTo(map, 'total', 'expenses', e.currency, { net: amount, tax: 0n, gross: amount });
  }
  const currencies = new Set([...map.values()].filter((b) => b.section === 'total').map((b) => b.currency));
  for (const currency of currencies) {
    const s = map.get(`total\u0000${currency}\u0000sales`);
    const x = map.get(`total\u0000${currency}\u0000expenses`);
    map.set(`total\u0000${currency}\u0000result`, {
      section: 'total',
      key: 'result',
      currency,
      count: (s?.count ?? 0) + (x?.count ?? 0),
      net: (s?.net ?? 0n) - (x?.net ?? 0n),
      tax: (s?.tax ?? 0n) - (x?.tax ?? 0n),
      gross: (s?.gross ?? 0n) - (x?.gross ?? 0n),
    });
  }
  return [...map.values()]
    .sort(
      (a, b) =>
        a.currency.localeCompare(b.currency) ||
        SECTION_ORDER[a.section] - SECTION_ORDER[b.section] ||
        compareKeys(a.section, a.key, b.key),
    )
    .map((b) => ({
      section: b.section,
      key: b.section === 'taxRate' ? formatTaxRate(b.key) : b.key,
      currency: b.currency,
      count: b.count,
      net: minorToAmount(b.net, b.currency),
      tax: minorToAmount(b.tax, b.currency),
      gross: minorToAmount(b.gross, b.currency),
    }));
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

export interface AccountingColumn<Row> {
  key: keyof Row & string;
  /** i18n key of the header cell (namespace `accounting`). */
  labelKey: string;
  /** Plain decimal cells are written as they are (a refund's leading minus is not a formula). */
  numeric?: boolean;
}

export const SALES_JOURNAL_COLUMNS: readonly AccountingColumn<SalesJournalRow>[] = [
  { key: 'date', labelKey: 'accounting.col.date' },
  { key: 'entryType', labelKey: 'accounting.col.entryType' },
  { key: 'documentNumber', labelKey: 'accounting.col.documentNumber' },
  { key: 'invoiceNumber', labelKey: 'accounting.col.invoiceNumber' },
  { key: 'customerName', labelKey: 'accounting.col.customerName' },
  { key: 'description', labelKey: 'accounting.col.description' },
  { key: 'net', labelKey: 'accounting.col.net', numeric: true },
  { key: 'taxRate', labelKey: 'accounting.col.taxRate', numeric: true },
  { key: 'tax', labelKey: 'accounting.col.tax', numeric: true },
  { key: 'gross', labelKey: 'accounting.col.gross', numeric: true },
  { key: 'currency', labelKey: 'accounting.col.currency' },
  { key: 'paymentMethod', labelKey: 'accounting.col.paymentMethod' },
  { key: 'providerReference', labelKey: 'accounting.col.providerReference' },
  { key: 'paymentId', labelKey: 'accounting.col.paymentId' },
  { key: 'branchId', labelKey: 'accounting.col.branchId' },
];

export const EXPENSE_JOURNAL_COLUMNS: readonly AccountingColumn<ExpenseJournalRow>[] = [
  { key: 'date', labelKey: 'accounting.col.date' },
  { key: 'category', labelKey: 'accounting.col.category' },
  { key: 'description', labelKey: 'accounting.col.description' },
  { key: 'amount', labelKey: 'accounting.col.amount', numeric: true },
  { key: 'currency', labelKey: 'accounting.col.currency' },
  { key: 'expenseId', labelKey: 'accounting.col.expenseId' },
  { key: 'branchId', labelKey: 'accounting.col.branchId' },
];

export const SUMMARY_COLUMNS: readonly AccountingColumn<SummaryRow>[] = [
  { key: 'currency', labelKey: 'accounting.col.currency' },
  { key: 'section', labelKey: 'accounting.col.section' },
  { key: 'key', labelKey: 'accounting.col.key' },
  { key: 'count', labelKey: 'accounting.col.count', numeric: true },
  { key: 'net', labelKey: 'accounting.col.net', numeric: true },
  { key: 'tax', labelKey: 'accounting.col.tax', numeric: true },
  { key: 'gross', labelKey: 'accounting.col.gross', numeric: true },
];

/** A cell that spreadsheet software could run as a formula (OWASP CSV injection), including leading tab/CR tricks. */
const FORMULA_PREFIX = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;

/**
 * One CSV field. Text starting with = + - @ (or tab/CR) gets a single quote
 * prefix so Excel and Sheets show it as text; a numeric column keeps plain
 * decimals untouched. Fields are quoted when they hold the delimiter, a
 * quote or a line break, with quotes doubled (RFC 4180).
 */
export function accountingCsvCell(value: unknown, delimiter: string, numeric = false): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (!(numeric && PLAIN_NUMBER.test(text)) && FORMULA_PREFIX.test(text)) text = `'${text}`;
  const needsQuotes = text.includes(delimiter) || /["\n\r]/.test(text);
  return needsQuotes ? `"${text.replace(/"/g, '""')}"` : text;
}

export const CSV_BOM = '﻿';

/** UTF-8 BOM (so Excel detects the encoding), translated header row, CRLF line ends. */
export function renderAccountingCsv<Row extends object>(
  columns: readonly AccountingColumn<Row>[],
  rows: readonly Row[],
  t: (key: string) => string,
  delimiter: AccountingDelimiterName = 'semicolon',
): string {
  const d = ACCOUNTING_DELIMITERS[delimiter];
  const header = columns.map((c) => accountingCsvCell(t(c.labelKey), d)).join(d);
  const body = rows.map((row) => columns.map((c) => accountingCsvCell((row as Record<string, unknown>)[c.key], d, c.numeric)).join(d));
  return `${CSV_BOM}${[header, ...body].join('\r\n')}\r\n`;
}

/** Generic JSON body: rows plus the query that produced them, so a script can tell what it holds. */
export interface AccountingJsonExport<Row> {
  kind: AccountingKind;
  from: string;
  to: string;
  branchId: string | null;
  rowCount: number;
  rows: Row[];
}

export function buildAccountingJson<Row>(kind: AccountingKind, range: { from: Date; to: Date }, branchId: string | null, rows: Row[]): AccountingJsonExport<Row> {
  return { kind, from: range.from.toISOString(), to: range.to.toISOString(), branchId, rowCount: rows.length, rows };
}
