/**
 * Pure XML builders for sitemap.xml / robots.txt, so the shape is unit
 * tested without a running Next.js server.
 */

import { buildHreflangAlternates, type SitemapPageEntry } from './site';
import { articlePath, blogIndexPath, type ArticleSitemapEntry } from './articles';

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

/**
 * Sitemap entries of a site's blog: one url per published locale variant of every article, each with the
 * article's full hreflang set (x-default = the site default locale variant, else the first), plus the blog
 * index of every locale that has at least one published article, with the same reciprocal set.
 */
export function buildArticleSitemapEntries(items: readonly ArticleSitemapEntry[], defaultLocale: string | null, origin: string): SitemapEntry[] {
  const asPages: SitemapPageEntry[] = items.map((item) => ({ pageId: item.articleId, locale: item.locale, slug: item.slug, updatedAt: item.updatedAt }));
  const entries = buildLocalizedSitemapEntries(asPages, defaultLocale, (locale, slug) => `${origin}${articlePath(locale, slug)}`);

  const latestByLocale = new Map<string, string>();
  for (const item of items) {
    const current = latestByLocale.get(item.locale);
    if (!current || item.updatedAt > current) latestByLocale.set(item.locale, item.updatedAt);
  }
  const indexVariants = Array.from(latestByLocale.keys()).map((locale) => ({ locale, slug: '' }));
  const indexAlternates = buildHreflangAlternates(indexVariants, (locale) => `${origin}${blogIndexPath(locale)}`, defaultLocale);
  for (const [locale, updatedAt] of latestByLocale) {
    entries.push({ loc: `${origin}${blogIndexPath(locale)}`, lastModified: updatedAt, alternates: indexAlternates });
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
