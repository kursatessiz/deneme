import { headers } from 'next/headers';
import { buildLocalizedSitemapEntries, buildSitemapXml } from '@platform/shared';
import { fetchSitemapEntries, studioSlugForHost } from '@/lib/sites/api';
import { sitePath } from '@/lib/sites/origin';

/**
 * Host-aware sitemap.xml: the platform site on its own domain, one per tenant site (a verified custom domain
 * lists its own host). One url per locale variant, each with the full hreflang set and x-default.
 * See docs/SAYFA_MOTORU.md and docs/SEO.md.
 */
export async function GET() {
  const h = await headers();
  const { studioSlug, isPlatform, origin } = await studioSlugForHost(h.get('host') ?? '');
  const { items, defaultLocale } = await fetchSitemapEntries(studioSlug);
  const pageEntries = buildLocalizedSitemapEntries(items, defaultLocale, (locale, slug) => `${origin}${sitePath(locale, slug)}`);
  // The product landing page at `/` is not a page-engine page (docs/SEO.md); only the platform host lists it.
  const entries = isPlatform ? [{ loc: `${origin}/` }, ...pageEntries] : pageEntries;
  const xml = buildSitemapXml(entries);
  return new Response(xml, { headers: { 'Content-Type': 'application/xml' } });
}
