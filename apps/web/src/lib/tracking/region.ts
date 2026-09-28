import { complianceRegionOf } from '@platform/shared';
import type { ComplianceRegion } from '@platform/shared';

/**
 * How the consent banner behaves for a visitor (docs/CRM_VE_ATIF.md):
 * - opt_in (EU/EEA, UK, CA, and any visitor whose region is unknown):
 *   explicit accept/reject per category, nothing stored before consent,
 *   Google Consent Mode v2 defaults to denied.
 * - kvkk (TR): KVKK notice with accept/reject; also nothing before consent.
 * - notice (US and the rest): a notice; tracking runs, the Global Privacy
 *   Control signal (and the banner's opt-out) turns advertising off.
 */
export type ConsentMode = 'opt_in' | 'kvkk' | 'notice';

export interface ConsentRegion {
  region: ComplianceRegion;
  mode: ConsentMode;
  /** Where the region came from; `fallback` means unknown, so the strictest rules apply. */
  source: 'header' | 'language' | 'fallback';
}

export function consentModeOf(region: ComplianceRegion): ConsentMode {
  if (region === 'EU' || region === 'UK' || region === 'CA') return 'opt_in';
  if (region === 'TR') return 'kvkk';
  return 'notice';
}

function countryFromHeader(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const code = raw.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) && code !== 'XX' && code !== 'T1' ? code : null;
}

/** First region subtag in the Accept-Language list, by preference order ("tr-TR" -> TR). */
function countryFromAcceptLanguage(header: string | null | undefined): string | null {
  if (!header) return null;
  const tags = header
    .split(',')
    .map((part, index) => {
      const [tag, ...params] = part.trim().split(';');
      const qParam = params.find((p) => p.trim().startsWith('q='));
      const q = qParam ? Number(qParam.trim().slice(2)) : 1;
      return { tag: tag.trim(), q: Number.isFinite(q) ? q : 0, index };
    })
    .filter((t) => t.tag && t.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index);
  for (const { tag } of tags) {
    const region = tag.split('-')[1];
    if (region && /^[A-Za-z]{2}$/.test(region)) return region.toUpperCase();
  }
  return null;
}

/**
 * The visitor's consent region: the country header set by Cloudflare
 * (CF-IPCountry) or Caddy (X-Country-Code) if present, else the region of
 * the preferred Accept-Language, else the strictest behaviour (EU).
 */
export function resolveConsentRegion(input: {
  countryHeader?: string | null;
  acceptLanguage?: string | null;
}): ConsentRegion {
  const fromHeader = countryFromHeader(input.countryHeader);
  if (fromHeader) {
    const region = complianceRegionOf(fromHeader);
    return { region, mode: consentModeOf(region), source: 'header' };
  }
  const fromLanguage = countryFromAcceptLanguage(input.acceptLanguage);
  if (fromLanguage) {
    const region = complianceRegionOf(fromLanguage);
    return { region, mode: consentModeOf(region), source: 'language' };
  }
  return { region: 'EU', mode: 'opt_in', source: 'fallback' };
}
