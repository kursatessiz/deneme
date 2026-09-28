import { headers } from 'next/headers';
import { buildRobotsTxt } from '@platform/shared';
import { studioSlugForHost } from '@/lib/sites/api';
import { siteOrigin } from '@/components/sites/SitePage';

export async function GET() {
  const h = await headers();
  const { studioSlug, isPlatform } = await studioSlugForHost(h.get('host') ?? '');
  const origin = siteOrigin(studioSlug, isPlatform);
  return new Response(buildRobotsTxt(`${origin}/sitemap.xml`), { headers: { 'Content-Type': 'text/plain' } });
}
