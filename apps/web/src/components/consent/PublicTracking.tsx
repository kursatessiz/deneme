import { headers } from 'next/headers';
import { resolveConsentRegion } from '@/lib/tracking/region';
import { TrackingProvider } from './TrackingProvider';

/**
 * Server entry point for public pages: resolves the visitor's consent
 * region from the edge country header (CF-IPCountry / X-Country-Code) or
 * Accept-Language, then mounts the client-side consent banner and tracker.
 */
export async function PublicTracking({ studioSlug, deferRegion }: { studioSlug: string; deferRegion?: boolean }) {
  // Cacheable pages (ISR, docs/SEO.md) cannot read request headers: the browser asks /api/consent-region instead.
  if (deferRegion) return <TrackingProvider studioSlug={studioSlug} region={null} />;
  const h = await headers();
  const region = resolveConsentRegion({
    countryHeader: h.get('cf-ipcountry') ?? h.get('x-country-code'),
    acceptLanguage: h.get('accept-language'),
  });
  return <TrackingProvider studioSlug={studioSlug} region={region} />;
}
