import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@platform/database';
import {
  CAP_DEFERRED_REASON_CODES,
  FUSE_ALERT_INTERVAL_HOURS,
  FUSE_PAUSE_REASON_CODES,
  FUSE_REASONS,
  FUSE_WINDOW_HOURS,
  MARKETING_GUARD_TEMPLATE_KEYS,
  DailyCapTracker,
  adSpendAlertKey,
  adSpendCapStatuses,
  evaluateEmailFuse,
  formatMoney,
  fuseAlertKey,
  isFuseTarget,
  parseWarmupPlan,
  pauseReasonFor,
  effectiveEmailCap,
  remainingCap,
  utcDayStart,
  utcMonthStart,
  type AdSpendCapStatus,
  type DashboardHealth,
  type EffectiveEmailCap,
  type FuseReason,
} from '@platform/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { MarketingNoticeService } from './approval/marketing-notice.service';
import { MarketingSettingsService } from './approval/marketing-settings.service';

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
/** Statuses of an e-mail the provider accepted (denominator of the fuse and of the dashboard health). */
const ACCEPTED_EMAIL_STATUSES = ['SENT', 'DELIVERED', 'BOUNCED', 'COMPLAINED'] as const;

export interface FuseRunResult {
  /** False when there is no platform tenant. */
  checked: boolean;
  tripped: FuseReason[];
  pausedCampaigns: number;
  alertsSent: number;
}

export interface MarketingGuardsResult {
  fuse: FuseRunResult;
  adSpendAlerts: number;
}

/**
 * The guard rails of the platform's own marketing (M3d, docs/PAZARLAMA_MODULU.md
 * 6.2): the e-mail deliverability fuse (auto-pause), the daily send caps with
 * the warm-up plan, and the monthly ad spend cap per currency. Everything is
 * scoped to the platform tenant. The heartbeat calls `run`; the send path asks
 * `trackerFor` for the room left under today's caps; the dashboard reads the
 * state through `health`.
 */
@Injectable()
export class MarketingGuardsService {
  private readonly logger = new Logger(MarketingGuardsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: MarketingSettingsService,
    private readonly notices: MarketingNoticeService,
  ) {}

  async platformStudioId(): Promise<string | null> {
    const studio = await this.prisma.studio.findFirst({ where: { isPlatform: true }, select: { id: true } });
    return studio?.id ?? null;
  }

  /** Heartbeat step: the fuse first (so a paused campaign does not send in the same run), then the ad spend cap. */
  async run(now: Date): Promise<MarketingGuardsResult> {
    const fuse = await this.runFuse(now);
    const adSpendAlerts = await this.runAdSpendCaps(now);
    return { fuse, adSpendAlerts };
  }

  // ---------------------------------------------------------------------------
  // Deliverability fuse
  // ---------------------------------------------------------------------------

  /** E-mail counts of the platform tenant in the last FUSE_WINDOW_HOURS. */
  private async emailWindow(studioId: string, now: Date): Promise<{ sent: number; bounced: number; complained: number }> {
    const window = { studioId, channel: 'EMAIL' as const, createdAt: { gt: new Date(now.getTime() - FUSE_WINDOW_HOURS * HOUR_MS), lte: now } };
    const [sent, bounced, complained] = await Promise.all([
      this.prisma.notificationLog.count({
        where: { ...window, OR: [{ status: { in: [...ACCEPTED_EMAIL_STATUSES] } }, { bouncedAt: { not: null } }, { complainedAt: { not: null } }] },
      }),
      this.prisma.notificationLog.count({ where: { ...window, OR: [{ status: 'BOUNCED' }, { bouncedAt: { not: null } }] } }),
      this.prisma.notificationLog.count({ where: { ...window, OR: [{ status: 'COMPLAINED' }, { complainedAt: { not: null } }] } }),
    ]);
    return { sent, bounced, complained };
  }

  /**
   * When the last 24 hours of e-mail exceed the bounce or complaint threshold,
   * every SENDING or SCHEDULED e-mail campaign goes to PAUSED with a stored
   * reason and an audit entry, and the super admins are alerted (at most once
   * per 24 hours per reason). Resuming stays manual (POST .../resume); if the
   * rates are still over the threshold the next run pauses the campaign again.
   */
  async runFuse(now: Date): Promise<FuseRunResult> {
    const studioId = await this.platformStudioId();
    if (!studioId) return { checked: false, tripped: [], pausedCampaigns: 0, alertsSent: 0 };
    const config = await this.settings.get(studioId);
    const counts = await this.emailWindow(studioId, now);
    const result = evaluateEmailFuse({ ...counts, bouncePausePct: config.bounceAutoPausePct, complaintPausePct: config.complaintAutoPausePct });
    if (result.tripped.length === 0) return { checked: true, tripped: [], pausedCampaigns: 0, alertsSent: 0 };

    const reasonCode = pauseReasonFor(result.tripped);
    const candidates = await this.prisma.campaign.findMany({
      where: { studioId, status: { in: ['SENDING', 'SCHEDULED'] }, OR: [{ channel: 'EMAIL' }, { channel: null }] },
      select: { id: true, status: true, channel: true },
    });
    let paused = 0;
    for (const campaign of candidates) {
      if (!isFuseTarget(campaign)) continue;
      const moved = await this.prisma.$transaction(async (tx) => {
        const updated = await tx.campaign.updateMany({ where: { id: campaign.id, status: campaign.status }, data: { status: 'PAUSED', pauseReason: reasonCode } });
        if (updated.count === 0) return false;
        await tx.auditLog.create({
          data: {
            studioId,
            userId: null,
            action: 'marketing.campaign.auto_paused',
            entityType: 'Campaign',
            entityId: campaign.id,
            metadata: {
              from: campaign.status,
              reasons: result.tripped,
              reasonCode,
              sent: counts.sent,
              bounced: counts.bounced,
              complained: counts.complained,
              windowHours: FUSE_WINDOW_HOURS,
              at: now.toISOString(),
            } as Prisma.InputJsonValue,
          },
        });
        return true;
      });
      if (moved) paused += 1;
    }

    let alertsSent = 0;
    for (const reason of result.tripped) {
      const rate = reason === 'BOUNCE' ? result.bounceRate : result.complaintRate;
      const thresholdPct = reason === 'BOUNCE' ? config.bounceAutoPausePct : config.complaintAutoPausePct;
      const sent = await this.notices.alertSuperAdminsOnce({
        studioId,
        key: fuseAlertKey(reason),
        since: new Date(now.getTime() - FUSE_ALERT_INTERVAL_HOURS * HOUR_MS),
        now,
        templateKey: MARKETING_GUARD_TEMPLATE_KEYS.fuseTripped,
        variablesFor: (t, locale) => {
          const percent = new Intl.NumberFormat(locale, { style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 });
          return {
            reason: t(`marketingGuards.reason.${reason}`),
            rate: percent.format(rate ?? 0),
            threshold: percent.format(thresholdPct / 100),
            campaigns: paused,
            link: this.notices.link(),
          };
        },
      });
      if (sent) alertsSent += 1;
    }
    if (paused > 0) this.logger.warn(`E-mail fuse tripped (${result.tripped.join(', ')}): ${paused} campaign(s) paused`);
    return { checked: true, tripped: result.tripped, pausedCampaigns: paused, alertsSent };
  }

  /** Campaigns the system holds paused, for the dashboard. */
  async autoPauseState(studioId: string): Promise<DashboardHealth['autoPause']> {
    const rows = await this.prisma.campaign.groupBy({
      by: ['pauseReason'],
      where: { studioId, status: 'PAUSED', pauseReason: { not: null } },
      _count: { _all: true },
    });
    const reasons = FUSE_REASONS.filter((reason) => rows.some((r) => r.pauseReason === FUSE_PAUSE_REASON_CODES[reason]));
    const pausedCampaigns = rows.reduce((sum, r) => sum + r._count._all, 0);
    return { active: pausedCampaigns > 0, pausedCampaigns, reasons };
  }

  // ---------------------------------------------------------------------------
  // Daily caps
  // ---------------------------------------------------------------------------

  /** The day the marketing sender domain was verified (start of the warm-up), or null. */
  private async warmupStart(studioId: string): Promise<Date | null> {
    const domain = await this.prisma.emailSenderDomain.findFirst({
      where: { studioId, purpose: 'MARKETING', warmupStartedAt: { not: null } },
      orderBy: { warmupStartedAt: 'asc' },
      select: { warmupStartedAt: true },
    });
    return domain?.warmupStartedAt ?? null;
  }

  /** Commercial e-mails accepted and SMS credits spent since 00:00 UTC. */
  async usageToday(studioId: string, now: Date): Promise<{ emailSent: number; smsCredits: number }> {
    const since = utcDayStart(now);
    const [emailSent, sms] = await Promise.all([
      this.prisma.notificationLog.count({
        where: { studioId, channel: 'EMAIL', purpose: 'COMMERCIAL', status: { in: [...ACCEPTED_EMAIL_STATUSES] }, createdAt: { gte: since, lte: now } },
      }),
      this.prisma.smsTransaction.aggregate({ where: { studioId, type: 'USAGE', createdAt: { gte: since, lte: now } }, _sum: { amount: true } }),
    ]);
    return { emailSent, smsCredits: Math.max(0, -(sms._sum.amount ?? 0)) };
  }

  /** The e-mail cap of today (configured cap or the warm-up plan's, whichever is lower) and the SMS credit cap. */
  async capsOf(studioId: string, now: Date): Promise<{ email: EffectiveEmailCap; smsCap: number | null }> {
    const config = await this.settings.get(studioId);
    const email = effectiveEmailCap({
      dailyCap: config.dailyEmailCap,
      warmupPlan: parseWarmupPlan(config.emailWarmupPlan),
      warmupStartedAt: config.emailWarmupPlan ? await this.warmupStart(studioId) : null,
      now,
    });
    return { email, smsCap: config.dailySmsCreditCap };
  }

  /** Room left under today's caps for a send at `now`; null when neither cap is set. */
  async trackerFor(studioId: string, now: Date): Promise<DailyCapTracker | null> {
    const { email, smsCap } = await this.capsOf(studioId, now);
    if (email.cap === null && smsCap === null) return null;
    const usage = await this.usageToday(studioId, now);
    return new DailyCapTracker(remainingCap(email.cap, usage.emailSent), remainingCap(smsCap, usage.smsCredits));
  }

  /** Dashboard block: today's sends against the caps and the recipients waiting for the next day. */
  async capsHealth(studioId: string, now: Date): Promise<DashboardHealth['caps']> {
    const [{ email, smsCap }, usage, deferred] = await Promise.all([
      this.capsOf(studioId, now),
      this.usageToday(studioId, now),
      this.prisma.campaignRecipient.count({
        where: { studioId, status: 'PENDING', reasonCode: { in: Object.values(CAP_DEFERRED_REASON_CODES) } },
      }),
    ]);
    return {
      email: { sent: usage.emailSent, cap: email.cap, source: email.source, warmupDay: email.warmupDay },
      sms: { credits: usage.smsCredits, cap: smsCap },
      deferredRecipients: deferred,
    };
  }

  // ---------------------------------------------------------------------------
  // Monthly ad spend cap
  // ---------------------------------------------------------------------------

  /** Month-to-date spend of the campaign level rows (a campaign's spend already includes its ad sets and ads) against the caps, per currency. */
  async adSpendCaps(studioId: string, now: Date): Promise<AdSpendCapStatus[]> {
    const config = await this.settings.get(studioId);
    if (Object.keys(config.monthlyAdSpendCaps).length === 0) return [];
    const rows = await this.prisma.adSpendDaily.groupBy({
      by: ['currency'],
      where: { studioId, level: 'CAMPAIGN', date: { gte: utcMonthStart(now), lt: new Date(utcDayStart(now).getTime() + DAY_MS) } },
      _sum: { spendAmount: true },
    });
    const spent = Object.fromEntries(rows.map((r) => [r.currency, (r._sum.spendAmount ?? new Prisma.Decimal(0)).toFixed(4)]));
    return adSpendCapStatuses(config.monthlyAdSpendCaps, spent);
  }

  /** Alerts the super admins once per month per currency whose spend passed its cap. No automatic ad pause (M5). */
  async runAdSpendCaps(now: Date): Promise<number> {
    const studioId = await this.platformStudioId();
    if (!studioId) return 0;
    let sent = 0;
    for (const status of await this.adSpendCaps(studioId, now)) {
      if (!status.exceeded) continue;
      const alerted = await this.notices.alertSuperAdminsOnce({
        studioId,
        key: adSpendAlertKey(status.currency, now),
        since: utcMonthStart(now),
        now,
        templateKey: MARKETING_GUARD_TEMPLATE_KEYS.adCapExceeded,
        variablesFor: (_t, locale) => ({
          currency: status.currency,
          spent: formatMoney({ amount: status.spent, currency: status.currency }, locale),
          cap: formatMoney({ amount: status.cap, currency: status.currency }, locale),
          month: new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(now),
          link: this.notices.link(),
        }),
      });
      if (alerted) sent += 1;
    }
    return sent;
  }
}
