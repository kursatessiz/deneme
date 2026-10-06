import { BadRequestException, ConflictException, HttpException, NotFoundException } from '@nestjs/common';
import type { RetailErrorCode } from '@platform/shared';
import { codedError } from '../../common/api-error';

const STATUS: Record<RetailErrorCode, { status: 400 | 404 | 409 }> = {
  RETAIL_PRODUCT_NOT_FOUND: { status: 404 },
  RETAIL_PRODUCT_INACTIVE: { status: 409 },
  RETAIL_INSUFFICIENT_STOCK: { status: 409 },
  RETAIL_NEGATIVE_STOCK: { status: 409 },
  RETAIL_UNTRACKED_PRODUCT: { status: 400 },
  RETAIL_CURRENCY_MISMATCH: { status: 400 },
  RETAIL_DUPLICATE_SKU: { status: 409 },
  RETAIL_DUPLICATE_BARCODE: { status: 409 },
  RETAIL_DUPLICATE_CATEGORY: { status: 409 },
  RETAIL_CATEGORY_NOT_FOUND: { status: 404 },
  RETAIL_BRANCH_NOT_FOUND: { status: 404 },
  RETAIL_SAME_BRANCH: { status: 400 },
  RETAIL_CUSTOMER_NOT_FOUND: { status: 404 },
  RETAIL_PROMO_REQUIRES_MEMBER: { status: 400 },
  RETAIL_SALE_NOT_FOUND: { status: 404 },
  RETAIL_SALE_NOT_REFUNDABLE: { status: 409 },
  RETAIL_REFUND_EXCEEDS_SOLD: { status: 400 },
  RETAIL_PAYMENT_CONFLICT: { status: 409 },
  RETAIL_SALE_HAS_REFUNDS: { status: 409 },
  RETAIL_PAYMENT_IS_RETAIL: { status: 409 },
};

/**
 * Retail errors carry a stable `code` (RETAIL_ERROR_CODES) next to the
 * translated message; clients translate `retail.error.<code>`.
 */
export function retailError(code: RetailErrorCode, extra: Record<string, unknown> = {}): HttpException {
  const { status } = STATUS[code];
  const body = codedError(code, { statusCode: status, ...extra });
  if (status === 404) return new NotFoundException(body);
  if (status === 409) return new ConflictException(body);
  return new BadRequestException(body);
}
