import { createHash, randomInt } from 'crypto';

/**
 * Unambiguous alphabet: no 0/O, 1/I/L, or lower-case, so a code read aloud or
 * copied off a receipt is never confused with another character.
 */
const GIFT_CARD_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const GIFT_CARD_CODE_LENGTH = 16;

/** A fresh, cryptographically random gift card code. Shown to the caller once, never stored in the clear. */
export function generateGiftCardCode(length: number = GIFT_CARD_CODE_LENGTH): string {
  let code = '';
  for (let i = 0; i < length; i++) {
    code += GIFT_CARD_ALPHABET[randomInt(GIFT_CARD_ALPHABET.length)];
  }
  return code;
}

/** Codes are looked up by this hash, so a balance check is a constant-time indexed equality lookup. */
export function hashGiftCardCode(code: string): string {
  return createHash('sha256').update(normalizeGiftCardCode(code)).digest('hex');
}

export function normalizeGiftCardCode(code: string): string {
  return code.trim().toUpperCase().replace(/[\s-]/g, '');
}

export function last4OfGiftCardCode(code: string): string {
  const normalized = normalizeGiftCardCode(code);
  return normalized.slice(-4);
}
