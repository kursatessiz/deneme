import { headers } from 'next/headers';
import { buildRobotsTxt } from '@platform/shared';
import { studioSlugForHost } from '@/lib/sites/api';

export async function GET() {
  const h = await headers();
  const { origin } = await studioSlugForHost(h.get('host') ?? '');
  return new Response(buildRobotsTxt(`${origin}/sitemap.xml`), { headers: { 'Content-Type': 'text/plain' } });
}
