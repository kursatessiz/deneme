import { headers } from 'next/headers';
import { buildLocalizedSitemapEntries, buildSitemapXml } from '@platform/shared';
import { fetchPublicEvents } from '@/lib/events/api';
import { eventSegment } from '@/lib/events/paths';
import { fetchSitemapEntries, studioSlugForHost } from '@/lib/sites/api';
import { sitePath } from '@/lib/sites/origin';

/**
 * Host-aware sitemap.xml: the platform site on its own domain, one per tenant site (a verified custom domain
 * lists its own host). One url per locale variant, each with the full hreflang set and x-default.
 * A tenant site adds its public events (`/events` and one url per event).
 * See docs/SAYFA_MOTORU.md and docs/SEO.md.
 */
export async function GET() {
  const h = await headers();
  const { studioSlug, isPlatform, origin } = await studioSlugForHost(h.get('host') ?? '');
  const { items, defaultLocale } = await fetchSitemapEntries(studioSlug);
  // `/` is a redirect, never a listed page: on the platform host it is the x-default of the home page (docs/SEO.md).
  const entries = buildLocalizedSitemapEntries(
    items,
    defaultLocale,
    (locale, slug) => `${origin}${sitePath(locale, slug)}`,
    isPlatform ? { homeXDefaultUrl: `${origin}/` } : {},
  );
  // A tenant site also lists its public events: the list page when there is at least one, and each event
  // (same cached list read as the pages themselves, at most 100 events).
  if (!isPlatform) {
    const events = await fetchPublicEvents(studioSlug);
    if (events.length > 0) {
      entries.push({ loc: `${origin}/events` }, ...events.map((event) => ({ loc: `${origin}/events/${eventSegment(event)}` })));
    }
  }
  const xml = buildSitemapXml(entries);
  return new Response(xml, { headers: { 'Content-Type': 'application/xml' } });
}
