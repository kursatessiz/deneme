import { NextRequest } from 'next/server';
import { INDEXNOW_KEY_PATTERN, siteCacheTag } from '@platform/shared';
import { apiInternalBaseUrl } from '@/lib/server-env';
import { studioSlugForHost } from '@/lib/sites/api';

/**
 * IndexNow key file (docs/SEO.md "IndexNow"): `https://<host>/<key>.txt` answers the key itself for the site that
 * owns the key, so the search engines can verify the host. The middleware rewrites `/<key>.txt` here; the host
 * (platform, `<slug>.<base domain>` or a verified custom domain) picks the site, and any other key is a 404.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, { params }: { params: Promise<{ key: string }> }): Promise<Response> {
  const { key } = await params;
  if (!INDEXNOW_KEY_PATTERN.test(key)) return new Response('Not found', { status: 404 });
  const site = await studioSlugForHost(request.headers.get('host') ?? '');
  let stored: string | null = null;
  try {
    const res = await fetch(`${apiInternalBaseUrl()}/public/sites/${encodeURIComponent(site.studioSlug)}/indexnow-key`, {
      next: { revalidate: 300, tags: [siteCacheTag(site.studioSlug)] },
      signal: AbortSignal.timeout(2000),
    });
    if (res.ok) stored = ((await res.json()) as { key?: unknown }).key as string | null;
  } catch {
    stored = null;
  }
  if (!stored || stored !== key) return new Response('Not found', { status: 404 });
  return new Response(key, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=300', 'X-Robots-Tag': 'noindex' } });
}
