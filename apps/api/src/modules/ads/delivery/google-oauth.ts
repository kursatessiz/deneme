import { GOOGLE_OAUTH_HOST } from '@platform/shared';
import type { GoogleCredentials } from '@platform/shared';
import { AdsHttpClient } from '../ads-http-client';

/** Exchanges the stored refresh token for a short-lived access token. Never logs the token. */
export async function refreshGoogleAccessToken(http: AdsHttpClient, credentials: GoogleCredentials): Promise<string> {
  const res = await http.postJson(
    'GOOGLE',
    `https://${GOOGLE_OAUTH_HOST}/token`,
    {},
    {
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      refresh_token: credentials.refreshToken,
      grant_type: 'refresh_token',
    },
  );
  const token = (res.body as { access_token?: string } | null)?.access_token;
  if (!res.ok || !token) throw new Error('Could not obtain a Google OAuth access token');
  return token;
}
