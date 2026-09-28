import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@platform/database';
import { AD_ENTITY_LEVELS } from '@platform/shared';
import type { AdConnectionCredentials, AdEntityLevel, GoogleCredentials, MetaCredentials, TikTokCredentials } from '@platform/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { CredentialCipher } from '../../../common/crypto/credential-cipher';
import { AdsHttpClient } from '../ads-http-client';
import { refreshGoogleAccessToken } from '../delivery/google-oauth';
import { buildGoogleSpendQuery, buildGoogleSpendUrl, parseGoogleSpendResponse } from './google-spend.adapter';
import { buildMetaInsightsUrl, parseMetaInsightsResponse } from './meta-spend.adapter';
import { buildTikTokSpendUrl, parseTikTokSpendResponse } from './tiktok-spend.adapter';
import { defaultSyncRange, isoDate } from './spend-row';
import type { SpendRow } from './spend-row';

export interface SpendSyncOutcome {
  connectionsSynced: number;
  connectionsFailed: number;
  rowsUpserted: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Daily campaign/ad set/ad structure and spend sync (BUYUME_VE_GLOBAL_MIMARI
 * 3.4): pulls Meta Insights / Google Ads GAQL / TikTok integrated reports
 * for every CONNECTED AdConnection and upserts AdEntity (names refresh,
 * attribution stays keyed on id) and AdSpendDaily. Run daily by
 * JobsService.runAll() and on demand via the manual refresh endpoint.
 */
@Injectable()
export class AdSpendSyncService {
  private readonly logger = new Logger(AdSpendSyncService.name);
  private lastSyncedAt: number | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: CredentialCipher,
    private readonly http: AdsHttpClient,
  ) {}

  /**
   * Runs the full sync (every tenant's connected accounts) if more than a
   * day has passed since the last run, or `force` is set (tests). Called
   * from JobsService.runAll() every 15 minutes; this class owns the
   * once-a-day throttle so the heartbeat does not re-sync constantly.
   */
  async syncAllDueIfStale(now = new Date(), force = false): Promise<SpendSyncOutcome | null> {
    if (!force && this.lastSyncedAt !== null && now.getTime() - this.lastSyncedAt < DAY_MS) return null;
    this.lastSyncedAt = now.getTime();
    return this.syncAllDue(now);
  }

  /** Syncs every connected account across every tenant right now, ignoring the throttle. */
  async syncAllDue(now = new Date()): Promise<SpendSyncOutcome> {
    const connections = await this.prisma.adConnection.findMany({ where: { status: 'CONNECTED' } });
    return this.syncConnections(connections, now);
  }

  /** Manual refresh for one tenant (all of its connections). */
  async syncStudio(studioId: string, now = new Date()): Promise<SpendSyncOutcome> {
    const connections = await this.prisma.adConnection.findMany({ where: { studioId, status: 'CONNECTED' } });
    return this.syncConnections(connections, now);
  }

  private async syncConnections(
    connections: Array<{ id: string; studioId: string; platform: string; externalAccountId: string; encryptedCredentials: string }>,
    now: Date,
  ): Promise<SpendSyncOutcome> {
    const outcome: SpendSyncOutcome = { connectionsSynced: 0, connectionsFailed: 0, rowsUpserted: 0 };
    const range = defaultSyncRange(now);

    for (const connection of connections) {
      try {
        const studio = await this.prisma.studio.findUniqueOrThrow({ where: { id: connection.studioId }, select: { currency: true } });
        const credentials = JSON.parse(this.cipher.decrypt(connection.encryptedCredentials)) as AdConnectionCredentials;
        const rows = await this.fetchAllLevels(connection.platform, connection.externalAccountId, credentials, studio.currency, range);
        await this.upsert(connection.studioId, connection.platform, rows);
        outcome.rowsUpserted += rows.length;
        outcome.connectionsSynced += 1;
        await this.prisma.adConnection.update({ where: { id: connection.id }, data: { lastSyncAt: now, lastError: null } });
      } catch (err) {
        outcome.connectionsFailed += 1;
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Ad spend sync failed for connection ${connection.id}: ${message}`);
        await this.prisma.adConnection.update({ where: { id: connection.id }, data: { status: 'ERROR', lastError: message.slice(0, 1000) } });
      }
    }
    return outcome;
  }

  private async fetchAllLevels(
    platform: string,
    externalAccountId: string,
    credentials: AdConnectionCredentials,
    currency: string,
    range: { from: string; to: string },
  ): Promise<SpendRow[]> {
    const out: SpendRow[] = [];
    for (const level of AD_ENTITY_LEVELS) {
      out.push(...(await this.fetchLevel(platform, externalAccountId, credentials, currency, level, range)));
    }
    return out;
  }

  private async fetchLevel(
    platform: string,
    externalAccountId: string,
    credentials: AdConnectionCredentials,
    currency: string,
    level: AdEntityLevel,
    range: { from: string; to: string },
  ): Promise<SpendRow[]> {
    if (platform === 'META') {
      const meta = credentials as MetaCredentials;
      const url = buildMetaInsightsUrl(externalAccountId, level, range.from, range.to);
      const res = await this.http.getJson('META', `${url}&access_token=${encodeURIComponent(meta.accessToken)}`, {});
      if (!res.ok) throw new Error('Meta Insights isteği başarısız');
      return parseMetaInsightsResponse(level, currency, res.body);
    }
    if (platform === 'GOOGLE') {
      const google = credentials as GoogleCredentials;
      const accessToken = await refreshGoogleAccessToken(this.http, google);
      const res = await this.http.postJson(
        'GOOGLE',
        buildGoogleSpendUrl(externalAccountId),
        { authorization: `Bearer ${accessToken}`, 'developer-token': google.developerToken, 'login-customer-id': google.loginCustomerId },
        { query: buildGoogleSpendQuery(level, range.from, range.to) },
      );
      if (!res.ok) throw new Error('Google Ads GAQL isteği başarısız');
      return parseGoogleSpendResponse(level, currency, res.body);
    }
    // TikTok's integrated report is queried per day; the sync window is
    // small (yesterday/today) so this stays cheap.
    const tiktok = credentials as TikTokCredentials;
    const out: SpendRow[] = [];
    for (const day of datesBetween(range.from, range.to)) {
      const res = await this.http.getJson('TIKTOK', buildTikTokSpendUrl(externalAccountId, level, day, day), { 'access-token': tiktok.accessToken });
      if (!res.ok) throw new Error('TikTok raporlama isteği başarısız');
      out.push(...parseTikTokSpendResponse(level, currency, day, res.body));
    }
    return out;
  }

  private async upsert(studioId: string, platform: string, rows: SpendRow[]): Promise<void> {
    for (const row of rows) {
      await this.prisma.adEntity.upsert({
        where: { studioId_platform_level_externalId: { studioId, platform, level: row.level, externalId: row.externalId } },
        create: {
          studioId,
          platform,
          level: row.level,
          externalId: row.externalId,
          name: row.name,
          status: row.status,
          parentExternalId: row.parentExternalId,
        },
        update: { name: row.name, status: row.status, ...(row.parentExternalId ? { parentExternalId: row.parentExternalId } : {}) },
      });
      await this.prisma.adSpendDaily.upsert({
        where: {
          studioId_platform_level_externalId_date: { studioId, platform, level: row.level, externalId: row.externalId, date: new Date(row.date) },
        },
        create: {
          studioId,
          platform,
          level: row.level,
          externalId: row.externalId,
          date: new Date(row.date),
          spendAmount: new Prisma.Decimal(row.spendAmount),
          currency: row.currency,
          impressions: row.impressions,
          clicks: row.clicks,
        },
        update: {
          spendAmount: new Prisma.Decimal(row.spendAmount),
          currency: row.currency,
          impressions: row.impressions,
          clicks: row.clicks,
        },
      });
    }
  }
}

function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (cursor.getTime() <= end.getTime()) {
    out.push(isoDate(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}
