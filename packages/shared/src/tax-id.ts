import { z } from 'zod';

/**
 * Turkish tax identifier validation: TCKN (11-digit national ID, used by
 * private individuals) and VKN (10-digit tax number, used by companies and
 * sole proprietors). Both carry a checksum digit so a typo is caught before
 * it reaches an e-Arsiv/e-Fatura integrator. Kept in shared so the API, the
 * web panel and mobile all validate a tax number the same way.
 */

/**
 * TCKN checksum (published by the Ministry of the Interior / GIB):
 *   d10 = ((sum of digits at positions 1,3,5,7,9) * 7
 *          - (sum of digits at positions 2,4,6,8)) mod 10
 *   d11 = (sum of the first 10 digits) mod 10
 * The first digit may not be 0.
 */
export function isValidTckn(value: string): boolean {
  if (!/^\d{11}$/.test(value)) return false;
  if (value[0] === '0') return false;
  const d = value.split('').map(Number);
  const oddSum = d[0] + d[2] + d[4] + d[6] + d[8];
  const evenSum = d[1] + d[3] + d[5] + d[7];
  const d10 = (((oddSum * 7 - evenSum) % 10) + 10) % 10;
  if (d10 !== d[9]) return false;
  const first10Sum = d.slice(0, 10).reduce((a, b) => a + b, 0);
  const d11 = first10Sum % 10;
  return d11 === d[10];
}

/**
 * VKN checksum (GIB algorithm used across Turkish e-invoice/e-government
 * integrations): for each of the first 9 digits (0-indexed i), compute
 *   tmp = (digit + (9 - i)) mod 10
 *   piece = tmp === 9 ? 9 : (tmp * 2^(9 - i)) mod 9
 * and sum every piece; the 10th digit must equal (10 - (sum mod 10)) mod 10.
 */
export function isValidVkn(value: string): boolean {
  if (!/^\d{10}$/.test(value)) return false;
  const d = value.split('').map(Number);
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    const tmp = (d[i] + (9 - i)) % 10;
    const piece = tmp === 9 ? 9 : (tmp * Math.pow(2, 9 - i)) % 9;
    sum += piece;
  }
  const checkDigit = (10 - (sum % 10)) % 10;
  return checkDigit === d[9];
}

/** The GIB "generic consumer" TCKN e-Arsiv falls back to when a buyer has no tax number on file. */
export const EARSIV_GENERIC_CONSUMER_TCKN = '11111111111';

export const TcknSchema = z
  .string()
  .trim()
  .regex(/^\d{11}$/, 'TCKN 11 haneli olmalıdır')
  .refine(isValidTckn, 'Geçersiz TCKN');

export const VknSchema = z
  .string()
  .trim()
  .regex(/^\d{10}$/, 'VKN 10 haneli olmalıdır')
  .refine(isValidVkn, 'Geçersiz VKN');

/** Accepts either a 10-digit VKN or an 11-digit TCKN, checksum-validated. */
export const TaxNumberSchema = z.union([VknSchema, TcknSchema]);
