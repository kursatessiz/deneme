import { randomBytes } from 'node:crypto';

/** Unambiguous alphabet: no 0/O/1/I. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Short, shareable referral code, e.g. "K3F7QANB". */
export function generateReferralCode(length = 8): string {
  const bytes = randomBytes(length);
  let code = '';
  for (let i = 0; i < length; i++) {
    code += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return code;
}
