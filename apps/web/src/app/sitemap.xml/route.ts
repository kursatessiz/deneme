import { headers } from 'next/headers';
import { buildSitemapXml } from '@platform/shared';
import { fetchSitemapEntries, studioSlugForHost } from '@/lib/sites/api';
import { siteOrigin, sitePath } from '@/components/sites/SitePage';

/** Host-aware sitemap.xml: the platform site on its own domain, one per tenant site. See docs/SAYFA_MOTORU.md. */
export async function GET() {
  const h = await headers();
  const { studioSlug, isPlatform } = await studioSlugForHost(h.get('host') ?? '');
  const entries = await fetchSitemapEntries(studioSlug);
  const origin = siteOrigin(studioSlug, isPlatform);

  const byPage = new Map<string, typeof entries>();
  for (const e of entries) {
    if (!byPage.has(e.pageId)) byPage.set(e.pageId, []);
    byPage.get(e.pageId)!.push(e);
  }

  const xml = buildSitemapXml(
    Array.from(byPage.values()).map((group) => {
      const alternates: Record<string, string> = {};
      for (const g of group) alternates[g.locale] = `${origin}${sitePath(g.locale, g.slug)}`;
      const first = group[0];
      return { loc: `${origin}${sitePath(first.locale, first.slug)}`, lastModified: first.updatedAt, alternates };
    }),
  );

  return new Response(xml, { headers: { 'Content-Type': 'application/xml' } });
}
