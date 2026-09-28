import { Injectable, NotFoundException } from '@nestjs/common';
import {
  GOOGLE_ADS_API_VERSION,
  GOOGLE_ADS_HOST,
  META_CAPI_HOST,
  META_GRAPH_API_VERSION,
  TIKTOK_EVENTS_HOST,
  type AdConnectionCredentials,
  type AdConnectionPlatform,
  type GoogleCredentials,
  type MetaCredentials,
  type TikTokCredentials,
} from '@platform/shared';
import { PrismaService } from '../../prisma/prisma.service';
import type { TenantContext } from '../../auth/tenant-context';
import { AdsHttpClient } from '../ads-http-client';
import { refreshGoogleAccessToken } from '../delivery/google-oauth';
import { AdConnectionsService } from './ad-connections.service';

export interface TestConnectionResult {
  ok: boolean;
  message: string;
}

/**
 * "Bağlantıyı test et": a single, cheap, read-only call per platform that
 * confirms the stored credentials still work, without sending any real
 * conversion event. Updates the connection's status/lastError so the list
 * screen reflects it immediately.
 */
@Injectable()
export class AdConnectionTestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly connections: AdConnectionsService,
    private readonly http: AdsHttpClient,
  ) {}

  async test(tenant: TenantContext, connectionId: string): Promise<TestConnectionResult> {
    const row = await this.prisma.adConnection.findFirst({ where: { id: connectionId, studioId: tenant.studioId } });
    if (!row) throw new NotFoundException('Reklam bağlantısı bulunamadı');
    const credentials = await this.connections.getDecryptedCredentials(connectionId);
    if (!credentials) throw new NotFoundException('Reklam bağlantısı bulunamadı');

    const platform = row.platform as AdConnectionPlatform;
    const result = await this.testFor(platform, row.externalAccountId, credentials);
    await this.connections.markSyncOutcome(connectionId, result.ok ? { ok: true } : { ok: false, error: result.message });
    return result;
  }

  private async testFor(platform: AdConnectionPlatform, externalAccountId: string, credentials: AdConnectionCredentials): Promise<TestConnectionResult> {
    if (platform === 'META') return this.testMeta(credentials as MetaCredentials);
    if (platform === 'GOOGLE') return this.testGoogle(externalAccountId, credentials as GoogleCredentials);
    return this.testTikTok(credentials as TikTokCredentials);
  }

  private async testMeta(credentials: MetaCredentials): Promise<TestConnectionResult> {
    const url = `https://${META_CAPI_HOST}/${META_GRAPH_API_VERSION}/${credentials.pixelId}?fields=id&access_token=${encodeURIComponent(credentials.accessToken)}`;
    const res = await this.http.getJson('META', url, {});
    if (res.ok) return { ok: true, message: 'Meta pixel erişimi doğrulandı' };
    return { ok: false, message: metaErrorMessage(res.body) };
  }

  private async testGoogle(customerId: string, credentials: GoogleCredentials): Promise<TestConnectionResult> {
    let accessToken: string;
    try {
      accessToken = await refreshGoogleAccessToken(this.http, credentials);
    } catch {
      return { ok: false, message: 'Google OAuth yenileme jetonu geçersiz' };
    }

    // A cheap authenticated call against the customer resource.
    const url = `https://${GOOGLE_ADS_HOST}/${GOOGLE_ADS_API_VERSION}/customers/${customerId}`;
    const res = await this.http.getJson('GOOGLE', url, {
      authorization: `Bearer ${accessToken}`,
      'developer-token': credentials.developerToken,
      'login-customer-id': credentials.loginCustomerId,
    });
    if (res.ok) return { ok: true, message: 'Google Ads hesap erişimi doğrulandı' };
    return { ok: false, message: 'Google Ads hesabına erişilemedi (müşteri kimliğini ve geliştirici anahtarını kontrol edin)' };
  }

  private async testTikTok(credentials: TikTokCredentials): Promise<TestConnectionResult> {
    const url = `https://${TIKTOK_EVENTS_HOST}/open_api/v1.3/pixel/list/?pixel_code=${encodeURIComponent(credentials.pixelCode)}`;
    const res = await this.http.getJson('TIKTOK', url, { 'access-token': credentials.accessToken });
    if (res.ok) return { ok: true, message: 'TikTok pixel erişimi doğrulandı' };
    return { ok: false, message: 'TikTok pixel erişimi doğrulanamadı' };
  }
}

function metaErrorMessage(body: unknown): string {
  const msg = (body as { error?: { message?: string } } | null)?.error?.message;
  return msg ? `Meta hatası: ${msg}` : 'Meta pixel erişimi doğrulanamadı';
}
