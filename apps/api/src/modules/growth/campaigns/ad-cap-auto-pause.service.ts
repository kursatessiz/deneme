import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@platform/database';
import {
  AD_ENTITY_PAUSED_STATUS,
  adCapPauseKey,
  planAdCapPauses,
  utcDayStart,
  utcMonthKey,
  utcMonthStart,
  type AdCapPauseDTO,
  type AdCapPauseStatus,
  type AdSpendCapStatus,
} from '@platform/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AdCampaignPauseService, type PausableConnection } from '../../ads/campaign-control/ad-campaign-pause.service';
import { serverT, studioLocale } from '../../../common/server-i18n';

const DAY_MS = 86_400_000;
const MAX_ERROR_LENGTH = 500;

export interface AdCapPauseRunResult {
  /** Campaigns the platform accepted a pause for in this run. */
  paused: number;
  /** Campaigns whose pause failed in this run (retried by the next heartbeat). */
  failed: number;
  /** Platforms with spend over the cap that have no pause capability or no connected account. */
  skippedPlatforms: string[];
}

/**
 * Ad spend cap auto-pause (M5, docs/PAZARLAMA_MODULU.md). When the setting
 * `adCapAutoPause` is on and the caller finds a currency over its monthly cap,
 * this pauses the platform tenant's active campaigns on the platforms that
 * spent in that currency, through the ad adapters. Rules: pause is the only
 * write to an ad platform and it is never undone by the system; a campaign is
 * paused at most once per UTC month (AdCapPause is unique per campaign and
 * month, a PAUSED row is never touched again); every pause is written to the
 * AuditLog and to `ad_cap_pauses` (which the dashboard lists); a platform
 * without the capability is logged as a structured warning and skipped.
 */
@Injectable()
export class AdCapAutoPauseService {
  private readonly logger = new Logger(AdCapAutoPauseService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pauser: AdCampaignPauseService,
  ) {}

  async run(studioId: string, status: AdSpendCapStatus, now: Date): Promise<AdCapPauseRunResult> {
    const month = utcMonthKey(now);
    const spendRows = await this.prisma.adSpendDaily.groupBy({
      by: ['platform'],
      where: {
        studioId,
        level: 'CAMPAIGN',
        currency: status.currency,
        date: { gte: utcMonthStart(now), lt: new Date(utcDayStart(now).getTime() + DAY_MS) },
      },
      _sum: { spendAmount: true },
    });
    const platformsWithSpend = spendRows.filter((r) => (r._sum.spendAmount ?? new Prisma.Decimal(0)).gt(0)).map((r) => r.platform);
    if (platformsWithSpend.length === 0) return { paused: 0, failed: 0, skippedPlatforms: [] };

    const [campaigns, doneRows] = await Promise.all([
      this.prisma.adEntity.findMany({
        where: { studioId, level: 'CAMPAIGN', platform: { in: platformsWithSpend } },
        select: { id: true, platform: true, externalId: true, name: true, status: true },
        orderBy: [{ platform: 'asc' }, { externalId: 'asc' }],
      }),
      this.prisma.adCapPause.findMany({ where: { studioId, monthKey: month, status: 'PAUSED' }, select: { platform: true, campaignExternalId: true } }),
    ]);
    const plan = planAdCapPauses({
      platformsWithSpend,
      campaigns: campaigns.map((c) => ({ platform: c.platform, externalId: c.externalId, status: c.status })),
      alreadyPaused: new Set(doneRows.map((r) => adCapPauseKey(r.platform, r.campaignExternalId))),
    });

    const skipped = new Set(plan.unsupportedPlatforms);
    for (const platform of plan.unsupportedPlatforms) {
      this.logger.warn(JSON.stringify({ event: 'ad_cap_auto_pause.unsupported_platform', studioId, platform, currency: status.currency, month }));
    }

    const byKey = new Map(campaigns.map((c) => [adCapPauseKey(c.platform, c.externalId), c]));
    const connectionsOf = new Map<string, PausableConnection[]>();
    let paused = 0;
    let failed = 0;
    for (const target of plan.toPause) {
      const entity = byKey.get(adCapPauseKey(target.platform, target.externalId));
      if (!entity) continue;
      let connections = connectionsOf.get(target.platform);
      if (!connections) {
        connections = await this.prisma.adConnection.findMany({
          where: { studioId, platform: target.platform, status: 'CONNECTED' },
          select: { platform: true, externalAccountId: true, encryptedCredentials: true },
          orderBy: { createdAt: 'asc' },
        });
        connectionsOf.set(target.platform, connections);
        if (connections.length === 0) {
          this.logger.warn(JSON.stringify({ event: 'ad_cap_auto_pause.no_connection', studioId, platform: target.platform, currency: status.currency, month }));
        }
      }
      if (connections.length === 0) {
        skipped.add(target.platform);
        continue;
      }

      // The campaign belongs to one ad account: try the connected accounts of the platform until one accepts.
      let error = serverT(await studioLocale(this.prisma, studioId))('apiTexts.ads.noConnectedAccount');
      let accepted = false;
      for (const connection of connections) {
        const outcome = await this.pauser.pause(connection, entity.externalId);
        if (outcome.ok) {
          accepted = true;
          break;
        }
        error = outcome.error;
      }
      if (accepted) {
        await this.recordPaused(studioId, entity, status, month, now);
        paused += 1;
      } else {
        await this.recordFailed(studioId, entity, status, month, error);
        failed += 1;
      }
    }
    if (paused > 0 || failed > 0) {
      this.logger.warn(JSON.stringify({ event: 'ad_cap_auto_pause.run', studioId, currency: status.currency, month, paused, failed }));
    }
    return { paused, failed, skippedPlatforms: [...skipped].sort() };
  }

  private async recordPaused(
    studioId: string,
    entity: { id: string; platform: string; externalId: string; name: string },
    status: AdSpendCapStatus,
    month: string,
    now: Date,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const key = { studioId_platform_campaignExternalId_monthKey: { studioId, platform: entity.platform, campaignExternalId: entity.externalId, monthKey: month } };
      const previous = await tx.adCapPause.findUnique({ where: key, select: { status: true, attempts: true } });
      const data = {
        campaignName: entity.name,
        currency: status.currency,
        spentAmount: new Prisma.Decimal(status.spent),
        capAmount: new Prisma.Decimal(status.cap),
        status: 'PAUSED',
        lastError: null,
        pausedAt: now,
      };
      await tx.adCapPause.upsert({
        where: key,
        create: { studioId, platform: entity.platform, campaignExternalId: entity.externalId, monthKey: month, ...data },
        update: { ...data, attempts: (previous?.attempts ?? 0) + 1 },
      });
      await tx.adEntity.updateMany({
        where: { studioId, platform: entity.platform, level: 'CAMPAIGN', externalId: entity.externalId },
        data: { status: AD_ENTITY_PAUSED_STATUS },
      });
      // A second worker that raced to the same pause finds the row already PAUSED: one audit entry per campaign and month.
      if (previous?.status === 'PAUSED') return;
      await tx.auditLog.create({
        data: {
          studioId,
          userId: null,
          action: 'marketing.ad_campaign.auto_paused',
          entityType: 'AdEntity',
          entityId: entity.id,
          metadata: {
            platform: entity.platform,
            campaignExternalId: entity.externalId,
            campaignName: entity.name,
            reason: 'AD_SPEND_CAP_EXCEEDED',
            currency: status.currency,
            month,
            spent: status.spent,
            cap: status.cap,
            at: now.toISOString(),
          } as Prisma.InputJsonValue,
        },
      });
    });
  }

  private async recordFailed(
    studioId: string,
    entity: { id: string; platform: string; externalId: string; name: string },
    status: AdSpendCapStatus,
    month: string,
    error: string,
  ): Promise<void> {
    const lastError = error.slice(0, MAX_ERROR_LENGTH);
    await this.prisma.$transaction(async (tx) => {
      const key = { studioId_platform_campaignExternalId_monthKey: { studioId, platform: entity.platform, campaignExternalId: entity.externalId, monthKey: month } };
      const previous = await tx.adCapPause.findUnique({ where: key, select: { status: true, attempts: true } });
      if (previous?.status === 'PAUSED') return;
      await tx.adCapPause.upsert({
        where: key,
        create: {
          studioId,
          platform: entity.platform,
          campaignExternalId: entity.externalId,
          monthKey: month,
          campaignName: entity.name,
          currency: status.currency,
          spentAmount: new Prisma.Decimal(status.spent),
          capAmount: new Prisma.Decimal(status.cap),
          status: 'FAILED',
          lastError,
        },
        update: { status: 'FAILED', lastError, attempts: (previous?.attempts ?? 0) + 1 },
      });
      // Only the first failure of the month is audited; the row keeps counting the retries.
      if (previous) return;
      await tx.auditLog.create({
        data: {
          studioId,
          userId: null,
          action: 'marketing.ad_campaign.auto_pause_failed',
          entityType: 'AdEntity',
          entityId: entity.id,
          metadata: {
            platform: entity.platform,
            campaignExternalId: entity.externalId,
            reason: 'AD_SPEND_CAP_EXCEEDED',
            currency: status.currency,
            month,
            error: lastError,
          } as Prisma.InputJsonValue,
        },
      });
    });
  }

  /** The pauses (and failed attempts) of the UTC month `now` falls in, newest first, for the dashboard. */
  async listForMonth(studioId: string, now: Date): Promise<AdCapPauseDTO[]> {
    const rows = await this.prisma.adCapPause.findMany({
      where: { studioId, monthKey: utcMonthKey(now) },
      orderBy: [{ pausedAt: 'desc' }, { createdAt: 'desc' }],
      take: 100,
    });
    return rows.map((r) => ({
      platform: r.platform as AdCapPauseDTO['platform'],
      campaignExternalId: r.campaignExternalId,
      campaignName: r.campaignName,
      currency: r.currency,
      month: r.monthKey,
      spent: r.spentAmount.toFixed(2),
      cap: r.capAmount.toFixed(2),
      status: r.status as AdCapPauseStatus,
      attempts: r.attempts,
      lastError: r.lastError,
      pausedAt: r.pausedAt?.toISOString() ?? null,
    }));
  }
}
