import { randomInt } from 'node:crypto';

/** Unambiguous alphabet: no 0/O/1/I. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Short, shareable referral code, e.g. "K3F7QANB". randomInt is unbiased. */
export function generateReferralCode(length = 8): string {
  let code = '';
  for (let i = 0; i < length; i++) {
    code += ALPHABET[randomInt(ALPHABET.length)];
  }
  return code;
}
