import { NextRequest, NextResponse } from 'next/server';
import { VISITOR_COOKIE } from '@platform/shared';
import { apiInternalBaseUrl } from '@/lib/server-env';
import { isTrackingToken } from '@/lib/messaging/tokens';
import { safeRedirectTarget } from '@/lib/messaging/redirect';

export const dynamic = 'force-dynamic';

/**
 * Click-tracking link from an email (docs/MESAJLASMA.md, "İzleme"). The
 * token only references a link row the API stored when the message was
 * sent; the API answers with that stored target. The visitor cookie
 * (pw_vid, first-party on this domain) is forwarded so the click joins the
 * contact's attribution chain. Anything unexpected lands on the site root:
 * this route never redirects to a URL taken from the request.
 */
export async function GET(req: NextRequest, context: { params: Promise<{ token: string }> }): Promise<NextResponse> {
  const { token } = await context.params;
  const home = new URL('/', req.nextUrl.origin);
  if (!isTrackingToken(token)) return NextResponse.redirect(home, 302);

  const headers: Record<string, string> = { accept: 'application/json' };
  const userAgent = req.headers.get('user-agent');
  if (userAgent) headers['user-agent'] = userAgent.slice(0, 512);
  const visitorId = req.cookies.get(VISITOR_COOKIE)?.value;
  if (visitorId) headers['x-pw-vid'] = visitorId;

  let target: string | null = null;
  try {
    const res = await fetch(`${apiInternalBaseUrl()}/m/c/${encodeURIComponent(token)}`, {
      method: 'POST',
      headers,
      cache: 'no-store',
      redirect: 'manual',
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const body = (await res.json().catch(() => null)) as { url?: unknown } | null;
      target = safeRedirectTarget(body?.url);
    }
  } catch {
    target = null;
  }
  const response = NextResponse.redirect(target ?? home, 302);
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('Referrer-Policy', 'no-referrer');
  return response;
}
