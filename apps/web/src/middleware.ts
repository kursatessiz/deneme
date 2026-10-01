import { NextRequest, NextResponse } from 'next/server';
import { DYNAMIC_PAGE_SEGMENT, EMBED_ORIGIN_PATTERN, LocaleCodeSchema, NOINDEX_ROBOTS_VALUE, STUDIO_SLUG_PATTERN, isNonIndexablePath } from '@platform/shared';
import { PAGE_LOCALE_HEADER } from '@/lib/i18n/constants';
import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE, accessTokenCookieOptions, refreshTokenCookieOptions } from '@/lib/bff/cookies';
import { dashboardCsp, generateNonce } from '@/lib/security/csp';
import { isProtectedPath } from '@/lib/security/protected-paths';
import { tenantRewritePath } from '@/lib/sites/tenant-path';
import { blogPagingRewrite } from '@/lib/sites/blog-paging';
import { isVariantPage } from '@/lib/sites/variant-pages';
import { apiOrigin, serverPublicApiUrl } from '@/lib/public-api-url';

/** Server-side API base (docker network) for host resolution, session refresh and the embed CSP; same variable the BFF uses. */
const API_INTERNAL_BASE_URL = process.env.API_INTERNAL_URL || serverPublicApiUrl();
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
/** These resolve the host for themselves (see sitemap.xml/robots.txt/og route handlers), so they are never rewritten. */
const HOST_AWARE_PATHS = ['/sitemap.xml', '/robots.txt', '/og'];

/** Adds PAGE_LOCALE_HEADER for a `/<locale>/...` path; any client-sent value is dropped first. */
function requestHeadersWithPageLocale(request: NextRequest): Headers {
  const headers = new Headers(request.headers);
  headers.delete(PAGE_LOCALE_HEADER);
  const first = request.nextUrl.pathname.split('/').filter(Boolean)[0];
  if (first && first !== 'api' && LocaleCodeSchema.safeParse(first).success) headers.set(PAGE_LOCALE_HEADER, first);
  return headers;
}

/**
 * The internal path of a page engine request: paginated blog lists use cached path-based routes, and a page
 * with A/B variants goes to the per-request `_dynamic` twin (docs/SEO.md "ISR"). Everything else is the cached
 * route at the visitor's own path. The visitor's URL never changes.
 */
async function pageEnginePath(request: NextRequest, studioSlug: string): Promise<string> {
  const pathname = request.nextUrl.pathname;
  const paging = blogPagingRewrite(pathname, request.nextUrl.searchParams.get('page'));
  if (paging) return paging;
  if (request.method !== 'GET' && request.method !== 'HEAD') return pathname;
  const [locale, ...rest] = pathname.split('/').filter(Boolean);
  if (!locale || !LocaleCodeSchema.safeParse(locale).success || locale === 'api' || rest[0] === 'blog') return pathname;
  const slug = rest.join('/');
  return (await isVariantPage(API_INTERNAL_BASE_URL, studioSlug, locale, slug)) ? `/${locale}/${DYNAMIC_PAGE_SEGMENT}${slug ? `/${slug}` : ''}` : pathname;
}

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
  url.pathname = tenantRewritePath(studioSlug, await pageEnginePath(request, studioSlug));
  return NextResponse.rewrite(url, { request: { headers: requestHeadersWithPageLocale(request) } });
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

/**
 * Ad pixel hosts allowed to load a script and receive a beacon from a
 * public page, additive to whatever the page already needs (no
 * default-src/script-src baseline exists yet, so this only narrows the two
 * directives it sets; see docs/REKLAM_ENTEGRASYONU.md). Never applied to
 * `(dashboard)` pages -- pixels only ever load on public pages.
 */
const AD_PIXEL_SCRIPT_SRC = [
  "'self'",
  "'unsafe-inline'",
  'https://connect.facebook.net',
  'https://www.googletagmanager.com',
  'https://analytics.tiktok.com',
  // next dev evaluates modules with eval; production builds never do.
  ...(process.env.NODE_ENV === 'development' ? ["'unsafe-eval'"] : []),
];
const AD_PIXEL_CONNECT_SRC = [
  "'self'",
  'https://www.facebook.com',
  'https://www.googletagmanager.com',
  'https://www.google.com',
  'https://analytics.tiktok.com',
];

/** The browser-facing API origin (runtime PUBLIC_API_URL): lead forms and tracking beacons post to it. */
function publicApiConnectSrc(): string {
  return apiOrigin(serverPublicApiUrl());
}

function publicAdsCsp(response: NextResponse): NextResponse {
  response.headers.set(
    'Content-Security-Policy',
    `script-src ${AD_PIXEL_SCRIPT_SRC.join(' ')}; connect-src ${[...AD_PIXEL_CONNECT_SRC, publicApiConnectSrc()].join(' ')}`,
  );
  return response;
}


/** The login page: not protected (no session yet), but still gets the strict dashboard CSP. */
const LOGIN_PATH = '/giris';

/**
 * Per-request nonce CSP for the authenticated dashboard/admin panel and the
 * login page, following the Next.js App Router nonce guidance: the nonce is
 * set on the request header `x-nonce` (so Next applies it to its own
 * inline scripts) and on the response's `Content-Security-Policy` header.
 * Returns the request headers to build any `NextResponse.next({ request: {
 * headers } })` with, plus the same policy string to also set on whatever
 * response is ultimately returned (a redirect never needs the request
 * headers, but still needs the response header).
 */
function dashboardCspHeaders(request: NextRequest): { requestHeaders: Headers; csp: string } {
  const nonce = generateNonce();
  const csp = dashboardCsp(nonce, process.env.NODE_ENV === 'development');
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);
  return { requestHeaders, csp };
}

async function embedCsp(request: NextRequest): Promise<NextResponse> {
  const response = NextResponse.next();
  const slug = request.nextUrl.pathname.split('/')[2];
  // Only a well-formed slug is ever put into the API URL (no path traversal
  // or query injection into the server-side request).
  if (!slug || !STUDIO_SLUG_PATTERN.test(slug)) return response;

  let frameAncestors = '*';
  try {
    const res = await fetch(`${API_INTERNAL_BASE_URL}/studios/public/${encodeURIComponent(slug)}`, { signal: AbortSignal.timeout(2000) });
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
export async function middleware(request: NextRequest): Promise<NextResponse> {
  const response = await route(request);
  // Header-level noindex covers client-component pages, route handlers and redirects, where page metadata cannot reach (docs/SEO.md).
  if (isNonIndexablePath(request.nextUrl.pathname)) response.headers.set('X-Robots-Tag', NOINDEX_ROBOTS_VALUE);
  return response;
}

async function route(request: NextRequest): Promise<NextResponse> {
  const tenantRewrite = await tenantSiteRewrite(request);
  if (tenantRewrite) return publicAdsCsp(tenantRewrite);

  if (request.nextUrl.pathname.startsWith('/embed/')) {
    return embedCsp(request);
  }

  const isProtected = isProtectedPath(request.nextUrl.pathname);
  // The web invite landing (/j/<token>, M1) asks for a code and a PIN: same strict CSP as the login page, never ad pixels.
  const isLogin = request.nextUrl.pathname === LOGIN_PATH || request.nextUrl.pathname.startsWith('/j/');
  if (isProtected && !request.cookies.get(ACCESS_TOKEN_COOKIE)?.value) {
    // The access cookie expires with the token (1h); a valid refresh cookie
    // silently renews the session instead of sending the user to /giris.
    const refreshToken = request.cookies.get(REFRESH_TOKEN_COOKIE)?.value;
    const renewed = refreshToken ? await refreshSession(refreshToken) : null;
    if (renewed) {
      // Make the new access token visible to this request's server components too.
      request.cookies.set(ACCESS_TOKEN_COOKIE, renewed.accessToken);
      request.cookies.set(REFRESH_TOKEN_COOKIE, renewed.refreshToken);
      const { requestHeaders, csp } = dashboardCspHeaders(request);
      const response = NextResponse.next({ request: { headers: requestHeaders } });
      response.headers.set('Content-Security-Policy', csp);
      response.cookies.set(ACCESS_TOKEN_COOKIE, renewed.accessToken, accessTokenCookieOptions(process.env.NODE_ENV));
      response.cookies.set(REFRESH_TOKEN_COOKIE, renewed.refreshToken, refreshTokenCookieOptions(process.env.NODE_ENV));
      return response;
    }
    const loginUrl = new URL('/giris', request.url);
    loginUrl.searchParams.set('sonra', request.nextUrl.pathname);
    const redirectResponse = NextResponse.redirect(loginUrl);
    redirectResponse.headers.set('Content-Security-Policy', dashboardCsp(generateNonce(), process.env.NODE_ENV === 'development'));
    return redirectResponse;
  }

  if (isProtected || isLogin) {
    // The authenticated dashboard/admin panel and the login page: a strict,
    // per-request nonce CSP (defense in depth against stored XSS).
    const { requestHeaders, csp } = dashboardCspHeaders(request);
    const response = NextResponse.next({ request: { headers: requestHeaders } });
    response.headers.set('Content-Security-Policy', csp);
    return response;
  }

  // Every other page is public (platform site, booking pages): the only
  // place the ad pixel scripts (loaded client-side, gated on consent) are
  // allowed to run.
  if (request.nextUrl.pathname.startsWith('/api/')) return NextResponse.next();
  // Platform site: paginated blog lists and A/B pages are rewritten internally (see pageEnginePath).
  const enginePath = await pageEnginePath(request, 'platform');
  if (enginePath !== request.nextUrl.pathname) {
    const url = request.nextUrl.clone();
    url.pathname = enginePath;
    return publicAdsCsp(NextResponse.rewrite(url, { request: { headers: requestHeadersWithPageLocale(request) } }));
  }
  return publicAdsCsp(NextResponse.next({ request: { headers: requestHeadersWithPageLocale(request) } }));
}

export const config = {
  matcher: [
    // Runs on every request (except static assets) so a tenant subdomain or
    // custom domain is rewritten whatever path it requests; the protected-path
    // and embed-CSP checks below still only act on their own paths. The generated
    // icons, the web manifest and the Open Graph image (app/icon.tsx, apple-icon.tsx,
    // manifest.ts, opengraph-image.tsx) are root assets and skip the middleware.
    '/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|(?:icon|apple-icon|opengraph-image)(?:/|$)).*)',
  ],
};
