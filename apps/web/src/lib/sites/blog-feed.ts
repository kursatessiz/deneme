import { ARTICLE_FEED_LIMIT, buildArticleFeedXml } from '@platform/shared';
import { getTFor } from '@/lib/i18n/getT';
import { fetchPublicArticles } from './articles-api';
import { requestSiteOrigin } from './request-origin';

/**
 * The blog's RSS feed on the site's own origin (a verified custom domain when the request comes through it),
 * built from the same cached list read as the blog pages and the same shared builder as the API feed endpoint
 * (`GET /public/sites/:slug/feed/:locale`, which uses the site's default origin). See docs/SEO.md.
 */
export async function blogFeedResponse(studioSlug: string, isPlatform: boolean, locale: string): Promise<Response> {
  const list = await fetchPublicArticles(studioSlug, locale, { page: 1, pageSize: ARTICLE_FEED_LIMIT });
  if (!list) return new Response(null, { status: 404 });
  const [t, origin] = await Promise.all([getTFor(locale), requestSiteOrigin(studioSlug, isPlatform)]);
  const xml = buildArticleFeedXml(list, origin, {
    title: t('articles.public.feedTitle', { site: list.site.siteName }),
    description: t('articles.public.description', { site: list.site.siteName }),
  });
  return new Response(xml, { headers: { 'Content-Type': 'application/rss+xml; charset=utf-8', 'Cache-Control': 'public, max-age=300' } });
}
