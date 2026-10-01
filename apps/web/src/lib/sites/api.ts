import { apiInternalBaseUrl } from '@/lib/server-env';
import type { PublicPageDTO, SitemapPageEntry, SitemapResponseDTO } from '@platform/shared';
import { originForHost, siteOrigin } from './origin';

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

export async function fetchSitemapEntries(studioSlug: string): Promise<SitemapResponseDTO> {
  // Used by sitemap.xml; an unreachable API yields an empty list rather
  // than an error page.
  try {
    const res = await fetch(`${apiInternalBaseUrl()}/public/sites/${encodeURIComponent(studioSlug)}/sitemap-entries`, {
      next: { revalidate: PAGE_REVALIDATE_SECONDS },
    });
    if (!res.ok) return { items: [], defaultLocale: null };
    const data = (await res.json()) as { items: SitemapPageEntry[]; defaultLocale?: string | null };
    return { items: data.items, defaultLocale: data.defaultLocale ?? null };
  } catch {
    return { items: [], defaultLocale: null };
  }
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

/** Node runtime variant of resolveHost: cached like the other page-engine reads, so metadata and render share one lookup. */
async function resolveHostCached(host: string): Promise<ResolvedHost | null> {
  try {
    const res = await fetch(`${apiInternalBaseUrl()}/public/sites/resolve?host=${encodeURIComponent(host)}`, { next: { revalidate: PAGE_REVALIDATE_SECONDS } });
    if (!res.ok) return null;
    return (await res.json()) as ResolvedHost;
  } catch {
    return null;
  }
}

export interface HostSite {
  studioSlug: string;
  isPlatform: boolean;
  /** Canonical origin for this request: the verified custom domain itself, otherwise the platform or `<slug>.<base domain>` origin. */
  origin: string;
  isCustomDomain: boolean;
}

/**
 * Host -> studio for a Node runtime route handler or page (sitemap.xml, robots.txt, og, canonical URLs),
 * same rule as middleware.tenantSiteRewrite. A host that is neither the base domain, a subdomain of it nor
 * a VERIFIED custom domain (the API only resolves verified ones) falls back to the platform site.
 */
export async function studioSlugForHost(host: string): Promise<HostSite> {
  const base = process.env.SITES_DOMAIN || process.env.WEB_DOMAIN || 'localhost';
  const bareHost = host.split(':')[0].toLowerCase();
  const platform: HostSite = { studioSlug: 'platform', isPlatform: true, origin: siteOrigin('platform', true), isCustomDomain: false };
  if (!bareHost || bareHost === base || bareHost === 'localhost' || bareHost === '127.0.0.1') return platform;
  if (bareHost.endsWith(`.${base}`)) {
    const studioSlug = bareHost.slice(0, -`.${base}`.length);
    return { studioSlug, isPlatform: false, origin: siteOrigin(studioSlug, false), isCustomDomain: false };
  }
  const resolved = await resolveHostCached(bareHost);
  return resolved ? { studioSlug: resolved.studioSlug, isPlatform: false, origin: originForHost(bareHost), isCustomDomain: true } : platform;
}

/**
 * The platform tenant's brand (its primary color and logo) for the platform
 * chrome (super admin and marketing panel). Best effort: an unreachable API
 * or a missing platform tenant leaves the kit's default color.
 */
export async function fetchPlatformBrand(): Promise<{ themePrimary: string | null; logoUrl: string | null }> {
  try {
    const res = await fetch(`${apiInternalBaseUrl()}/studios/public/platform`, {
      next: { revalidate: PAGE_REVALIDATE_SECONDS },
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return { themePrimary: null, logoUrl: null };
    const body = (await res.json()) as { themePrimary?: unknown; logoUrl?: unknown };
    return {
      themePrimary: typeof body.themePrimary === 'string' ? body.themePrimary : null,
      logoUrl: typeof body.logoUrl === 'string' ? body.logoUrl : null,
    };
  } catch {
    return { themePrimary: null, logoUrl: null };
  }
}
