import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

/**
 * Only `/embed/<studioSlug>` needs `frame-ancestors` opened up so the host
 * site's page can put it in an iframe (see docs/PUBLIC_API.md "Embed
 * widget"). Every other route keeps whatever headers it already has -- this
 * middleware never touches them.
 */
export async function middleware(request: NextRequest) {
  const response = NextResponse.next();
  const slug = request.nextUrl.pathname.split('/')[2];
  if (!slug) return response;

  let frameAncestors = '*';
  try {
    const res = await fetch(`${API_BASE_URL}/studios/public/${slug}`, { signal: AbortSignal.timeout(2000) });
    if (res.ok) {
      const studio = (await res.json()) as { embedAllowedOrigins?: string[] };
      if (studio.embedAllowedOrigins && studio.embedAllowedOrigins.length > 0) {
        frameAncestors = studio.embedAllowedOrigins.join(' ');
      }
    }
  } catch {
    // API unreachable or slow: fall back to the permissive default rather
    // than breaking the widget for every host while the API recovers.
  }

  response.headers.set('Content-Security-Policy', `frame-ancestors ${frameAncestors}`);
  return response;
}

export const config = {
  matcher: '/embed/:path*',
};
