import { NextRequest, NextResponse } from 'next/server';
import { EMBED_ORIGIN_PATTERN, STUDIO_SLUG_PATTERN } from '@platform/shared';
import { ACCESS_TOKEN_COOKIE } from '@/lib/bff/cookies';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

/** Route group `(dashboard)` pages, matched without the group segment. */
const PROTECTED_PATHS = ['/dashboard', '/calendar', '/members', '/packages', '/trainers'];

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

  const isProtected = PROTECTED_PATHS.some(
    (p) => request.nextUrl.pathname === p || request.nextUrl.pathname.startsWith(`${p}/`),
  );
  if (isProtected && !request.cookies.get(ACCESS_TOKEN_COOKIE)?.value) {
    const loginUrl = new URL('/giris', request.url);
    loginUrl.searchParams.set('sonra', request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/embed/:path*', '/dashboard/:path*', '/calendar/:path*', '/members/:path*', '/packages/:path*', '/trainers/:path*'],
};
