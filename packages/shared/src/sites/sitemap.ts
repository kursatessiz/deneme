/**
 * Pure XML builders for sitemap.xml / robots.txt, so the shape is unit
 * tested without a running Next.js server.
 */

import { NON_INDEXABLE_PATH_PREFIXES } from './indexing';

export interface SitemapEntry {
  loc: string;
  lastModified?: string;
  alternates?: Record<string, string>;
}

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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
