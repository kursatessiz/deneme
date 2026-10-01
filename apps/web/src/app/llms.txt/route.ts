import { headers } from 'next/headers';
import { NextRequest } from 'next/server';
import { PW_LOCALE_COOKIE } from '@/lib/i18n/constants';
import { fetchSiteSettings, studioSlugForHost } from '@/lib/sites/api';
import { buildSiteLlmsTxt } from '@/lib/sites/llms';

/**
 * Host-aware llms.txt (docs/SEO.md "llms.txt"): the platform's on its own domain, a tenant's on its own host.
 * A site that blocks AI crawlers (`aiCrawlers: block`) does not publish one (404), so the two files never
 * contradict each other. The language follows the visitor (cookie, Accept-Language) within the site's languages.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<Response> {
  const h = await headers();
  const site = await studioSlugForHost(h.get('host') ?? '');
  const settings = await fetchSiteSettings(site.studioSlug);
  if (settings.aiCrawlers === 'block') return new Response('Not found', { status: 404 });
  const body = await buildSiteLlmsTxt({
    site,
    settings,
    cookieLocale: request.cookies.get(PW_LOCALE_COOKIE)?.value,
    acceptLanguage: h.get('accept-language'),
  });
  if (!body) return new Response('Not found', { status: 404 });
  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=300', Vary: 'Accept-Language, Cookie' },
  });
}
