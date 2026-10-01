/**
 * Origin and path helpers for the page engine's public URLs (canonical,
 * hreflang, sitemap, Open Graph). Kept free of component imports so the root
 * layout and route handlers can use them. See docs/SEO.md.
 */

export function sitesBaseDomain(): string {
  return process.env.SITES_DOMAIN || process.env.WEB_DOMAIN || 'localhost';
}

/** `https://<host>`; plain http only for the local development host. */
export function originForHost(host: string): string {
  const protocol = host === 'localhost' || host.startsWith('localhost:') ? 'http' : 'https';
  return `${protocol}://${host}`;
}

/** Default origin of a site: the platform on the base domain, a tenant on `<slug>.<base domain>`. */
export function siteOrigin(studioSlug: string, isPlatform: boolean): string {
  const base = sitesBaseDomain();
  return originForHost(isPlatform ? base : `${studioSlug}.${base}`);
}

export function sitePath(locale: string, slug: string): string {
  return slug ? `/${locale}/${slug}` : `/${locale}`;
}
