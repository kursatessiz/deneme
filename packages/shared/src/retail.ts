import { z } from 'zod';
import { currencyMinorUnitDigits } from './growth/regions';

/**
 * Retail and stock (G3c-2, docs/PERAKENDE.md): physical products and simple
 * add-ons sold at the desk (water, towels, grip socks, rackets, books...).
 * Product names, categories, prices and tax rates are tenant data (CLAUDE.md
 * rule 7); this file only names what the API knows how to do with them,
 * plus the pure money helpers the API, web and mobile share.
 */

// ---------------------------------------------------------------------------
// Catalogues
// ---------------------------------------------------------------------------

/** Why a stock ledger row exists. TRANSFER writes two rows (minus at the source, plus at the target). */
export const STOCK_MOVEMENT_TYPES = ['RECEIVE', 'SALE', 'RETURN', 'ADJUSTMENT', 'TRANSFER'] as const;
export type StockMovementType = (typeof STOCK_MOVEMENT_TYPES)[number];

export const SALE_STATUSES = ['COMPLETED', 'PARTIALLY_REFUNDED', 'REFUNDED', 'VOID'] as const;
export type SaleStatus = (typeof SALE_STATUSES)[number];

/** Desk sales are paid on the spot; online and pending methods stay with package sales. */
export const RETAIL_PAYMENT_METHODS = ['CASH', 'CREDIT_CARD_POS'] as const;
export type RetailPaymentMethod = (typeof RETAIL_PAYMENT_METHODS)[number];

/** Stable error codes the API sends in the body (`code`); clients translate `retail.error.<code>`. */
export const RETAIL_ERROR_CODES = [
  'RETAIL_PRODUCT_NOT_FOUND',
  'RETAIL_PRODUCT_INACTIVE',
  'RETAIL_INSUFFICIENT_STOCK',
  'RETAIL_NEGATIVE_STOCK',
  'RETAIL_UNTRACKED_PRODUCT',
  'RETAIL_CURRENCY_MISMATCH',
  'RETAIL_DUPLICATE_SKU',
  'RETAIL_DUPLICATE_BARCODE',
  'RETAIL_DUPLICATE_CATEGORY',
  'RETAIL_CATEGORY_NOT_FOUND',
  'RETAIL_BRANCH_NOT_FOUND',
  'RETAIL_SAME_BRANCH',
  'RETAIL_CUSTOMER_NOT_FOUND',
  'RETAIL_PROMO_REQUIRES_MEMBER',
  'RETAIL_SALE_NOT_FOUND',
  'RETAIL_SALE_NOT_REFUNDABLE',
  'RETAIL_REFUND_EXCEEDS_SOLD',
  'RETAIL_PAYMENT_CONFLICT',
  'RETAIL_SALE_HAS_REFUNDS',
  'RETAIL_PAYMENT_IS_RETAIL',
] as const;
export type RetailErrorCode = (typeof RETAIL_ERROR_CODES)[number];

export const RETAIL_MAX_QUANTITY = 100_000;
export const RETAIL_MAX_CART_LINES = 100;

// ---------------------------------------------------------------------------
// Money helpers (pure). Amounts travel as decimal strings; arithmetic runs on
// integer minor units in BigInt so no binary float ever touches money.
// ---------------------------------------------------------------------------

/**
 * Minor-unit digits used for retail amounts: the currency's own digits,
 * capped at 2 because every money column in the schema is Decimal(x, 2)
 * (three-decimal currencies are rounded to two, same as payments).
 */
export function retailMinorDigits(currency: string): 0 | 2 {
  return currencyMinorUnitDigits(currency) === 0 ? 0 : 2;
}

const DECIMAL_RE = /^(-?)(\d+)(?:\.(\d+))?$/;

/** Rounds `numer / denom` half away from zero (denom > 0). */
export function roundDivHalfUp(numer: bigint, denom: bigint): bigint {
  if (denom <= 0n) throw new Error('denom must be positive');
  const negative = numer < 0n;
  const abs = negative ? -numer : numer;
  const q = (abs * 2n + denom) / (denom * 2n);
  return negative ? -q : q;
}

/** Parses a decimal string (or number) into minor units of the currency, rounding half-up to its digits. */
export function toRetailMinor(amount: string | number, currency: string): bigint {
  const text = typeof amount === 'number' ? String(amount) : amount.trim();
  const match = DECIMAL_RE.exec(text);
  if (!match) throw new Error(`Geçersiz tutar: ${text}`);
  const [, sign, whole, fraction = ''] = match;
  const digits = retailMinorDigits(currency);
  const scale = 10n ** BigInt(fraction.length);
  const raw = BigInt(whole) * scale + (fraction ? BigInt(fraction) : 0n);
  const minor = roundDivHalfUp(raw * 10n ** BigInt(digits), scale);
  return sign === '-' ? -minor : minor;
}

/** Formats minor units back to a two-decimal string ("12.50", "300.00" for JPY 300). */
export function fromRetailMinor(minor: bigint, currency: string): string {
  const digits = retailMinorDigits(currency);
  const cents = digits === 2 ? minor : minor * 100n;
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  return `${negative ? '-' : ''}${abs / 100n}.${(abs % 100n).toString().padStart(2, '0')}`;
}

/** A tax percentage ("20", "8.25", 10) in hundredths of a percent: 20 -> 2000. */
export function taxRateToBasisPoints(rate: string | number): bigint {
  const text = typeof rate === 'number' ? String(rate) : rate.trim();
  const match = DECIMAL_RE.exec(text);
  if (!match || match[1] === '-') throw new Error(`Geçersiz vergi oranı: ${text}`);
  const [, , whole, fraction = ''] = match;
  const scale = 10n ** BigInt(fraction.length);
  const raw = BigInt(whole) * scale + (fraction ? BigInt(fraction) : 0n);
  return roundDivHalfUp(raw * 100n, scale);
}

/** Splits `total` over `weights` proportionally (largest remainder), so the parts always add up to `total`. */
export function allocateProportionally(total: bigint, weights: readonly bigint[]): bigint[] {
  const sum = weights.reduce((a, b) => a + b, 0n);
  if (weights.length === 0) return [];
  if (sum <= 0n || total === 0n) return weights.map(() => 0n);
  const parts = weights.map((w) => (total * w) / sum);
  let rest = total - parts.reduce((a, b) => a + b, 0n);
  const order = weights
    .map((w, i) => ({ i, remainder: (total * w) % sum }))
    .sort((a, b) => (a.remainder === b.remainder ? a.i - b.i : a.remainder > b.remainder ? -1 : 1));
  for (const { i } of order) {
    if (rest <= 0n) break;
    parts[i] += 1n;
    rest -= 1n;
  }
  return parts;
}

export interface CartLineInput {
  /** List price per unit, decimal string in the sale currency. */
  unitPrice: string;
  quantity: number;
  /** Staff discount for the whole line (not per unit), decimal string; capped at the line amount. */
  discount?: string;
  /** Tax percentage for this line, e.g. "20". */
  taxRate: string;
}

export interface CartInput {
  currency: string;
  /** Studio setting: list prices already contain tax (TR/EU style) or tax is added on top (US style). */
  pricesIncludeTax: boolean;
  lines: readonly CartLineInput[];
  /** A cart-wide discount (promo code), spread over the lines in proportion to their amount. */
  orderDiscount?: string;
}

export interface CartLineTotals {
  /** unitPrice x quantity. */
  listAmount: string;
  lineDiscount: string;
  orderDiscount: string;
  netAmount: string;
  taxAmount: string;
  /** What the customer pays for this line. */
  total: string;
}

export interface CartTotals {
  currency: string;
  lines: CartLineTotals[];
  /** Sum of list amounts. */
  subtotal: string;
  /** Line discounts plus the cart-wide discount. */
  discountTotal: string;
  /** Amount after line discounts, before the cart-wide discount: the base a promo code is computed on. */
  discountableAmount: string;
  netTotal: string;
  taxTotal: string;
  total: string;
}

/**
 * Line and cart totals for a desk sale. Per line: list amount minus the
 * staff discount, minus its share of the cart-wide discount; then tax is
 * either extracted (tax-inclusive prices: net = gross / (1 + rate)) or
 * added (net x rate), rounded half-up to the currency's minor unit on each
 * line so line totals always add up exactly to the cart total.
 */
export function computeCartTotals(input: CartInput): CartTotals {
  const { currency } = input;
  const bases = input.lines.map((line) => {
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) throw new Error('Geçersiz miktar');
    const list = toRetailMinor(line.unitPrice, currency) * BigInt(line.quantity);
    if (list < 0n) throw new Error('Geçersiz fiyat');
    let discount = line.discount ? toRetailMinor(line.discount, currency) : 0n;
    if (discount < 0n) discount = 0n;
    if (discount > list) discount = list;
    return { list, discount, after: list - discount, bp: taxRateToBasisPoints(line.taxRate) };
  });
  const discountable = bases.reduce((sum, b) => sum + b.after, 0n);
  let orderDiscount = input.orderDiscount ? toRetailMinor(input.orderDiscount, currency) : 0n;
  if (orderDiscount < 0n) orderDiscount = 0n;
  if (orderDiscount > discountable) orderDiscount = discountable;
  const shares = allocateProportionally(
    orderDiscount,
    bases.map((b) => b.after),
  );

  let subtotal = 0n;
  let discountTotal = 0n;
  let netTotal = 0n;
  let taxTotal = 0n;
  let total = 0n;
  const lines: CartLineTotals[] = bases.map((b, i) => {
    const amount = b.after - shares[i];
    let net: bigint;
    let tax: bigint;
    let gross: bigint;
    if (input.pricesIncludeTax) {
      gross = amount;
      net = roundDivHalfUp(gross * 10000n, 10000n + b.bp);
      tax = gross - net;
    } else {
      net = amount;
      tax = roundDivHalfUp(net * b.bp, 10000n);
      gross = net + tax;
    }
    subtotal += b.list;
    discountTotal += b.discount + shares[i];
    netTotal += net;
    taxTotal += tax;
    total += gross;
    return {
      listAmount: fromRetailMinor(b.list, currency),
      lineDiscount: fromRetailMinor(b.discount, currency),
      orderDiscount: fromRetailMinor(shares[i], currency),
      netAmount: fromRetailMinor(net, currency),
      taxAmount: fromRetailMinor(tax, currency),
      total: fromRetailMinor(gross, currency),
    };
  });

  return {
    currency,
    lines,
    subtotal: fromRetailMinor(subtotal, currency),
    discountTotal: fromRetailMinor(discountTotal, currency),
    discountableAmount: fromRetailMinor(discountable, currency),
    netTotal: fromRetailMinor(netTotal, currency),
    taxTotal: fromRetailMinor(taxTotal, currency),
    total: fromRetailMinor(total, currency),
  };
}

/**
 * Amount returned when `quantity` more units of a sold line are refunded.
 * Proportional to the line total; the refund that brings the line to fully
 * refunded gets exactly what is left, so rounding never loses or adds a cent.
 */
export function lineRefundAmount(params: {
  lineTotal: string;
  lineQuantity: number;
  refundedQuantity: number;
  refundedAmount: string;
  quantity: number;
  currency: string;
}): string {
  const { currency } = params;
  const total = toRetailMinor(params.lineTotal, currency);
  const already = toRetailMinor(params.refundedAmount, currency);
  if (params.quantity <= 0 || params.refundedQuantity + params.quantity > params.lineQuantity) {
    throw new Error('Geçersiz iade miktarı');
  }
  if (params.refundedQuantity + params.quantity === params.lineQuantity) {
    return fromRetailMinor(total - already, currency);
  }
  const amount = roundDivHalfUp(total * BigInt(params.quantity), BigInt(params.lineQuantity));
  const capped = amount > total - already ? total - already : amount;
  return fromRetailMinor(capped, currency);
}

/** Default tax rate for a product without its own: none under the NONE regime, else the invoicing default (0 if unset). */
export function defaultRetailTaxRate(taxRegime: string, invoiceDefaultVatRate: string | null): string {
  if (taxRegime === 'NONE') return '0';
  return invoiceDefaultVatRate ?? '0';
}

/** Per-studio receipt number: prefix + zero-padded sequence, e.g. "S000042". */
export function formatReceiptNumber(prefix: string, sequence: number): string {
  return `${prefix}${String(sequence).padStart(6, '0')}`;
}

/** A tracked product is low when a threshold is set and stock is at or below it. */
export function isLowStock(quantity: number, threshold: number | null | undefined): boolean {
  return threshold !== null && threshold !== undefined && quantity <= threshold;
}

/** Status a sale moves to after a refund, from its line quantities. */
export function saleStatusAfterRefund(lines: readonly { quantity: number; refundedQuantity: number }[]): SaleStatus {
  const sold = lines.reduce((s, l) => s + l.quantity, 0);
  const refunded = lines.reduce((s, l) => s + l.refundedQuantity, 0);
  if (refunded <= 0) return 'COMPLETED';
  return refunded >= sold ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const MoneyStringSchema = z
  .string()
  .trim()
  .regex(/^\d{1,10}(\.\d{1,2})?$/, 'Geçersiz tutar');
const CurrencySchema = z.string().regex(/^[A-Z]{3}$/, 'Geçersiz para birimi');
const TaxRateSchema = z
  .number()
  .min(0)
  .max(100)
  .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-9, { message: 'Vergi oranı en fazla iki ondalık basamak içerebilir' });
const OptionalText = (max: number) => z.string().trim().min(1).max(max).nullable().optional();

export const RetailSettingsSchema = z
  .object({
    /** Whether tracked products may be sold below zero stock. Off by default. */
    allowBackorder: z.boolean().optional(),
    receiptPrefix: z
      .string()
      .trim()
      .regex(/^[A-Z0-9-]{1,10}$/, 'Fiş öneki yalnızca büyük harf, rakam ve tire içerebilir')
      .optional(),
  })
  .strict();
export type RetailSettingsInput = z.infer<typeof RetailSettingsSchema>;

export const CreateProductCategorySchema = z
  .object({
    name: z.string().trim().min(1, 'Ad giriniz').max(80),
    sortOrder: z.number().int().min(0).max(10_000).default(0),
    isActive: z.boolean().default(true),
  })
  .strict();
export type CreateProductCategoryInput = z.infer<typeof CreateProductCategorySchema>;

export const UpdateProductCategorySchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    sortOrder: z.number().int().min(0).max(10_000).optional(),
    isActive: z.boolean().optional(),
  })
  .strict();
export type UpdateProductCategoryInput = z.infer<typeof UpdateProductCategorySchema>;

const ProductFields = {
  name: z.string().trim().min(1, 'Ad giriniz').max(120),
  categoryId: z.string().uuid().nullable().optional(),
  sku: OptionalText(60),
  barcode: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9-]{1,64}$/, 'Geçersiz barkod')
    .nullable()
    .optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  price: MoneyStringSchema,
  /** Defaults to the studio currency; any other currency is refused (rule 8). */
  currency: CurrencySchema.optional(),
  /** Tax percentage; null uses the studio default (see defaultRetailTaxRate). */
  taxRate: TaxRateSchema.nullable().optional(),
  /** Purchase cost per unit, for margin. */
  costPrice: MoneyStringSchema.nullable().optional(),
  isActive: z.boolean().optional(),
  trackStock: z.boolean().optional(),
  lowStockThreshold: z.number().int().min(0).max(RETAIL_MAX_QUANTITY).nullable().optional(),
  imageUrl: z.string().trim().url().max(500).startsWith('https://', 'Görsel adresi https ile başlamalıdır').nullable().optional(),
};

export const CreateProductSchema = z.object(ProductFields).strict();
export type CreateProductInput = z.infer<typeof CreateProductSchema>;

export const UpdateProductSchema = z
  .object({ ...ProductFields, name: ProductFields.name.optional(), price: MoneyStringSchema.optional() })
  .strict();
export type UpdateProductInput = z.infer<typeof UpdateProductSchema>;

export const ListProductsQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  barcode: z.string().trim().max(64).optional(),
  categoryId: z.string().uuid().optional(),
  active: z.enum(['true', 'false', 'all']).default('all'),
  /** Stock is reported for this branch only; omitted reports every accessible branch. */
  branchId: z.string().uuid().optional(),
});
export type ListProductsQuery = z.infer<typeof ListProductsQuerySchema>;

const Quantity = z.number().int().min(1).max(RETAIL_MAX_QUANTITY);

export const ReceiveStockSchema = z
  .object({
    productId: z.string().uuid(),
    branchId: z.string().uuid(),
    quantity: Quantity,
    unitCost: MoneyStringSchema.optional(),
    reason: z.string().trim().max(200).optional(),
    reference: z.string().trim().max(120).optional(),
  })
  .strict();
export type ReceiveStockInput = z.infer<typeof ReceiveStockSchema>;

export const AdjustStockSchema = z
  .object({
    productId: z.string().uuid(),
    branchId: z.string().uuid(),
    /** Signed change, e.g. -2 for two broken bottles. */
    delta: z.number().int().min(-RETAIL_MAX_QUANTITY).max(RETAIL_MAX_QUANTITY).refine((v) => v !== 0, 'Değişim sıfır olamaz').optional(),
    /** Stock count: the quantity found on the shelf. */
    countedQuantity: z.number().int().min(0).max(RETAIL_MAX_QUANTITY).optional(),
    reason: z.string().trim().min(3, 'Neden giriniz').max(200),
  })
  .strict()
  .refine((v) => (v.delta === undefined) !== (v.countedQuantity === undefined), {
    message: 'Değişim veya sayım miktarından yalnızca biri girilmelidir',
    path: ['delta'],
  });
export type AdjustStockInput = z.infer<typeof AdjustStockSchema>;

export const TransferStockSchema = z
  .object({
    productId: z.string().uuid(),
    fromBranchId: z.string().uuid(),
    toBranchId: z.string().uuid(),
    quantity: Quantity,
    reason: z.string().trim().max(200).optional(),
  })
  .strict();
export type TransferStockInput = z.infer<typeof TransferStockSchema>;

const Paging = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
};

export const StockMovementsQuerySchema = z.object({
  productId: z.string().uuid().optional(),
  branchId: z.string().uuid().optional(),
  type: z.enum(STOCK_MOVEMENT_TYPES).optional(),
  ...Paging,
});
export type StockMovementsQuery = z.infer<typeof StockMovementsQuerySchema>;

export const CheckoutSchema = z
  .object({
    branchId: z.string().uuid(),
    /** Member buying (optional): links a payment record, promo codes and loyalty points. */
    memberId: z.string().uuid().optional(),
    /** CRM contact of a walk-in customer (optional). */
    contactId: z.string().uuid().optional(),
    lines: z
      .array(
        z
          .object({
            productId: z.string().uuid(),
            quantity: Quantity,
            /** Staff discount for the whole line. */
            discount: MoneyStringSchema.optional(),
          })
          .strict(),
      )
      .min(1, 'Sepet boş')
      .max(RETAIL_MAX_CART_LINES),
    paymentMethod: z.enum(RETAIL_PAYMENT_METHODS),
    promoCode: z.string().trim().min(3).max(40).optional(),
    note: z.string().trim().max(500).optional(),
    /** Client-generated key: a retried submit returns the first sale instead of selling twice. */
    idempotencyKey: z.string().trim().min(8).max(64).optional(),
  })
  .strict();
export type CheckoutInput = z.infer<typeof CheckoutSchema>;

export const SalesQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  branchId: z.string().uuid().optional(),
  status: z.enum(SALE_STATUSES).optional(),
  memberId: z.string().uuid().optional(),
  receipt: z.string().trim().max(30).optional(),
  ...Paging,
});
export type SalesQuery = z.infer<typeof SalesQuerySchema>;

export const RefundSaleSchema = z
  .object({
    /** Lines and quantities to refund; omitted refunds everything not refunded yet. */
    lines: z
      .array(
        z
          .object({
            saleLineId: z.string().uuid(),
            quantity: Quantity,
            /** Put the units back on the shelf (RETURN movement). False for damaged goods. */
            restock: z.boolean().default(true),
          })
          .strict(),
      )
      .min(1)
      .max(RETAIL_MAX_CART_LINES)
      .optional(),
    reason: z.string().trim().min(3, 'Neden giriniz').max(300),
  })
  .strict();
export type RefundSaleInput = z.infer<typeof RefundSaleSchema>;

export const VoidSaleSchema = z.object({ reason: z.string().trim().min(3, 'Neden giriniz').max(300) }).strict();
export type VoidSaleInput = z.infer<typeof VoidSaleSchema>;

export const RetailReportViewSchema = z.object({
  /** Which table the CSV export holds. */
  view: z.enum(['product', 'day']).default('product'),
});
export type RetailReportViewQuery = z.infer<typeof RetailReportViewSchema>;

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

export interface RetailSettingsDTO {
  allowBackorder: boolean;
  receiptPrefix: string;
  currency: string;
  pricesIncludeTax: boolean;
  taxRegime: string;
  /** Rate a product without its own tax rate uses. */
  defaultTaxRate: string;
}

export interface ProductCategoryDTO {
  id: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
  productCount: number;
}

export interface ProductStockDTO {
  branchId: string;
  branchName: string;
  quantity: number;
}

export interface ProductDTO {
  id: string;
  name: string;
  categoryId: string | null;
  categoryName: string | null;
  sku: string | null;
  barcode: string | null;
  description: string | null;
  price: string;
  currency: string;
  /** Own rate, or null when the studio default applies. */
  taxRate: string | null;
  effectiveTaxRate: string;
  costPrice: string | null;
  isActive: boolean;
  trackStock: boolean;
  lowStockThreshold: number | null;
  imageUrl: string | null;
  stock: ProductStockDTO[];
  totalStock: number;
  lowStock: boolean;
}

export interface StockMovementDTO {
  id: string;
  productId: string;
  productName: string;
  branchId: string;
  branchName: string;
  type: StockMovementType;
  quantity: number;
  quantityAfter: number;
  reason: string | null;
  reference: string | null;
  unitCost: string | null;
  saleId: string | null;
  actorName: string | null;
  createdAt: string;
}

export interface SaleLineDTO {
  id: string;
  productId: string;
  productName: string;
  sku: string | null;
  quantity: number;
  unitPrice: string;
  lineDiscount: string;
  orderDiscount: string;
  taxRate: string;
  netAmount: string;
  taxAmount: string;
  total: string;
  refundedQuantity: number;
  refundedAmount: string;
}

export interface SaleRefundDTO {
  id: string;
  amount: string;
  reason: string;
  actorName: string | null;
  createdAt: string;
  lines: { saleLineId: string; quantity: number; amount: string; restocked: boolean }[];
}

export interface SaleDTO {
  id: string;
  receiptNumber: string;
  status: SaleStatus;
  branchId: string;
  branchName: string;
  memberId: string | null;
  contactId: string | null;
  customerName: string | null;
  currency: string;
  pricesIncludeTax: boolean;
  subtotal: string;
  discountTotal: string;
  netTotal: string;
  taxTotal: string;
  total: string;
  refundedAmount: string;
  paymentMethod: RetailPaymentMethod;
  paymentId: string | null;
  promoCode: string | null;
  promoDiscount: string;
  note: string | null;
  soldByName: string | null;
  createdAt: string;
  lines: SaleLineDTO[];
  refunds: SaleRefundDTO[];
}

export interface SaleListItemDTO {
  id: string;
  receiptNumber: string;
  status: SaleStatus;
  branchName: string;
  customerName: string | null;
  currency: string;
  total: string;
  refundedAmount: string;
  paymentMethod: RetailPaymentMethod;
  itemCount: number;
  createdAt: string;
}

export interface LowStockItemDTO {
  productId: string;
  productName: string;
  sku: string | null;
  branchId: string;
  branchName: string;
  quantity: number;
  lowStockThreshold: number;
}

export interface RetailSalesReportDTO {
  from: string;
  to: string;
  currency: string;
  totals: {
    saleCount: number;
    itemCount: number;
    gross: string;
    refunded: string;
    net: string;
    tax: string;
    cost: string;
    margin: string;
  };
  byProduct: {
    productId: string;
    productName: string;
    quantity: number;
    refundedQuantity: number;
    revenue: string;
    cost: string;
    margin: string;
  }[];
  byDay: { date: string; saleCount: number; gross: string; refunded: string }[];
}
