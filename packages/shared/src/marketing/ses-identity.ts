import { z } from 'zod';
import type { DnsRecordStatus, EmailSenderDomainDTO, ExpectedDnsRecordDTO } from '../integrations-hub';

/**
 * SES sender identity and Easy DKIM automation (M5, docs/PAZARLAMA_MODULU.md
 * 5.2). The super admin provisions a sender domain's SES identity through the
 * API instead of copying the DKIM tokens by hand, and the domain check reads
 * the identity's DKIM and verification status back from SES.
 */

/** SES `VerificationStatus` / `DkimAttributes.Status` values (API v2). */
export const SES_IDENTITY_STATUSES = ['PENDING', 'SUCCESS', 'FAILED', 'TEMPORARY_FAILURE', 'NOT_STARTED'] as const;
export type SesIdentityStatus = (typeof SES_IDENTITY_STATUSES)[number];

export const SesIdentityStatusSchema = z.enum(SES_IDENTITY_STATUSES);

/** SES answered by a real client (SES) or the deterministic stand-in used without credentials (MOCK). */
export const SES_PROVISION_PROVIDERS = ['SES', 'MOCK'] as const;
export type SesProvisionProvider = (typeof SES_PROVISION_PROVIDERS)[number];

/** Normalises whatever SES returned into a known status, or null when it is absent or unknown. */
export function parseSesIdentityStatus(value: unknown): SesIdentityStatus | null {
  const parsed = SesIdentityStatusSchema.safeParse(typeof value === 'string' ? value.toUpperCase() : value);
  return parsed.success ? parsed.data : null;
}

/**
 * The DKIM record status a domain shows for what SES reports: SUCCESS is
 * VALID, FAILED is INVALID, a status that says "not seen yet" is MISSING and
 * a temporary failure or an unknown answer is PENDING (SES could not tell).
 */
export function dnsStatusFromSesDkim(status: SesIdentityStatus | null): DnsRecordStatus {
  switch (status) {
    case 'SUCCESS':
      return 'VALID';
    case 'FAILED':
      return 'INVALID';
    case 'PENDING':
    case 'NOT_STARTED':
      return 'MISSING';
    default:
      return 'PENDING';
  }
}

/** FNV-1a 32 bit, the seed of the deterministic mock tokens. */
function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

const TOKEN_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';

/**
 * Three deterministic Easy DKIM tokens (32 characters, like SES's) for a
 * domain, used when no SES credentials are configured so the flow and the
 * tests are reproducible. Never valid on a real domain.
 */
export function mockDkimTokens(domain: string): string[] {
  return [1, 2, 3].map((index) => {
    let state = fnv1a(`${domain.toLowerCase()}#${index}`) || 1;
    let token = '';
    for (let i = 0; i < 32; i += 1) {
      // xorshift32
      state ^= state << 13;
      state >>>= 0;
      state ^= state >>> 17;
      state ^= state << 5;
      state >>>= 0;
      token += TOKEN_ALPHABET[state % TOKEN_ALPHABET.length];
    }
    return token;
  });
}

/** Result of POST /admin/marketing/sender-domains/:id/provision. */
export interface SesProvisionResultDTO {
  provider: SesProvisionProvider;
  /** True when the identity was created now, false when it already existed in SES and was only fetched. */
  created: boolean;
  domain: EmailSenderDomainDTO;
  /** The DNS records to publish at the domain's DNS host (the same list as domain.expectedRecords). */
  records: ExpectedDnsRecordDTO[];
}
