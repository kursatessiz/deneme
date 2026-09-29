import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ERROR_BASELINE_BUCKETS,
  ERROR_BUCKET_MS,
  bucketStartOf,
  detectSpike,
  observedBaselineBuckets,
} from '@platform/shared';
import { PrismaService } from '../prisma/prisma.service';
import { ErrorAlertNotifier } from './error-alert-notifier.service';
import { ErrorAlertRecordsService } from './error-alert-records.service';
import { ErrorSettingsService } from './error-settings.service';

export interface SpikeRunResult {
  /** Group windows that reached the minimum count and were evaluated. */
  evaluated: number;
  /** Alerts created and published. */
  alerts: number;
}

/**
 * Spike detection (H3), a heartbeat step. For each group with events in the
 * last complete 15-minute bucket or the current one, the window's count is
 * compared with the group's own trailing 24-hour baseline of 15-minute
 * buckets (detectSpike in @platform/shared; thresholds are data in the error
 * settings). A spike creates one error_alerts row per group window and is
 * published (super admin e-mail, alert sinks, opted-in owners). A group
 * alerts again only after the cooldown, measured between window starts, so
 * a long incident does not page every 15 minutes. Ignored and merged groups
 * never alert.
 */
@Injectable()
export class ErrorSpikeService {
  private readonly logger = new Logger(ErrorSpikeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly settings: ErrorSettingsService,
    private readonly records: ErrorAlertRecordsService,
    private readonly notifier: ErrorAlertNotifier,
  ) {}

  async run(now: Date): Promise<SpikeRunResult> {
    const result: SpikeRunResult = { evaluated: 0, alerts: 0 };
    if (this.config.get<string>('ERROR_ALERTS_ENABLED') === '0') return result;
    const row = await this.settings.getRow();
    const spike = await this.settings.getSpikeSettings(row);
    if (!spike.enabled) return result;
    const cooldownMs = (await this.settings.getCooldownMinutes(row)) * 60 * 1000;

    const current = bucketStartOf(now);
    const previous = new Date(current.getTime() - ERROR_BUCKET_MS);
    const candidates = await this.prisma.errorGroupBucket.findMany({
      where: { bucketStart: { in: [previous, current] }, count: { gte: spike.minWindowCount } },
      include: { group: { select: { id: true, status: true, mergedIntoId: true, firstSeenAt: true } } },
      orderBy: [{ bucketStart: 'asc' }, { count: 'desc' }],
      take: 200,
    });

    for (const candidate of candidates) {
      const group = candidate.group;
      if (group.status === 'IGNORED' || group.mergedIntoId) continue;
      result.evaluated++;
      const windowStart = candidate.bucketStart;
      const baseline = await this.prisma.errorGroupBucket.aggregate({
        where: { groupId: group.id, bucketStart: { gte: new Date(windowStart.getTime() - ERROR_BASELINE_BUCKETS * ERROR_BUCKET_MS), lt: windowStart } },
        _sum: { count: true },
      });
      const baselineTotal = baseline._sum.count ?? 0;
      const verdict = detectSpike(
        { windowCount: candidate.count, baselineTotal, observedBuckets: observedBaselineBuckets(group.firstSeenAt, windowStart) },
        spike,
      );
      if (!verdict.spike) continue;

      const last = await this.records.lastWindowStart(group.id, 'SPIKE');
      if (last && windowStart.getTime() - last.getTime() < cooldownMs) continue;

      const alert = await this.records.create({
        groupId: group.id,
        kind: 'SPIKE',
        windowStart,
        windowEnd: new Date(windowStart.getTime() + ERROR_BUCKET_MS),
        windowCount: candidate.count,
        baselineTotal,
        baselineMean: verdict.baselineMean,
        threshold: verdict.threshold,
      });
      if (!alert) continue;
      result.alerts++;
      try {
        await this.notifier.publish(alert, { emailAdmins: true, now });
      } catch (err) {
        this.logger.warn(`Spike alert publish failed for group ${group.id}: ${err instanceof Error ? err.name : 'unknown'}`);
      }
    }
    return result;
  }
}
