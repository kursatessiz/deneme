import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@platform/database';
import { ADD_ON_TEMPLATE_KEYS, ADD_ON_TRIAL_REMINDER_DAYS, localizedText, parseAddOnSnapshot, trialDaysLeft } from '@platform/shared';
import type { AddOnExpiryReason } from '@platform/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { MessagingService } from '../../messaging/engine/messaging.service';
import { notifyStudioOwner } from '../owner-notifier';
import { AddOnChargeService } from './add-on-charge.service';
import { toLocalizedText } from './admin-add-ons.service';

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const BATCH = 200;
/** A hosted checkout that nobody paid within this long counts as a failed renewal attempt. */
const STALE_PENDING_MS = 24 * HOUR_MS;

export interface AddOnHeartbeatResult {
  /** "Trial ends in 3 days" notices sent. */
  reminders: number;
  /** Ended trials and cancelled add-ons past their period end that turned EXPIRED (an exhausted renewal counts under failed). */
  expired: number;
  renewed: number;
  /** Renewal attempts that failed (retry scheduled or add-on expired). */
  failed: number;
}

/**
 * Add-on heartbeat (G5c-2), run from BillingJobsService.run() on the
 * platform billing job every 15 minutes:
 * - trial notice (in-app and e-mail through the messaging engine, per the
 *   owner's channel settings) once, 3 days before the trial ends;
 * - expiry: an ended trial and a cancelled add-on past its period end turn
 *   EXPIRED, which switches the module off (the flag resolver only honours
 *   rows that currently have access);
 * - renewals: an ACTIVE add-on past its period end is charged the price it
 *   was quoted (snapshot), with the dunning of AddOnChargeService.
 * Every step claims its row with a conditional update, so a concurrent run
 * cannot double-send, double-expire or double-charge.
 */
@Injectable()
export class AddOnJobsService {
  private readonly logger = new Logger(AddOnJobsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly charges: AddOnChargeService,
    private readonly messaging: MessagingService,
  ) {}

  async run(now = new Date()): Promise<AddOnHeartbeatResult> {
    const reminders = await this.sendTrialReminders(now);
    const expired = await this.expireEnded(now);
    const { renewed, failed } = await this.renewDue(now);
    return { reminders, expired, renewed, failed };
  }

  async sendTrialReminders(now: Date): Promise<number> {
    const horizon = new Date(now.getTime() + ADD_ON_TRIAL_REMINDER_DAYS * DAY_MS);
    const rows = await this.prisma.studioAddOn.findMany({
      where: { status: 'TRIALING', trialReminderSentAt: null, trialEndsAt: { gt: now, lte: horizon }, studio: { isPlatform: false } },
      include: { addOn: { select: { name: true } }, studio: { select: { defaultLocale: true, timezone: true } } },
      take: BATCH,
    });
    let sent = 0;
    for (const row of rows) {
      const claimed = await this.prisma.studioAddOn.updateMany({
        where: { id: row.id, status: 'TRIALING', trialReminderSentAt: null },
        data: { trialReminderSentAt: now },
      });
      if (claimed.count === 0 || !row.trialEndsAt) continue;
      const ok = await this.notify(row.studioId, ADD_ON_TEMPLATE_KEYS.trialEnding, `addon-trial-ending:${row.id}`, {
        addOnName: localizedText(toLocalizedText(row.addOn.name), row.studio.defaultLocale),
        daysLeft: trialDaysLeft(row.trialEndsAt, now) ?? ADD_ON_TRIAL_REMINDER_DAYS,
        trialEndDate: formatDate(row.trialEndsAt, row.studio.defaultLocale, row.studio.timezone),
      });
      if (ok) sent++;
    }
    return sent;
  }

  async expireEnded(now: Date): Promise<number> {
    let count = 0;
    const trials = await this.prisma.studioAddOn.findMany({
      where: { status: 'TRIALING', trialEndsAt: { lte: now } },
      select: { id: true, studioId: true, trialEndsAt: true, addOn: { select: { key: true } } },
      take: BATCH,
    });
    for (const row of trials) {
      const moved = await this.prisma.studioAddOn.updateMany({ where: { id: row.id, status: 'TRIALING', trialEndsAt: { lte: now } }, data: { status: 'EXPIRED' } });
      if (moved.count === 0) continue;
      count++;
      await this.auditExpiry(row.studioId, row.id, row.addOn.key, 'TRIAL_ENDED', row.trialEndsAt);
    }
    const cancelled = await this.prisma.studioAddOn.findMany({
      where: { status: 'CANCELLED', currentPeriodEnd: { lte: now } },
      select: { id: true, studioId: true, currentPeriodEnd: true, addOn: { select: { key: true } } },
      take: BATCH,
    });
    for (const row of cancelled) {
      const moved = await this.prisma.studioAddOn.updateMany({ where: { id: row.id, status: 'CANCELLED', currentPeriodEnd: { lte: now } }, data: { status: 'EXPIRED' } });
      if (moved.count === 0) continue;
      count++;
      await this.auditExpiry(row.studioId, row.id, row.addOn.key, 'CANCELLED_PERIOD_ENDED', row.currentPeriodEnd);
    }
    return count;
  }

  async renewDue(now: Date): Promise<{ renewed: number; failed: number }> {
    const due = await this.prisma.studioAddOn.findMany({
      where: {
        status: 'ACTIVE',
        currentPeriodEnd: { lte: now },
        OR: [{ nextRenewalAttemptAt: null }, { nextRenewalAttemptAt: { lte: now } }],
        studio: { isPlatform: false },
      },
      include: { addOn: { select: { key: true } } },
      orderBy: { currentPeriodEnd: 'asc' },
      take: BATCH,
    });
    let renewed = 0;
    let failed = 0;
    for (const row of due) {
      // Claim the attempt: nobody else may charge this row for the next hour.
      const claimed = await this.prisma.studioAddOn.updateMany({
        where: { id: row.id, status: 'ACTIVE', nextRenewalAttemptAt: row.nextRenewalAttemptAt },
        data: { nextRenewalAttemptAt: new Date(now.getTime() + HOUR_MS) },
      });
      if (claimed.count === 0) continue;
      try {
        const outcome = await this.renewOne(row, now);
        if (outcome === 'RENEWED') renewed++;
        else if (outcome === 'FAILED') failed++;
      } catch (err) {
        this.logger.warn(`Add-on renewal ${row.id} errored: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return { renewed, failed };
  }

  private async renewOne(row: { id: string; studioId: string; priceSnapshot: Prisma.JsonValue; billingInterval: string | null; addOn: { key: string } }, now: Date): Promise<'RENEWED' | 'FAILED' | 'WAITING'> {
    // A hosted checkout from an earlier attempt: wait for the provider, unless nobody paid it for a day.
    const pending = await this.prisma.platformBillingPayment.findFirst({
      where: { studioAddOnId: row.id, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
      select: { id: true, createdAt: true },
    });
    if (pending) {
      if (now.getTime() - pending.createdAt.getTime() < STALE_PENDING_MS) return 'WAITING';
      await this.charges.failPayment(pending.id, now);
      return 'FAILED';
    }
    const snapshot = parseAddOnSnapshot(row.priceSnapshot);
    const interval = snapshot?.interval ?? (row.billingInterval === 'YEAR' ? 'YEAR' : 'MONTH');
    if (!snapshot || snapshot.amount === null) {
      // No quoted price to charge: treat as a failed attempt so it is retried and finally expires instead of running free forever.
      await this.charges.recordRenewalFailure(row.id, now);
      return 'FAILED';
    }
    const result = await this.charges.charge(
      { studioAddOnId: row.id, studioId: row.studioId, addOnKey: row.addOn.key, currency: snapshot.currency, amount: snapshot.amount, interval, actorUserId: null },
      now,
    );
    if (result.status === 'COMPLETED') return 'RENEWED';
    if (result.status === 'FAILED') return 'FAILED';
    return 'WAITING';
  }

  private async auditExpiry(studioId: string, id: string, key: string, reason: AddOnExpiryReason, endedAt: Date | null): Promise<void> {
    await this.prisma.auditLog.create({
      data: { studioId, userId: null, action: 'add_on.expired', entityType: 'StudioAddOn', entityId: id, metadata: { key, reason, endedAt: endedAt?.toISOString() ?? null } },
    });
  }

  private notify(studioId: string, templateKey: string, idempotencyKey: string, variables: Record<string, string | number>): Promise<boolean> {
    return notifyStudioOwner({ prisma: this.prisma, messaging: this.messaging, logger: this.logger }, studioId, templateKey, idempotencyKey, variables);
  }
}

function formatDate(date: Date, locale: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}
