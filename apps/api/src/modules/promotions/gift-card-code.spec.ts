import {
  GIFT_CARD_CODE_LENGTH,
  generateGiftCardCode,
  hashGiftCardCode,
  last4OfGiftCardCode,
  normalizeGiftCardCode,
} from './gift-card-code';

describe('gift card code generation and hashing', () => {
  it('generates a code of the expected length using only unambiguous characters', () => {
    const code = generateGiftCardCode();
    expect(code).toHaveLength(GIFT_CARD_CODE_LENGTH);
    expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]+$/);
    expect(code).not.toMatch(/[0O1IL]/);
  });

  it('generates different codes on each call', () => {
    const codes = new Set(Array.from({ length: 200 }, () => generateGiftCardCode()));
    expect(codes.size).toBe(200);
  });

  it('hashes the same code (regardless of case or separators) to the same value', () => {
    const code = generateGiftCardCode();
    const hash1 = hashGiftCardCode(code);
    const hash2 = hashGiftCardCode(code.toLowerCase());
    const spaced = `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8, 12)}-${code.slice(12)}`;
    expect(hash1).toBe(hash2);
    expect(hashGiftCardCode(spaced)).toBe(hash1);
    expect(hash1).toHaveLength(64);
  });

  it('hashes different codes to different values', () => {
    expect(hashGiftCardCode('AAAAAAAAAAAAAAAA')).not.toBe(hashGiftCardCode('BBBBBBBBBBBBBBBB'));
  });

  it('normalizes to upper case without whitespace or dashes', () => {
    expect(normalizeGiftCardCode(' ab-cd 34 ')).toBe('ABCD34');
  });

  it('extracts the last 4 characters for display', () => {
    expect(last4OfGiftCardCode('ABCDEFGH2345')).toBe('2345');
  });
});
