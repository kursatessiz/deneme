import { ARTICLE_SLUG_PATTERN, LocaleCodeSchema, SITE_REVALIDATE_SECONDS, STUDIO_SLUG_PATTERN, siteCacheTag } from '@platform/shared';
import type { PublicArticleDTO, PublicArticleListDTO } from '@platform/shared';
import { apiInternalBaseUrl } from '@/lib/server-env';

/**
 * Server-only reads of a site's published articles (S2b, docs/SAYFA_MOTORU.md
 * "Yazılar / blog"), cached like the page engine reads. Always the internal
 * API URL; every path value is validated before it reaches the URL.
 */

const REVALIDATE_SECONDS = SITE_REVALIDATE_SECONDS;

function validParams(studioSlug: string, locale: string): boolean {
  return (studioSlug === 'platform' || STUDIO_SLUG_PATTERN.test(studioSlug)) && LocaleCodeSchema.safeParse(locale).success;
}

/** A page of the published list; null for an unknown site, locale or tag (a 404), throws when the API fails. */
export async function fetchPublicArticles(studioSlug: string, locale: string, options: { page?: number; pageSize?: number; tag?: string } = {}): Promise<PublicArticleListDTO | null> {
  if (!validParams(studioSlug, locale)) return null;
  if (options.tag !== undefined && !ARTICLE_SLUG_PATTERN.test(options.tag)) return null;
  const url = new URL(`${apiInternalBaseUrl()}/public/sites/${encodeURIComponent(studioSlug)}/articles`);
  url.searchParams.set('locale', locale);
  if (options.page && options.page > 1) url.searchParams.set('page', String(options.page));
  if (options.pageSize) url.searchParams.set('pageSize', String(options.pageSize));
  if (options.tag) url.searchParams.set('tag', options.tag);
  const res = await fetch(url, { next: { revalidate: REVALIDATE_SECONDS, tags: [siteCacheTag(studioSlug), `site-articles:${studioSlug}`] } });
  if (res.status === 404 || res.status === 400) return null;
  if (!res.ok) throw new Error(`Articles could not be loaded (${res.status})`);
  return (await res.json()) as PublicArticleListDTO;
}

/** One published article; null when it does not exist or is not published. */
export async function fetchPublicArticle(studioSlug: string, locale: string, slug: string): Promise<PublicArticleDTO | null> {
  if (!validParams(studioSlug, locale) || !ARTICLE_SLUG_PATTERN.test(slug)) return null;
  const url = new URL(`${apiInternalBaseUrl()}/public/sites/${encodeURIComponent(studioSlug)}/articles/${encodeURIComponent(slug)}`);
  url.searchParams.set('locale', locale);
  const res = await fetch(url, { next: { revalidate: REVALIDATE_SECONDS, tags: [siteCacheTag(studioSlug), `site-articles:${studioSlug}`] } });
  if (res.status === 404 || res.status === 400) return null;
  if (!res.ok) throw new Error(`Article could not be loaded (${res.status})`);
  return (await res.json()) as PublicArticleDTO;
}
