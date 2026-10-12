import { buildAppleAppSiteAssociation, parseUniversalLinkConfig } from '@/lib/universal-links';
import { getServerEnv } from '@/lib/server-env';

/**
 * iOS universal links association (docs/MOBILE_APP.md). Served as JSON without a redirect and without a
 * file extension, as Apple requires; 404 until MOBILE_IOS_APP_IDS is configured.
 */
export const dynamic = 'force-dynamic';

export function GET(): Response {
  const env = getServerEnv();
  const body = buildAppleAppSiteAssociation(parseUniversalLinkConfig({ iosAppIds: env.MOBILE_IOS_APP_IDS }));
  if (!body) return new Response('Not found', { status: 404 });
  return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' } });
}
