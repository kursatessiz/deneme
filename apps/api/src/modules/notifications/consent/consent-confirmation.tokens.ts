import { createHash, randomBytes } from 'crypto';
import { CONSENT_CONFIRMATION_DAILY_MAX, CONSENT_CONFIRMATION_TOKEN_PATTERN, CONSENT_CONFIRMATION_TTL_DAYS } from '@platform/shared';

const DAY_MS = 24 * 60 * 60 * 1000;

/** A new opaque confirmation token: 32 random bytes, base64url (43 characters). Only its hash is stored. */
export function newConfirmationToken(): string {
  return randomBytes(32).toString('base64url');
}

/** SHA-256 hex of the token; the value kept at rest and looked up on confirmation. */
export function hashConfirmationToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function isWellFormedConfirmationToken(token: string): boolean {
  return CONSENT_CONFIRMATION_TOKEN_PATTERN.test(token);
}

export function confirmationExpiresAt(now: Date): Date {
  return new Date(now.getTime() + CONSENT_CONFIRMATION_TTL_DAYS * DAY_MS);
}

/** A link counts only once and only before it expires. */
export function isConfirmationUsable(row: { expiresAt: Date; confirmedAt: Date | null }, now: Date): boolean {
  return row.confirmedAt === null && row.expiresAt.getTime() > now.getTime();
}

/** Start of the rolling 24 hour window of the resend limit. */
export function resendWindowStart(now: Date): Date {
  return new Date(now.getTime() - DAY_MS);
}

export function resendAllowed(sentInWindow: number): boolean {
  return sentInWindow < CONSENT_CONFIRMATION_DAILY_MAX;
}
