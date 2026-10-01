import { headers } from 'next/headers';
import { studioSlugForHost } from './api';
import { siteOrigin } from './origin';

/**
 * Canonical origin for a page-engine page being rendered: the request host when it is a verified
 * custom domain of THIS studio, otherwise the default `<slug>.<base domain>` (or platform) origin.
 * The host is never trusted on its own: it must resolve to the studio through the API
 * (docs/SEO.md, "Ozel alan adi ve canonical").
 */
export async function requestSiteOrigin(studioSlug: string, isPlatform: boolean): Promise<string> {
  const host = (await headers()).get('host') ?? '';
  const site = await studioSlugForHost(host);
  if (site.isCustomDomain && !isPlatform && site.studioSlug === studioSlug) return site.origin;
  return siteOrigin(studioSlug, isPlatform);
}
