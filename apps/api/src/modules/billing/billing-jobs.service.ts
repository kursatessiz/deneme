import { Injectable, Logger } from '@nestjs/common';
import { BILLING_TEMPLATE_KEYS, TRIAL_REMINDER_DAYS, dueTrialReminder, trialDaysLeft } from '@platform/shared';
import { PrismaService } from '../prisma/prisma.service';
import { MessagingService } from '../messaging/engine/messaging.service';

const DAY_MS = 24 * 60 * 60 * 1000;
const BATCH = 200;

export interface BillingHeartbeatResult {
  restricted: number;
  reminders: number;
}

/**
 * Trial heartbeat (G5c-1), run from JobsService.runAll every 15 minutes:
 * - expired trials move TRIALING -> RESTRICTED (conditional update, so a
 *   concurrent run or an activation in between wins cleanly), audit
 *   logged, and the owner gets the TRIAL_RESTRICTED notice;
 * - owners get TRIAL_ENDING at 7, 3 and 1 days left, each once per trial
 *   end (Studio.trialReminderSentDays claims it; the messaging idempotency
 *   key covers a crash between claim and send).
 * Messages are TRANSACTIONAL and billing EXEMPT: a platform notice never
 * spends the tenant's SMS credits.
 */
@Injectable()
export class BillingJobsService {
  private readonly logger = new Logger(BillingJobsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly messaging: MessagingService,
  ) {}

  async run(now = new Date()): Promise<BillingHeartbeatResult> {
    const restricted = await this.restrictExpired(now);
    const reminders = await this.sendReminders(now);
    return { restricted, reminders };
  }

  async restrictExpired(now: Date): Promise<number> {
    const expired = await this.prisma.studio.findMany({
      where: { billingStatus: 'TRIALING', trialEndsAt: { lte: now }, isPlatform: false },
      select: { id: true, trialEndsAt: true },
      take: BATCH,
    });
    let count = 0;
    for (const studio of expired) {
      const moved = await this.prisma.studio.updateMany({
        where: { id: studio.id, billingStatus: 'TRIALING', trialEndsAt: { lte: now } },
        data: { billingStatus: 'RESTRICTED', billingStatusChangedAt: now },
      });
      if (moved.count === 0) continue;
      count++;
      await this.prisma.auditLog.create({
        data: {
          studioId: studio.id,
          userId: null,
          action: 'billing.trial_expired',
          entityType: 'Studio',
          entityId: studio.id,
          metadata: { trialEndsAt: studio.trialEndsAt?.toISOString() ?? null },
        },
      });
      await this.notifyOwner(studio.id, BILLING_TEMPLATE_KEYS.trialRestricted, `trial-restricted:${studio.id}:${studio.trialEndsAt?.toISOString() ?? ''}`, {});
    }
    return count;
  }

  async sendReminders(now: Date): Promise<number> {
    const horizon = new Date(now.getTime() + Math.max(...TRIAL_REMINDER_DAYS) * DAY_MS);
    const trialing = await this.prisma.studio.findMany({
      where: { billingStatus: 'TRIALING', trialEndsAt: { gt: now, lte: horizon }, isPlatform: false },
      select: { id: true, trialEndsAt: true, trialReminderSentDays: true, timezone: true, defaultLocale: true },
      take: BATCH,
    });
    let sent = 0;
    for (const studio of trialing) {
      const daysLeft = trialDaysLeft(studio.trialEndsAt, now);
      const threshold = dueTrialReminder(daysLeft, studio.trialReminderSentDays);
      if (threshold === null || !studio.trialEndsAt) continue;
      const claimed = await this.prisma.studio.updateMany({
        where: {
          id: studio.id,
          billingStatus: 'TRIALING',
          trialEndsAt: studio.trialEndsAt,
          OR: [{ trialReminderSentDays: null }, { trialReminderSentDays: { gt: threshold } }],
        },
        data: { trialReminderSentDays: threshold },
      });
      if (claimed.count === 0) continue;
      const ok = await this.notifyOwner(
        studio.id,
        BILLING_TEMPLATE_KEYS.trialEnding,
        `trial-ending:${studio.id}:${threshold}:${studio.trialEndsAt.toISOString()}`,
        { daysLeft: daysLeft ?? threshold, trialEndDate: formatDate(studio.trialEndsAt, studio.defaultLocale, studio.timezone) },
      );
      if (ok) sent++;
    }
    return sent;
  }

  /** Best effort: the first owner membership that is ACTIVE; nothing when the owner has not joined yet. */
  private async notifyOwner(studioId: string, templateKey: string, idempotencyKey: string, variables: Record<string, string | number>): Promise<boolean> {
    try {
      const owner = await this.prisma.membership.findFirst({
        where: { studioId, status: 'ACTIVE', roleTemplate: { isOwner: true } },
        orderBy: { createdAt: 'asc' },
        select: { id: true, studio: { select: { name: true } } },
      });
      if (!owner) return false;
      const result = await this.messaging.send({
        studioId,
        recipient: { membershipId: owner.id },
        purpose: 'TRANSACTIONAL',
        templateKey,
        variables: { studioName: owner.studio.name, ...variables },
        idempotencyKey,
        billing: 'EXEMPT',
        type: templateKey,
      });
      return result.success && !result.duplicate;
    } catch (err) {
      this.logger.warn(`Billing notice ${templateKey} for ${studioId} failed: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }
}

function formatDate(date: Date, locale: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}
