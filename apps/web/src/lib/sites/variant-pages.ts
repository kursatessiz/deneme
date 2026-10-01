import type { VariantPagesDTO } from '@platform/shared';

/**
 * Which published pages of a site carry A/B variants (GET /public/sites/:slug/variant-pages). The middleware uses
 * it to send those pages, and only those, to the per-request renderer; every other page is served from the ISR
 * cache (docs/SEO.md "ISR"). The answer is kept in memory for a minute per site, so a new A/B test takes up to a
 * minute to leave the cache. Edge-safe: plain fetch, no Node imports.
 */

const TTL_MS = 60_000;
/** After a failed lookup the page is served from the cache (control variant) for a while before asking again. */
const FAILURE_TTL_MS = 10_000;

interface Entry {
  expiresAt: number;
  paths: Set<string>;
}

const cache = new Map<string, Entry>();

export function variantPageKey(locale: string, slug: string): string {
  return `${locale}/${slug}`;
}

export async function isVariantPage(apiBaseUrl: string, studioSlug: string, locale: string, slug: string, now: number = Date.now()): Promise<boolean> {
  let entry = cache.get(studioSlug);
  if (!entry || entry.expiresAt <= now) {
    try {
      const res = await fetch(`${apiBaseUrl}/public/sites/${encodeURIComponent(studioSlug)}/variant-pages`, { signal: AbortSignal.timeout(1500), cache: 'no-store' });
      if (!res.ok) throw new Error(`variant-pages ${res.status}`);
      const body = (await res.json()) as VariantPagesDTO;
      entry = { expiresAt: now + TTL_MS, paths: new Set(body.items.map((i) => variantPageKey(i.locale, i.slug))) };
    } catch {
      entry = { expiresAt: now + FAILURE_TTL_MS, paths: entry?.paths ?? new Set() };
    }
    cache.set(studioSlug, entry);
  }
  return entry.paths.has(variantPageKey(locale, slug));
}

/** Test hook: forget every cached answer. */
export function clearVariantPagesCache(): void {
  cache.clear();
}
