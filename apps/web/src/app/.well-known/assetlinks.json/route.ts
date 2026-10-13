import { buildAssetLinks, parseUniversalLinkConfig } from '@/lib/universal-links';
import { getServerEnv } from '@/lib/server-env';

/** Android app links association (docs/MOBILE_APP.md); 404 until the package and certificate fingerprints are configured. */
export const dynamic = 'force-dynamic';

export function GET(): Response {
  const env = getServerEnv();
  const body = buildAssetLinks(parseUniversalLinkConfig({ androidPackage: env.MOBILE_ANDROID_PACKAGE, androidFingerprints: env.MOBILE_ANDROID_SHA256_CERT_FINGERPRINTS }));
  if (!body) return new Response('Not found', { status: 404 });
  return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' } });
}
