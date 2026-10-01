import { revalidateTag } from 'next/cache';
import { NextRequest } from 'next/server';
import { getServerEnv } from '@/lib/server-env';
import { parseRevalidateTags, secretsMatch } from '@/lib/sites/revalidate';

/**
 * Called by the API when a site's public content changes (page or article publish and unpublish, site
 * settings; docs/SEO.md "ISR"). Body `{ tags: ["site:<slug>"] }`, secret in the `x-revalidate-secret` header
 * (`REVALIDATE_SECRET`, validated in lib/server-env.ts). Purges the fetch cache entries and the cached pages
 * that read them. Without a configured secret the endpoint is off and pages refresh by their time window.
 */
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest): Promise<Response> {
  const secret = getServerEnv().REVALIDATE_SECRET;
  if (!secret) return Response.json({ error: 'revalidation_disabled' }, { status: 503 });
  if (!secretsMatch(request.headers.get('x-revalidate-secret'), secret)) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const body: unknown = await request.json().catch(() => null);
  const tags = parseRevalidateTags(body);
  if (!tags) return Response.json({ error: 'invalid_tags' }, { status: 400 });
  for (const tag of tags) revalidateTag(tag);
  return Response.json({ revalidated: tags });
}
