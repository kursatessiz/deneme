import { createHash } from 'crypto';

/**
 * Identifier normalisation and hashing per the Meta Conversions API and
 * Google Ads enhanced conversions specs (docs/REKLAM_ENTEGRASYONU.md):
 * lowercase, trim, SHA-256, hex encoded. Both platforms agree on email;
 * they differ on phone (Meta wants E.164 digits with no "+", Google wants
 * the "+" kept), so there are two phone normalisers.
 */

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** Lowercased, trimmed email, or null for an empty/whitespace-only input. */
export function normalizeEmailForHashing(email: string | null | undefined): string | null {
  const trimmed = (email ?? '').trim().toLowerCase();
  return trimmed ? trimmed : null;
}

export function hashEmail(email: string | null | undefined): string | null {
  const normalized = normalizeEmailForHashing(email);
  return normalized ? sha256Hex(normalized) : null;
}

/** Meta wants E.164 digits with no leading "+" (e.g. "905321112233"). */
export function normalizePhoneForMeta(e164Phone: string | null | undefined): string | null {
  const digits = (e164Phone ?? '').replace(/[^0-9]/g, '');
  return digits ? digits : null;
}

export function hashPhoneForMeta(e164Phone: string | null | undefined): string | null {
  const normalized = normalizePhoneForMeta(e164Phone);
  return normalized ? sha256Hex(normalized) : null;
}

/** Google wants E.164 with the leading "+" kept (e.g. "+905321112233"). */
export function normalizePhoneForGoogle(e164Phone: string | null | undefined): string | null {
  const trimmed = (e164Phone ?? '').trim();
  if (!trimmed) return null;
  const digits = trimmed.replace(/[^0-9]/g, '');
  return digits ? `+${digits}` : null;
}

export function hashPhoneForGoogle(e164Phone: string | null | undefined): string | null {
  const normalized = normalizePhoneForGoogle(e164Phone);
  return normalized ? sha256Hex(normalized) : null;
}

export function hashName(name: string | null | undefined): string | null {
  const trimmed = (name ?? '').trim().toLowerCase();
  return trimmed ? sha256Hex(trimmed) : null;
}

export function hashExternalId(contactId: string): string {
  return sha256Hex(contactId);
}
