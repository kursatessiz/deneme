import { NextRequest, NextResponse } from 'next/server';
import { EMBED_ORIGIN_PATTERN, STUDIO_SLUG_PATTERN } from '@platform/shared';
import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE, accessTokenCookieOptions, refreshTokenCookieOptions } from '@/lib/bff/cookies';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
/** Server-side API base for the session refresh; same variable the BFF uses. */
const API_INTERNAL_BASE_URL = process.env.API_INTERNAL_URL || API_BASE_URL;

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

/**
 * Ad pixel hosts allowed to load a script and receive a beacon from a
 * public page, additive to whatever the page already needs (no
 * default-src/script-src baseline exists yet, so this only narrows the two
 * directives it sets; see docs/REKLAM_ENTEGRASYONU.md). Never applied to
 * `(dashboard)` pages -- pixels only ever load on public pages.
 */
const AD_PIXEL_SCRIPT_SRC = ["'self'", "'unsafe-inline'", 'https://connect.facebook.net', 'https://analytics.tiktok.com'];
const AD_PIXEL_CONNECT_SRC = ["'self'", 'https://www.facebook.com', 'https://analytics.tiktok.com', API_BASE_URL];

function publicAdsCsp(response: NextResponse): NextResponse {
  response.headers.set(
    'Content-Security-Policy',
    `script-src ${AD_PIXEL_SCRIPT_SRC.join(' ')}; connect-src ${AD_PIXEL_CONNECT_SRC.join(' ')}`,
  );
  return response;
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
  '/reklam-performansi',
  '/riskli-uyeler',
  '/admin',
];

/** Every top-level static route, dashboard or otherwise; anything else at one or two segments is a public studio slug page. */
const RESERVED_TOP_LEVEL_SEGMENTS = new Set([...PROTECTED_PATHS.map((p) => p.slice(1)), 'giris', 'embed', 'api']);

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
  if (request.nextUrl.pathname.startsWith('/embed/')) {
    return embedCsp(request);
  }

  // A public studio page (product page, embedded widget host page or
  // booking page): "/<slug>" or "/<slug>/book", where <slug> is not one of
  // the reserved static routes above. This is the only place the ad pixel
  // scripts (loaded client-side, gated on consent) are allowed to run.
  const segments = request.nextUrl.pathname.split('/').filter(Boolean);
  if (
    (segments.length === 1 || (segments.length === 2 && segments[1] === 'book')) &&
    !RESERVED_TOP_LEVEL_SEGMENTS.has(segments[0]) &&
    STUDIO_SLUG_PATTERN.test(segments[0])
  ) {
    return publicAdsCsp(NextResponse.next());
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
  // Keep in sync with PROTECTED_PATHS (Next requires a static literal here).
  // '/:slug' and '/:slug/book' additionally cover public studio pages, so
  // publicAdsCsp can run for them (see RESERVED_TOP_LEVEL_SEGMENTS).
  matcher: [
    '/embed/:path*',
    '/dashboard/:path*',
    '/calendar/:path*',
    '/members/:path*',
    '/packages/:path*',
    '/trainers/:path*',
    '/attendance/:path*',
    '/ayarlar/:path*',
    '/finans/:path*',
    '/raporlar/:path*',
    '/adaylar/:path*',
    '/reklam-performansi/:path*',
    '/riskli-uyeler/:path*',
    '/admin/:path*',
    '/:slug',
    '/:slug/book',
  ],
};
