/**
 * Route group `(dashboard)` and `/admin` pages, matched without the group
 * segment: they need a session (middleware.ts) and report client errors
 * through the BFF, while every other page reports through the dedicated
 * public telemetry route (lib/errors/reporter.ts).
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
] as const;

export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
