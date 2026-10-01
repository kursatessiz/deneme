/**
 * Single source for which URL paths search engines must never index
 * (docs/SEO.md). Used by robots.txt (Disallow lines), by the web middleware
 * (X-Robots-Tag header) and by the web app's protected-route checks.
 * Prefixes are matched on whole path segments: `/members` covers `/members`
 * and `/members/42` but not `/membership-plans`.
 */

/**
 * Route group `(dashboard)` and `/admin` pages, matched without the group
 * segment: they need a session and report client errors through the BFF,
 * while every other page reports through the dedicated public telemetry route.
 */
export const PROTECTED_PATHS = [
  '/dashboard',
  '/calendar',
  '/members',
  '/packages',
  '/trainers',
  '/attendance',
  '/ayarlar',
  '/finans',
  '/raporlar',
  '/adaylar',
  '/reklam-performansi',
  '/riskli-uyeler',
  '/gelen-kutusu',
  '/etkinlikler',
  '/topluluk',
  '/abonelik',
  '/tavsiye',
  '/admin',
  // M1: marketing panel and the two-step verification screen.
  '/pazarlama',
  '/guvenlik',
] as const;

/** Public pages and handlers that exist but carry no search value or carry a secret token in the URL. */
export const NON_INDEXABLE_PUBLIC_PATHS = [
  '/giris',
  '/api',
  // Token pages: invite, consent confirmation, shared community post, unsubscribe, click tracking.
  '/j',
  '/onay',
  '/paylasim',
  '/m/u',
  '/m/c',
  // Embeddable booking widget (rendered inside third-party iframes).
  '/embed',
] as const;

/** Every path prefix that must not be indexed, in a stable order. */
export const NON_INDEXABLE_PATH_PREFIXES: readonly string[] = [...PROTECTED_PATHS, ...NON_INDEXABLE_PUBLIC_PATHS];

function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PATHS.some((p) => matchesPrefix(pathname, p));
}

export function isNonIndexablePath(pathname: string): boolean {
  return NON_INDEXABLE_PATH_PREFIXES.some((p) => matchesPrefix(pathname, p));
}

/** Value of the X-Robots-Tag header (and of the matching robots meta tag) for a non-indexable URL. */
export const NOINDEX_ROBOTS_VALUE = 'noindex, nofollow';
