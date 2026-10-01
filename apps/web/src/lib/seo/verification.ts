import type { Metadata } from 'next';
import type { PublicSiteSettingsDTO } from '@platform/shared';

/**
 * Search Console and Bing Webmaster Tools site verification as page metadata: `<meta name="google-site-verification">`
 * and `<meta name="msvalidate.01">` (docs/SEO.md "Arama motoru doğrulaması"). The tokens are per-site settings (the
 * platform's own for the platform site, the tenant's for a tenant site); undefined when neither is set.
 */
export function verificationMetadata(settings: Pick<PublicSiteSettingsDTO, 'googleSiteVerification' | 'bingSiteVerification'>): Metadata['verification'] | undefined {
  const { googleSiteVerification, bingSiteVerification } = settings;
  if (!googleSiteVerification && !bingSiteVerification) return undefined;
  return {
    ...(googleSiteVerification ? { google: googleSiteVerification } : {}),
    ...(bingSiteVerification ? { other: { 'msvalidate.01': bingSiteVerification } } : {}),
  };
}
