import { Injectable, Logger } from '@nestjs/common';
import { TOUCHPOINT_RETENTION_MONTHS } from '@platform/shared';
import { PrismaService } from '../../prisma/prisma.service';

/** Rows deleted per statement, so a purge never holds long locks on a large table. */
export const RETENTION_BATCH_SIZE = 5000;
/** Statements per table per run; a bigger backlog continues on the next heartbeat. */
export const RETENTION_MAX_BATCHES = 20;
/** After a run that drained the backlog, the step waits this long (the heartbeat itself runs every 15 minutes). */
const RETENTION_INTERVAL_MS = 23 * 60 * 60 * 1000;

export interface TrackingRetentionResult {
  touchpointsDeleted: number;
  visitorsDeleted: number;
  /** False when the step was skipped because it already completed within the last day. */
  ran: boolean;
}

/** `now` minus whole calendar months in UTC, with the day clamped to the target month's length. */
export function retentionCutoff(now: Date, months: number = TOUCHPOINT_RETENTION_MONTHS): Date {
  const target = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, 1, now.getUTCHours(), now.getUTCMinutes(), now.getUTCSeconds(), now.getUTCMilliseconds()));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(now.getUTCDate(), lastDay));
  return target;
}

/**
 * Daily heartbeat step: deletes touchpoints older than TOUCHPOINT_RETENTION_MONTHS
 * and anonymous visitors (no contact) not seen for that long. Every FK to
 * touchpoints is ON DELETE SET NULL (contacts first/last touchpoint, conversion
 * attribution, studio referrals), so the attribution summary columns copied onto
 * the contact stay intact. Visitors linked to a contact are kept; their old
 * touchpoints are removed by the first pass. docs/CRM_VE_ATIF.md.
 */
@Injectable()
export class TrackingRetentionService {
  private readonly logger = new Logger(TrackingRetentionService.name);
  private lastCompletedAt: number | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async run(now: Date): Promise<TrackingRetentionResult> {
    if (this.lastCompletedAt !== null && now.getTime() - this.lastCompletedAt < RETENTION_INTERVAL_MS) {
      return { touchpointsDeleted: 0, visitorsDeleted: 0, ran: false };
    }
    const cutoff = retentionCutoff(now);
    const touchpoints = await this.purge(
      () => this.prisma.$executeRaw`
        DELETE FROM touchpoints WHERE id IN (
          SELECT id FROM touchpoints WHERE occurred_at < ${cutoff} LIMIT ${RETENTION_BATCH_SIZE}
        )`,
    );
    // Touchpoints first, so the visitor delete cascades over (almost) nothing.
    const visitors = await this.purge(
      () => this.prisma.$executeRaw`
        DELETE FROM visitors WHERE (studio_id, id) IN (
          SELECT studio_id, id FROM visitors
          WHERE last_seen_at < ${cutoff} AND contact_id IS NULL
          LIMIT ${RETENTION_BATCH_SIZE}
        )`,
    );
    if (!touchpoints.capped && !visitors.capped) this.lastCompletedAt = now.getTime();
    if (touchpoints.deleted + visitors.deleted > 0) {
      this.logger.log(`Tracking retention: ${touchpoints.deleted} touchpoint(s) and ${visitors.deleted} visitor(s) deleted (cutoff ${cutoff.toISOString()})`);
    }
    return { touchpointsDeleted: touchpoints.deleted, visitorsDeleted: visitors.deleted, ran: true };
  }

  /** Runs one bounded DELETE statement per loop turn until a statement removes less than a full batch. */
  private async purge(removeBatch: () => Promise<number>): Promise<{ deleted: number; capped: boolean }> {
    let deleted = 0;
    for (let i = 0; i < RETENTION_MAX_BATCHES; i += 1) {
      const count = await removeBatch();
      deleted += count;
      if (count < RETENTION_BATCH_SIZE) return { deleted, capped: false };
    }
    return { deleted, capped: true };
  }
}
