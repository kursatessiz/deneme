/**
 * Pure XML builders for sitemap.xml / robots.txt, so the shape is unit
 * tested without a running Next.js server.
 */

import { NON_INDEXABLE_PATH_PREFIXES } from './indexing';
import { buildHreflangAlternates, type SitemapPageEntry } from './site';

export interface SitemapEntry {
  loc: string;
  lastModified?: string;
  alternates?: Record<string, string>;
}

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * One sitemap entry per published locale variant of every page, each carrying the
 * page's full hreflang set (every variant plus x-default), as search engines require
 * the alternate set to be reciprocal on every URL. `homeXDefaultUrl` replaces the
 * x-default of the home page (slug empty) with a fixed URL, the origin root.
 */
export function buildLocalizedSitemapEntries(
  items: readonly SitemapPageEntry[],
  defaultLocale: string | null,
  toUrl: (locale: string, slug: string) => string,
  options: { homeXDefaultUrl?: string } = {},
): SitemapEntry[] {
  const byPage = new Map<string, SitemapPageEntry[]>();
  for (const item of items) {
    const group = byPage.get(item.pageId);
    if (group) group.push(item);
    else byPage.set(item.pageId, [item]);
  }
  const entries: SitemapEntry[] = [];
  for (const group of byPage.values()) {
    const isHome = group.some((variant) => variant.slug === '');
    const alternates = buildHreflangAlternates(group, toUrl, defaultLocale, isHome ? options.homeXDefaultUrl : undefined);
    for (const variant of group) entries.push({ loc: toUrl(variant.locale, variant.slug), lastModified: variant.updatedAt, alternates });
  }
  return entries;
}

export function buildSitemapXml(entries: readonly SitemapEntry[]): string {
  const urls = entries
    .map((e) => {
      const alternates = Object.entries(e.alternates ?? {})
        .map(([locale, href]) => `<xhtml:link rel="alternate" hreflang="${escapeXml(locale)}" href="${escapeXml(href)}"/>`)
        .join('');
      const lastmod = e.lastModified ? `<lastmod>${escapeXml(e.lastModified)}</lastmod>` : '';
      return `<url><loc>${escapeXml(e.loc)}</loc>${lastmod}${alternates}</url>`;
    })
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${urls}</urlset>`;
}

/** Public content stays allowed; every non-indexable prefix gets a Disallow line (sites/indexing.ts). */
export function buildRobotsTxt(sitemapUrl: string): string {
  const disallow = NON_INDEXABLE_PATH_PREFIXES.map((p) => `Disallow: ${p}/\nDisallow: ${p}$\n`).join('');
  return `User-agent: *\nAllow: /\n${disallow}Sitemap: ${sitemapUrl}\n`;
}
