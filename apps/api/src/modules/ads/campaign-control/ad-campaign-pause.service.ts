import { Injectable } from '@nestjs/common';
import { isAdPauseCapable } from '@platform/shared';
import type { AdConnectionCredentials, GoogleCredentials, MetaCredentials } from '@platform/shared';
import { CredentialCipher } from '../../../common/crypto/credential-cipher';
import { AdsHttpClient } from '../ads-http-client';
import { refreshGoogleAccessToken } from '../delivery/google-oauth';
import { buildGooglePauseRequest, buildMetaPauseRequest } from './pause-requests';

export interface PausableConnection {
  platform: string;
  externalAccountId: string;
  encryptedCredentials: string;
}

export type PauseOutcome = { ok: true } | { ok: false; unsupported: boolean; error: string };

const MAX_ERROR_LENGTH = 300;

/** A short, secret-free reason from a failed platform response. */
function platformError(platform: string, status: number, body: unknown): string {
  const record = body && typeof body === 'object' ? (body as { error?: { message?: unknown } }) : null;
  const message = typeof record?.error?.message === 'string' ? record.error.message : '';
  return `${platform} ${status}${message ? `: ${message}` : ''}`.slice(0, MAX_ERROR_LENGTH);
}

/**
 * The pause capability of the ad adapters (M5): pauses one external campaign
 * through the platform's HTTP API (Meta Graph, Google Ads), using the
 * connection's stored credentials. It is the only write to an ad platform
 * the system makes; there is deliberately no resume. A platform without the
 * capability (TikTok today) answers `unsupported` and nothing is sent.
 */
@Injectable()
export class AdCampaignPauseService {
  constructor(
    private readonly cipher: CredentialCipher,
    private readonly http: AdsHttpClient,
  ) {}

  supports(platform: string): boolean {
    return isAdPauseCapable(platform);
  }

  async pause(connection: PausableConnection, campaignExternalId: string): Promise<PauseOutcome> {
    if (!isAdPauseCapable(connection.platform)) {
      return { ok: false, unsupported: true, error: `Pausing is not supported for ${connection.platform}` };
    }
    try {
      const credentials = JSON.parse(this.cipher.decrypt(connection.encryptedCredentials)) as AdConnectionCredentials;
      if (connection.platform === 'META') {
        const request = buildMetaPauseRequest(campaignExternalId, (credentials as MetaCredentials).accessToken);
        const res = await this.http.postForm('META', request.url, {}, request.form);
        return res.ok ? { ok: true } : { ok: false, unsupported: false, error: platformError('META', res.status, res.body) };
      }
      const google = credentials as GoogleCredentials;
      const request = buildGooglePauseRequest(connection.externalAccountId, campaignExternalId);
      const accessToken = await refreshGoogleAccessToken(this.http, google);
      const res = await this.http.postJson(
        'GOOGLE',
        request.url,
        { authorization: `Bearer ${accessToken}`, 'developer-token': google.developerToken, 'login-customer-id': google.loginCustomerId },
        request.body,
      );
      return res.ok ? { ok: true } : { ok: false, unsupported: false, error: platformError('GOOGLE', res.status, res.body) };
    } catch (err) {
      // Never echo the stored credential: only the error class and its message (which carries none) are kept.
      return { ok: false, unsupported: false, error: (err instanceof Error ? err.message : 'Bilinmeyen hata').slice(0, MAX_ERROR_LENGTH) };
    }
  }
}
