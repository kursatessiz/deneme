/**
 * Cache tag of everything the web app caches for one site (pages, settings, sitemap entries, articles). The
 * API asks the web app to purge it when the site's public content changes (docs/SEO.md "ISR"). One coarse tag per
 * site keeps invalidation correct: a page's breadcrumbs, the blog index and the sitemap all read other rows.
 */
export const SITE_CACHE_TAG_PREFIX = 'site:';

export function siteCacheTag(studioSlug: string): string {
  return `${SITE_CACHE_TAG_PREFIX}${studioSlug}`;
}

/**
 * Cache tag of the host -> site lookup of one custom domain, so deactivating the domain takes effect
 * without waiting for the ISR window.
 */
export const SITE_HOST_CACHE_TAG_PREFIX = 'site-host:';

export function siteHostCacheTag(host: string): string {
  return `${SITE_HOST_CACHE_TAG_PREFIX}${host.split(':')[0].toLowerCase()}`;
}

/** Whether a tag is a site cache tag the revalidation endpoint may purge. */
export function isSiteCacheTag(tag: string): boolean {
  return /^site:[a-z0-9-]{1,60}$/.test(tag) || /^site-host:[a-z0-9.-]{1,190}$/.test(tag);
}

/** Longest ISR window of a public page in seconds; a purge makes a change visible sooner. */
export const SITE_REVALIDATE_SECONDS = 300;
