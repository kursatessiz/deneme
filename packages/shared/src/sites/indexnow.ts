import { articlePath, blogIndexPath } from './articles';
import { INDEXNOW_KEY_PATTERN } from './seo-settings';

/**
 * IndexNow (https://www.indexnow.org/documentation): tells participating search engines (Bing, Yandex, Seznam,
 * Naver) which URLs of a host changed. One POST per host, `urlList` limited to that host, the key proven by a
 * text file at `https://<host>/<key>.txt` containing the key (docs/SEO.md).
 */

export const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow';
/** The protocol allows 10 000 URLs per request. */
export const INDEXNOW_MAX_URLS = 10_000;

export interface IndexNowPayload {
  host: string;
  key: string;
  keyLocation: string;
  urlList: string[];
}

/** Path of a page engine page: `/tr` for the home page, `/tr/<slug>` otherwise. */
export function pageUrlPath(locale: string, slug: string): string {
  return slug ? `/${locale}/${slug}` : `/${locale}`;
}

/** Public URLs of a page's locale variants (all of them: an unpublished page tells engines to drop each). */
export function indexNowUrlsForPage(origin: string, variants: ReadonlyArray<{ locale: string; slug: string }>): string[] {
  return variants.map((v) => `${origin}${pageUrlPath(v.locale, v.slug)}`);
}

/** Public URLs of an article's locale variants plus the blog index of each of those locales. */
export function indexNowUrlsForArticle(origin: string, variants: ReadonlyArray<{ locale: string; slug: string }>): string[] {
  return [...variants.map((v) => `${origin}${articlePath(v.locale, v.slug)}`), ...Array.from(new Set(variants.map((v) => v.locale))).map((l) => `${origin}${blogIndexPath(l)}`)];
}

/**
 * The request body for one host. Only https (or the http localhost of development) URLs of exactly this host are kept,
 * duplicates dropped, order preserved. Returns null when the key is malformed or no URL remains.
 */
export function buildIndexNowPayload(input: { origin: string; key: string; urls: readonly string[] }): IndexNowPayload | null {
  if (!INDEXNOW_KEY_PATTERN.test(input.key)) return null;
  // Trailing slashes are stripped with a loop: `/\/+$/` is quadratic on a run of slashes (CodeQL js/polynomial-redos).
  let origin = input.origin;
  while (origin.endsWith('/')) origin = origin.slice(0, -1);
  const hostMatch = /^https?:\/\/([^/]+)$/.exec(origin);
  if (!hostMatch) return null;
  const urlList: string[] = [];
  const seen = new Set<string>();
  for (const url of input.urls) {
    if (!url.startsWith(`${origin}/`) && url !== origin) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    urlList.push(url);
    if (urlList.length >= INDEXNOW_MAX_URLS) break;
  }
  if (urlList.length === 0) return null;
  return { host: hostMatch[1], key: input.key, keyLocation: `${origin}/${input.key}.txt`, urlList };
}
