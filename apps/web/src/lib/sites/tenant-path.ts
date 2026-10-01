/**
 * Where a request on a tenant site host is rewritten to (middleware.tenantSiteRewrite). The public event pages
 * (`/events`, `/events/<event>`) live outside the page engine's `tenant-site` tree: on a tenant host they map to
 * the studio's own `/events/<studioSlug>/...` pages, so the tenant sitemap can list them on the tenant host.
 */
export function tenantRewritePath(studioSlug: string, pathname: string): string {
  if (pathname === '/events' || pathname.startsWith('/events/')) return `/events/${studioSlug}${pathname.slice('/events'.length)}`;
  return `/tenant-site/${studioSlug}${pathname}`;
}
