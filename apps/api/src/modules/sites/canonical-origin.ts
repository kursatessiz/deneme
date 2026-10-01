import { originForPlatformHost, pickCanonicalHost } from '@platform/shared';
import { sitesBaseDomain } from './sites.service';

/**
 * The one origin a site's canonical URLs, sitemap-independent notifications (IndexNow) and badge links use,
 * independent of the request host: see `pickCanonicalHost` in @platform/shared and docs/SEO.md "ISR".
 */
export function canonicalOriginOf(input: {
  isPlatform: boolean;
  slug: string;
  primaryDomain: string | null;
  domains: ReadonlyArray<{ domain: string; status: string; verifiedAt: Date | null }>;
}): string {
  const host = pickCanonicalHost({
    isPlatform: input.isPlatform,
    slug: input.slug,
    baseDomain: sitesBaseDomain(),
    primaryDomain: input.primaryDomain,
    verifiedDomains: input.domains.filter((d) => d.status === 'VERIFIED').map((d) => ({ domain: d.domain, verifiedAt: d.verifiedAt?.getTime() ?? 0 })),
  });
  return originForPlatformHost(host);
}
