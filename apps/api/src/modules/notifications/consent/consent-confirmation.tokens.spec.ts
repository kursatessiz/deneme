import { CONSENT_CONFIRMATION_DAILY_MAX } from '@platform/shared';
import {
  confirmationExpiresAt,
  hashConfirmationToken,
  isConfirmationUsable,
  isWellFormedConfirmationToken,
  newConfirmationToken,
  resendAllowed,
  resendWindowStart,
} from './consent-confirmation.tokens';

describe('double opt-in confirmation tokens', () => {
  it('are opaque, well formed and unique', () => {
    const tokens = new Set<string>();
    for (let i = 0; i < 200; i += 1) {
      const token = newConfirmationToken();
      expect(isWellFormedConfirmationToken(token)).toBe(true);
      tokens.add(token);
    }
    expect(tokens.size).toBe(200);
    expect(isWellFormedConfirmationToken('short')).toBe(false);
    expect(isWellFormedConfirmationToken(`${'a'.repeat(42)}/`)).toBe(false);
  });

  it('are stored only as a SHA-256 hash that does not contain the token', () => {
    const token = newConfirmationToken();
    const hash = hashConfirmationToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(hashConfirmationToken(token));
    expect(hash).not.toContain(token);
    expect(hashConfirmationToken(newConfirmationToken())).not.toBe(hash);
  });

  it('expire after 7 days and count once', () => {
    const now = new Date('2026-10-01T10:00:00.000Z');
    const expiresAt = confirmationExpiresAt(now);
    expect(expiresAt.toISOString()).toBe('2026-10-08T10:00:00.000Z');
    expect(isConfirmationUsable({ expiresAt, confirmedAt: null }, now)).toBe(true);
    expect(isConfirmationUsable({ expiresAt, confirmedAt: null }, new Date('2026-10-08T09:59:59.999Z'))).toBe(true);
    expect(isConfirmationUsable({ expiresAt, confirmedAt: null }, new Date('2026-10-08T10:00:00.000Z'))).toBe(false);
    expect(isConfirmationUsable({ expiresAt, confirmedAt: now }, now)).toBe(false);
  });

  it('allow three e-mails per contact in a rolling day', () => {
    const now = new Date('2026-10-01T10:00:00.000Z');
    expect(resendWindowStart(now).toISOString()).toBe('2026-09-30T10:00:00.000Z');
    expect(CONSENT_CONFIRMATION_DAILY_MAX).toBe(3);
    expect(resendAllowed(0)).toBe(true);
    expect(resendAllowed(2)).toBe(true);
    expect(resendAllowed(3)).toBe(false);
  });
});
