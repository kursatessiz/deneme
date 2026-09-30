import { Injectable, Logger, Optional } from '@nestjs/common';
import { BILLING_TEMPLATE_KEYS, TRIAL_REMINDER_DAYS, dueTrialReminder, planPriceIn, studioBillingCurrency, trialDaysLeft } from '@platform/shared';
import { PrismaService } from '../prisma/prisma.service';
import { MessagingService } from '../messaging/engine/messaging.service';
import { PlatformEventsService } from '../webhooks/platform-events.service';
import { notifyStudioOwner } from './owner-notifier';
import { AddOnJobsService } from './add-ons/add-ons-jobs.service';
import type { AddOnHeartbeatResult } from './add-ons/add-ons-jobs.service';

const DAY_MS = 24 * 60 * 60 * 1000;
const BATCH = 200;

export interface BillingHeartbeatResult {
  restricted: number;
  reminders: number;
  /** G5c-2: add-on trial notices, expiries and renewal charges. */
  addOns: AddOnHeartbeatResult;
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
 * spends the tenant's SMS credits. TRIAL_ENDING carries the trial plan's
 * monthly price in the studio's billing currency as {planPrice} (G5c-1b)
 * when the plan is offered in that currency.
 *
 * G5c-2: the same heartbeat also runs the add-on marketplace jobs
 * (AddOnJobsService): trial notices, expiry of ended trials and cancelled
 * periods, and renewal charges with dunning.
 */
@Injectable()
export class BillingJobsService {
  private readonly logger = new Logger(BillingJobsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly messaging: MessagingService,
    private readonly addOnJobs: AddOnJobsService,
    @Optional() private readonly platformEvents?: PlatformEventsService,
  ) {}

  async run(now = new Date()): Promise<BillingHeartbeatResult> {
    const restricted = await this.restrictExpired(now);
    const reminders = await this.sendReminders(now);
    const addOns = await this.addOnJobs.run(now);
    return { restricted, reminders, addOns };
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
      select: {
        id: true,
        trialEndsAt: true,
        trialReminderSentDays: true,
        timezone: true,
        defaultLocale: true,
        countryCode: true,
        billingCurrency: true,
        subscriptions: {
          where: { status: { not: 'CANCELLED' } },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { plan: { select: { prices: { select: { currency: true, priceMonthly: true } } } } },
        },
      },
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
      // M4c: the platform tenant's automations hear about it once per threshold, exactly when the owner's notice is claimed.
      await this.emitTrialExpiring(studio.id, studio.trialEndsAt, daysLeft ?? threshold);
      const ok = await this.notifyOwner(
        studio.id,
        BILLING_TEMPLATE_KEYS.trialEnding,
        `trial-ending:${studio.id}:${threshold}:${studio.trialEndsAt.toISOString()}`,
        {
          daysLeft: daysLeft ?? threshold,
          trialEndDate: formatDate(studio.trialEndsAt, studio.defaultLocale, studio.timezone),
          ...planPriceVariable(studio.subscriptions[0]?.plan.prices ?? [], studioBillingCurrency(studio), studio.defaultLocale),
        },
      );
      if (ok) sent++;
    }
    return sent;
  }

  private async emitTrialExpiring(studioId: string, trialEndsAt: Date, daysLeft: number): Promise<void> {
    if (!this.platformEvents) return;
    const studio = await this.prisma.studio.findUnique({ where: { id: studioId }, select: { name: true } });
    await this.platformEvents.emit('studio.trial_expiring', { studioId, name: studio?.name ?? null, trialEndsAt: trialEndsAt.toISOString(), daysLeft });
  }

  private notifyOwner(studioId: string, templateKey: string, idempotencyKey: string, variables: Record<string, string | number>): Promise<boolean> {
    return notifyStudioOwner({ prisma: this.prisma, messaging: this.messaging, logger: this.logger }, studioId, templateKey, idempotencyKey, variables);
  }
}

/** {planPrice}: the monthly price in the billing currency, formatted for the studio's language; omitted when not offered. */
function planPriceVariable(prices: { currency: string; priceMonthly: { toString(): string } }[], currency: string, locale: string): { planPrice?: string } {
  const price = planPriceIn(prices, currency);
  if (!price) return {};
  const amount = Number(price.priceMonthly.toString());
  try {
    return { planPrice: new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount) };
  } catch {
    return { planPrice: `${price.priceMonthly.toString()} ${currency}` };
  }
}

function formatDate(date: Date, locale: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}
