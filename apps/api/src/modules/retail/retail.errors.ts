import { BadRequestException, ConflictException, HttpException, NotFoundException } from '@nestjs/common';
import type { RetailErrorCode } from '@platform/shared';

const MESSAGES: Record<RetailErrorCode, { status: 400 | 404 | 409; message: string }> = {
  RETAIL_PRODUCT_NOT_FOUND: { status: 404, message: 'Ürün bulunamadı' },
  RETAIL_PRODUCT_INACTIVE: { status: 409, message: 'Ürün satışa kapalı' },
  RETAIL_INSUFFICIENT_STOCK: { status: 409, message: 'Stok yetersiz' },
  RETAIL_NEGATIVE_STOCK: { status: 409, message: 'Stok sıfırın altına düşemez' },
  RETAIL_UNTRACKED_PRODUCT: { status: 400, message: 'Bu ürünün stoku takip edilmiyor' },
  RETAIL_CURRENCY_MISMATCH: { status: 400, message: 'Para birimi işletmenin para birimiyle aynı olmalıdır' },
  RETAIL_DUPLICATE_SKU: { status: 409, message: 'Bu stok kodu başka bir üründe kullanılıyor' },
  RETAIL_DUPLICATE_BARCODE: { status: 409, message: 'Bu barkod başka bir üründe kullanılıyor' },
  RETAIL_DUPLICATE_CATEGORY: { status: 409, message: 'Bu adla bir kategori zaten var' },
  RETAIL_CATEGORY_NOT_FOUND: { status: 404, message: 'Kategori bulunamadı' },
  RETAIL_BRANCH_NOT_FOUND: { status: 404, message: 'Şube bulunamadı' },
  RETAIL_SAME_BRANCH: { status: 400, message: 'Kaynak ve hedef şube aynı olamaz' },
  RETAIL_CUSTOMER_NOT_FOUND: { status: 404, message: 'Müşteri bulunamadı' },
  RETAIL_PROMO_REQUIRES_MEMBER: { status: 400, message: 'Promosyon kodu yalnızca üyeye yapılan satışta kullanılabilir' },
  RETAIL_SALE_NOT_FOUND: { status: 404, message: 'Satış bulunamadı' },
  RETAIL_SALE_NOT_REFUNDABLE: { status: 409, message: 'Bu satış iade edilemez' },
  RETAIL_REFUND_EXCEEDS_SOLD: { status: 400, message: 'İade miktarı satılan ve henüz iade edilmemiş miktarı aşamaz' },
  RETAIL_PAYMENT_CONFLICT: { status: 409, message: 'Satışın ödemesi başka bir işlemde güncellendi, tekrar deneyin' },
  RETAIL_SALE_HAS_REFUNDS: { status: 409, message: 'İadesi olan satış iptal edilemez' },
  RETAIL_PAYMENT_IS_RETAIL: { status: 409, message: 'Bu ödeme bir ürün satışına aittir; iade satış ekranından yapılır' },
};

/**
 * Retail errors carry a stable `code` (RETAIL_ERROR_CODES) next to the
 * Turkish diagnostic message; clients translate `retail.error.<code>`.
 */
export function retailError(code: RetailErrorCode, extra: Record<string, unknown> = {}): HttpException {
  const { status, message } = MESSAGES[code];
  const body = { statusCode: status, code, message, ...extra };
  if (status === 404) return new NotFoundException(body);
  if (status === 409) return new ConflictException(body);
  return new BadRequestException(body);
}
