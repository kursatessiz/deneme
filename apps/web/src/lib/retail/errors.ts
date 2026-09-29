import { RETAIL_ERROR_CODES } from '@platform/shared';
import type { RetailErrorCode, Translate } from '@platform/shared';
import { BffError } from '@/lib/session/client';

function isRetailErrorCode(code: string | null): code is RetailErrorCode {
  return code !== null && (RETAIL_ERROR_CODES as readonly string[]).includes(code);
}

/**
 * User-facing text for a failed retail call: the translated stable error
 * code when the API sent one (`retail.error.<code>`), else the API message,
 * else the given fallback key.
 */
export function retailErrorMessage(t: Translate, err: unknown, fallbackKey = 'retail.actionFailed'): string {
  if (err instanceof BffError) {
    if (isRetailErrorCode(err.code)) return t(`retail.error.${err.code}`);
    return err.message || t(fallbackKey);
  }
  return t(fallbackKey);
}

/** A fresh idempotency key for one checkout attempt (reused on a retried submit). */
export function newCheckoutKey(): string {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `pos-${random}`;
}
