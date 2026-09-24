/**
 * Users are identified globally by phone number, so every phone must be
 * stored in one canonical form (E.164). Turkish local formats are accepted:
 * 05321112233, 5321112233, 0090 532 111 22 33, +90 (532) 111-22-33.
 * Returns null when the input cannot be a valid number.
 */
export function normalizePhone(input: string, defaultCountryCode = '90'): string | null {
  const trimmed = input.trim();
  let digits = trimmed.replace(/[^\d]/g, '');
  if (!digits) return null;

  if (trimmed.startsWith('+')) {
    // already international
  } else if (digits.startsWith('00')) {
    digits = digits.slice(2);
  } else if (digits.startsWith('0')) {
    digits = defaultCountryCode + digits.slice(1);
  } else if (defaultCountryCode === '90' && digits.length === 10 && digits.startsWith('5')) {
    digits = defaultCountryCode + digits;
  }

  // Turkish mobile numbers: +90 5XX XXX XX XX
  if (digits.startsWith('90') && !/^905\d{9}$/.test(digits) && !/^90[2-4]\d{9}$/.test(digits)) {
    return null;
  }
  if (digits.length < 8 || digits.length > 15) return null;
  return `+${digits}`;
}
