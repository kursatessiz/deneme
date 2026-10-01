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
  const { studioSlug, origin } = await studioSlugForHost(h.get('host') ?? '');
  const { items, defaultLocale } = await fetchSitemapEntries(studioSlug);
  const xml = buildSitemapXml(buildLocalizedSitemapEntries(items, defaultLocale, (locale, slug) => `${origin}${sitePath(locale, slug)}`));
  return new Response(xml, { headers: { 'Content-Type': 'application/xml' } });
}
