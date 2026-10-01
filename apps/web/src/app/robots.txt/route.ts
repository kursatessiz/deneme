import { headers } from 'next/headers';
import { buildRobotsTxt } from '@platform/shared';
import { fetchSiteSettings, studioSlugForHost } from '@/lib/sites/api';

/** Host-aware robots.txt; the site's AI crawler policy adds the Disallow groups of the AI crawlers (docs/SEO.md). */
export async function GET() {
  const h = await headers();
  const { origin, studioSlug } = await studioSlugForHost(h.get('host') ?? '');
  const { aiCrawlers } = await fetchSiteSettings(studioSlug);
  return new Response(buildRobotsTxt(`${origin}/sitemap.xml`, { aiCrawlers }), { headers: { 'Content-Type': 'text/plain' } });
}
