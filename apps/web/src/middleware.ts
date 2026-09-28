import { NextRequest, NextResponse } from 'next/server';
import { EMBED_ORIGIN_PATTERN, STUDIO_SLUG_PATTERN } from '@platform/shared';
import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE, accessTokenCookieOptions, refreshTokenCookieOptions } from '@/lib/bff/cookies';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
/** Server-side API base for the session refresh; same variable the BFF uses. */
const API_INTERNAL_BASE_URL = process.env.API_INTERNAL_URL || API_BASE_URL;
/** The same domain the dashboard and the platform's own site are served on. */
const SITES_BASE_DOMAIN = process.env.SITES_DOMAIN || process.env.WEB_DOMAIN || 'localhost';

/**
 * Tenant site host routing (docs/SAYFA_MOTORU.md): a request for
 * `<slug>.<SITES_BASE_DOMAIN>` or a verified custom domain is rewritten to
 * `tenant-site/<slug>/<path>`, rendered by
 * `app/tenant-site/[studioSlug]/[locale]/[[...slug]]/page.tsx`. A request
 * for the base domain itself (or localhost in dev) is untouched: it keeps
 * serving the dashboard, admin panel and the platform's own site exactly as
 * before.
 */
/** These resolve the host for themselves (see sitemap.xml/robots.txt route handlers), so they are never rewritten. */
const HOST_AWARE_PATHS = ['/sitemap.xml', '/robots.txt'];

async function tenantSiteRewrite(request: NextRequest): Promise<NextResponse | null> {
  if (HOST_AWARE_PATHS.includes(request.nextUrl.pathname)) return null;
  const host = (request.headers.get('host') ?? '').split(':')[0].toLowerCase();
  if (!host || host === SITES_BASE_DOMAIN || host === 'localhost' || host === '127.0.0.1') return null;

  let studioSlug: string | null = null;
  if (host.endsWith(`.${SITES_BASE_DOMAIN}`)) {
    studioSlug = host.slice(0, -`.${SITES_BASE_DOMAIN}`.length);
  } else {
    try {
      const res = await fetch(`${API_INTERNAL_BASE_URL}/public/sites/resolve?host=${encodeURIComponent(host)}`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) studioSlug = ((await res.json()) as { studioSlug?: string }).studioSlug ?? null;
    } catch {
      return null; // API unreachable: fall through to the platform site rather than failing the request.
    }
  }
  if (!studioSlug || !STUDIO_SLUG_PATTERN.test(studioSlug)) return null;

  const url = request.nextUrl.clone();
  url.pathname = `/tenant-site/${studioSlug}${request.nextUrl.pathname}`;
  return NextResponse.rewrite(url);
}

/** Exchanges the refresh cookie for a new token pair; null when the session is gone. */
async function refreshSession(refreshToken: string): Promise<{ accessToken: string; refreshToken: string } | null> {
  try {
    const res = await fetch(`${API_INTERNAL_BASE_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { accessToken?: unknown; refreshToken?: unknown };
    if (typeof data.accessToken !== 'string' || typeof data.refreshToken !== 'string') return null;
    return { accessToken: data.accessToken, refreshToken: data.refreshToken };
  } catch {
    return null;
  }
}

/** Route group `(dashboard)` pages, matched without the group segment. */
const PROTECTED_PATHS = [
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
  '/riskli-uyeler',
  '/admin',
];

async function embedCsp(request: NextRequest): Promise<NextResponse> {
  const response = NextResponse.next();
  const slug = request.nextUrl.pathname.split('/')[2];
  // Only a well-formed slug is ever put into the API URL (no path traversal
  // or query injection into the server-side request).
  if (!slug || !STUDIO_SLUG_PATTERN.test(slug)) return response;

  let frameAncestors = '*';
  try {
    const res = await fetch(`${API_BASE_URL}/studios/public/${encodeURIComponent(slug)}`, { signal: AbortSignal.timeout(2000) });
    if (res.ok) {
      const studio = (await res.json()) as { embedAllowedOrigins?: string[] };
      // Re-validate before putting values into a header: only plain https origins.
      const origins = (studio.embedAllowedOrigins ?? []).filter((o) => EMBED_ORIGIN_PATTERN.test(o));
      if (origins.length > 0) {
        frameAncestors = origins.join(' ');
      }
    }
  } catch {
    // API unreachable or slow: fall back to the permissive default rather
    // than breaking the widget for every host while the API recovers.
  }

  response.headers.set('Content-Security-Policy', `frame-ancestors ${frameAncestors}`);
  return response;
}

/**
 * Two independent concerns share this file because Next.js allows only one
 * middleware: `/embed/<studioSlug>` gets its `frame-ancestors` CSP (see
 * docs/PUBLIC_API.md "Embed widget"), and every dashboard page requires a
 * session cookie or redirects to /giris. The actual token is validated
 * server-side in `(dashboard)/layout.tsx` via `GET /auth/me`; this check is
 * cheap and only about routing, not authorization.
 */
export async function middleware(request: NextRequest) {
  const tenantRewrite = await tenantSiteRewrite(request);
  if (tenantRewrite) return tenantRewrite;

  if (request.nextUrl.pathname.startsWith('/embed/')) {
    return embedCsp(request);
  }

  const isProtected = PROTECTED_PATHS.some(
    (p) => request.nextUrl.pathname === p || request.nextUrl.pathname.startsWith(`${p}/`),
  );
  if (isProtected && !request.cookies.get(ACCESS_TOKEN_COOKIE)?.value) {
    // The access cookie expires with the token (1h); a valid refresh cookie
    // silently renews the session instead of sending the user to /giris.
    const refreshToken = request.cookies.get(REFRESH_TOKEN_COOKIE)?.value;
    const renewed = refreshToken ? await refreshSession(refreshToken) : null;
    if (renewed) {
      // Make the new access token visible to this request's server components too.
      request.cookies.set(ACCESS_TOKEN_COOKIE, renewed.accessToken);
      request.cookies.set(REFRESH_TOKEN_COOKIE, renewed.refreshToken);
      const response = NextResponse.next({ request: { headers: request.headers } });
      response.cookies.set(ACCESS_TOKEN_COOKIE, renewed.accessToken, accessTokenCookieOptions(process.env.NODE_ENV));
      response.cookies.set(REFRESH_TOKEN_COOKIE, renewed.refreshToken, refreshTokenCookieOptions(process.env.NODE_ENV));
      return response;
    }
    const loginUrl = new URL('/giris', request.url);
    loginUrl.searchParams.set('sonra', request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Runs on every request (except static assets) so a tenant subdomain or
    // custom domain is rewritten whatever path it requests; the protected-path
    // and embed-CSP checks below still only act on their own paths.
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
