import { apiInternalBaseUrl } from '@/lib/server-env';
import type { PublicPageDTO, SitemapPageEntry } from '@platform/shared';

/**
 * Server-only reads of the page engine's public rendering data
 * (docs/SAYFA_MOTORU.md). Always the internal API URL, never a
 * client-controlled host.
 */

const PAGE_REVALIDATE_SECONDS = 300;

export async function fetchPublicPage(studioSlug: string, locale: string, slug: string): Promise<PublicPageDTO | null> {
  const url = new URL(`${apiInternalBaseUrl()}/public/sites/${encodeURIComponent(studioSlug)}/pages`);
  url.searchParams.set('locale', locale);
  url.searchParams.set('slug', slug);
  const res = await fetch(url, { next: { revalidate: PAGE_REVALIDATE_SECONDS, tags: [`site-page:${studioSlug}:${locale}:${slug}`] } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Sayfa yüklenemedi (${res.status})`);
  return (await res.json()) as PublicPageDTO;
}

export async function fetchSitemapEntries(studioSlug: string): Promise<SitemapPageEntry[]> {
  const res = await fetch(`${apiInternalBaseUrl()}/public/sites/${encodeURIComponent(studioSlug)}/sitemap-entries`, {
    next: { revalidate: PAGE_REVALIDATE_SECONDS },
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { items: SitemapPageEntry[] };
  return data.items;
}

export interface ResolvedHost {
  studioSlug: string;
  siteId: string;
}

/** Used by middleware (edge runtime): a plain fetch, no Next.js cache tags. */
export async function resolveHost(host: string, apiBaseUrl: string): Promise<ResolvedHost | null> {
  const res = await fetch(`${apiBaseUrl}/public/sites/resolve?host=${encodeURIComponent(host)}`, { cache: 'no-store' });
  if (!res.ok) return null;
  return (await res.json()) as ResolvedHost;
}

/** Host -> studioSlug for a Node runtime route handler (sitemap.xml/robots.txt), same rule as middleware.tenantSiteRewrite. */
export async function studioSlugForHost(host: string): Promise<{ studioSlug: string; isPlatform: boolean }> {
  const base = process.env.SITES_DOMAIN || process.env.WEB_DOMAIN || 'localhost';
  const bareHost = host.split(':')[0].toLowerCase();
  if (!bareHost || bareHost === base || bareHost === 'localhost' || bareHost === '127.0.0.1') return { studioSlug: 'platform', isPlatform: true };
  if (bareHost.endsWith(`.${base}`)) return { studioSlug: bareHost.slice(0, -`.${base}`.length), isPlatform: false };
  const resolved = await resolveHost(bareHost, apiInternalBaseUrl());
  return resolved ? { studioSlug: resolved.studioSlug, isPlatform: false } : { studioSlug: 'platform', isPlatform: true };
}
