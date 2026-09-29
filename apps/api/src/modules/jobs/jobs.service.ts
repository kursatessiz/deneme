import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { SCHEDULER_QUEUE } from './jobs.constants';
import { GrowthHeartbeatService, GrowthHeartbeatResult } from '../growth/growth-heartbeat.service';
import { DunningService, DunningOutcome } from '../payments/dunning.service';
import { ConsentService } from '../notifications/consent/consent.service';
import { ChurnService } from '../churn/churn.service';
import { RatingPromptService } from '../feedback/rating-prompt.service';
import { ReferralsService } from '../feedback/referrals.service';
import { WebhookDispatcherService, DispatchOutcome } from '../webhooks/webhook-dispatcher.service';
import { PartnerSyncService, PartnerSyncOutcome } from '../partners/partner-sync.service';
import { JoinReminderService } from '../video/join-reminder.service';
import { SmsProviderBalanceService, SmsProviderBalanceResult } from '../notifications/sms-provider-balance.service';
import { CrmHooksService } from '../crm/hooks/crm-hooks.service';
import { ConversionDeliveryDispatcherService, DispatchOutcome as ConversionDispatchOutcome } from '../ads/delivery/conversion-delivery-dispatcher.service';
import { AdSpendSyncService, SpendSyncOutcome } from '../ads/spend-sync/ad-spend-sync.service';
import { LeadAdsService, DueResult as LeadAdsResult } from '../lead-ads/lead-ads.service';
import { TranslationEngineService } from '../ai/translation/translation-engine.service';
import { MarketingInsightsService, type WeeklyRunResult } from '../platform-marketing/insights/marketing-insights.service';
import { LoyaltyJobsService, LoyaltyHeartbeatResult } from '../loyalty/loyalty-jobs.service';
import { EventsJobsService, EventsHeartbeatResult } from '../events/events-jobs.service';
import { BillingJobsService, BillingHeartbeatResult } from '../billing/billing-jobs.service';
import { PayoutsJobsService, PayoutsHeartbeatResult } from '../payouts/payouts-jobs.service';
import { ErrorReportingJobsService, ErrorReportingHeartbeatResult } from '../error-reporting/error-reporting-jobs.service';
import { SocialPublishingService, type SocialHeartbeatResult } from '../social/social-publishing.service';
import { BackupsJobsService } from '../backups/backups.module';
import type { BackupsHeartbeatResult } from '../backups/backups.module';

export interface SchedulerRunResult {
  runAt: string;
  growth: GrowthHeartbeatResult;
  dunning: DunningOutcome[];
  consentSync: { synced: number; failed: number };
  churn: { studiosProcessed: number; membersScored: number };
  ratingPrompts: { prompted: number };
  referrals: { evaluated: number };
  webhooks: DispatchOutcome;
  partnerSync: PartnerSyncOutcome;
  joinReminders: { reminded: number };
  smsProviderBalance: SmsProviderBalanceResult;
  crmLifecycle: { lapsed: number };
  conversionDelivery: ConversionDispatchOutcome;
  adSpendSync: SpendSyncOutcome | null;
  leadAds: LeadAdsResult;
  aiTranslation: { jobs: number; paused: number };
  /** M3d: the weekly marketing summary of the platform tenant. */
  marketingInsights: WeeklyRunResult;
  loyalty: LoyaltyHeartbeatResult;
  events: EventsHeartbeatResult;
  billing: BillingHeartbeatResult;
  payouts: PayoutsHeartbeatResult;
  errorReporting: ErrorReportingHeartbeatResult;
  backups: BackupsHeartbeatResult;
  /** M4b: due organic social posts published, retried, deferred or failed. */
  socialPublishing: SocialHeartbeatResult;
}

/**
 * The single unit of work run every 15 minutes: segments, journeys and
 * campaigns (G2a, which replaced the W10 automation rules), dunning retries (W6), İYS consent sync (W7) and the daily churn-risk
 * refresh (W12, only studios scored more than 20 hours ago), rating prompts
 * and referral qualification (W15), loyalty birthdays, expiry and notices (G3a), event payment holds, reminders and completion (G3c-1). All are safe
 * to call repeatedly (each guards its own idempotency), so one heartbeat
 * covers them instead of three separate queues - see docs/AUTOMATIONS.md and
 * HANDOVER.md 6c.
 *
 * This service has no dependency on Redis or BullMQ: it is called either by
 * the repeatable job in JobsModule (when REDIS_URL is configured) or
 * directly via the super-admin trigger endpoint / tests.
 */
@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);
  /** Set at the end of every heartbeat run; read by the admin system health endpoint. */
  private lastRunAt: Date | null = null;

  getLastRunAt(): Date | null {
    return this.lastRunAt;
  }

  constructor(
    private readonly growth: GrowthHeartbeatService,
    private readonly dunning: DunningService,
    private readonly consent: ConsentService,
    private readonly churn: ChurnService,
    private readonly ratingPrompts: RatingPromptService,
    private readonly referrals: ReferralsService,
    private readonly webhookDispatcher: WebhookDispatcherService,
    private readonly partnerSync: PartnerSyncService,
    private readonly joinReminders: JoinReminderService,
    private readonly smsProviderBalance: SmsProviderBalanceService,
    private readonly crm: CrmHooksService,
    private readonly conversionDelivery: ConversionDeliveryDispatcherService,
    private readonly adSpendSync: AdSpendSyncService,
    private readonly leadAds: LeadAdsService,
    private readonly aiTranslation: TranslationEngineService,
    private readonly marketingInsights: MarketingInsightsService,
    private readonly loyalty: LoyaltyJobsService,
    private readonly events: EventsJobsService,
    private readonly billing: BillingJobsService,
    private readonly payouts: PayoutsJobsService,
    private readonly errorReporting: ErrorReportingJobsService,
    private readonly backups: BackupsJobsService,
    private readonly socialPublishing: SocialPublishingService,
    @Optional() @InjectQueue(SCHEDULER_QUEUE) private readonly queue?: Queue,
  ) {}

  /** Waiting + delayed job count on the scheduler queue, or null without Redis. Used by admin system health. */
  async getQueueDepth(): Promise<number | null> {
    if (!this.queue) return null;
    const counts = await this.queue.getJobCounts('waiting', 'delayed');
    return (counts.waiting ?? 0) + (counts.delayed ?? 0);
  }

  async runAll(now = new Date()): Promise<SchedulerRunResult> {
    const growth = await this.growth.run(now);
    const dunning = await this.dunning.runDueRenewals(now);
    const consentSync = await this.consent.syncPendingConsents();
    const churn = await this.churn.recomputeStale(now);
    const ratingPrompts = await this.ratingPrompts.promptRecentAttendees(now);
    const referrals = await this.referrals.recomputeOpen();
    const webhooks = await this.webhookDispatcher.dispatchDue(now);
    const partnerSyncResult = await this.partnerSync.runSync(now);
    const joinReminders = await this.joinReminders.sendDueReminders(now);
    const smsProviderBalance = await this.smsProviderBalance.checkIfDue(now);
    const crmLifecycle = await this.crm.sweepLapsed(now);
    const conversionDelivery = await this.conversionDelivery.dispatchDue(now);
    const adSpendSync = await this.adSpendSync.syncAllDueIfStale(now);
    // M3d: after the spend sync, so the week's ad spend is in when the summary is written.
    const marketingInsights = await this.marketingInsights.runWeekly(now);
    const leadAds = await this.leadAds.processDue(now);
    const loyalty = await this.loyalty.run(now);
    const events = await this.events.run(now);
    const billing = await this.billing.run(now);
    const payouts = await this.payouts.run(now);
    const socialPublishing = await this.socialPublishing.processDue(now);
    const errorReporting = await this.errorReporting.run(now);
    // Only starts the daily backup in the background; the run itself does not block the heartbeat.
    const backups = await this.backups.run(now);
    // Last: AI translation batches may take a while; the other steps are time-sensitive.
    const aiTranslation = await this.aiTranslation.processPending(now);

    this.logger.log(
      `Scheduler heartbeat at ${now.toISOString()}: growth ${growth.journeySteps} journey step(s)/${growth.journeysEnrolled} enrolled, ` +
        `${growth.campaigns.sent} campaign message(s), ${growth.legacyMigrated} legacy rule(s) migrated, ` +
        `${dunning.length} dunning subscription(s), consent sync ${consentSync.synced} synced/${consentSync.failed} failed, ` +
        `churn ${churn.studiosProcessed} studio(s), ${ratingPrompts.prompted} rating prompt(s), ${referrals.evaluated} referral(s), ` +
        `webhooks ${webhooks.succeeded} succeeded/${webhooks.failed} retrying/${webhooks.abandoned} abandoned, ` +
        `partner sync ${partnerSyncResult.availabilityPushed} push(es), ` +
        `${joinReminders.reminded} join reminder(s), sms provider balance ${smsProviderBalance.status}, ` +
        `${crmLifecycle.lapsed} contact(s) lapsed, conversion delivery ${conversionDelivery.sent} sent/${conversionDelivery.retrying} retrying/${conversionDelivery.failed} failed, ` +
        `ad spend sync ${adSpendSync ? `${adSpendSync.connectionsSynced} connection(s)` : 'skipped (not due)'}, ` +
        `lead ads ${leadAds.processed} processed/${leadAds.retrying} retrying/${leadAds.failed} failed, ` +
        `AI translation ${aiTranslation.jobs} job(s)/${aiTranslation.paused} paused, ` +
        `loyalty ${loyalty.birthdayPoints} birthday point(s)/${loyalty.expiredPoints} expired/${loyalty.expiryNotices} notice(s), ` +
        `events ${events.holdsReleased} hold(s) released/${events.promoted} promoted/${events.reminders} reminder(s)/${events.completed} completed, ` +
        `billing ${billing.restricted} trial(s) restricted/${billing.reminders} reminder(s), ` +
        `payouts ${payouts.synced} synced/${payouts.payouts} payout(s)/${payouts.failed} failed`,
        `errors ${errorReporting.purged} event(s) purged/digest ${errorReporting.digestSent ? 'sent' : 'not due'}, ` +
        `backups ${backups.scheduled.reason.toLowerCase()}/status ${backups.status}${backups.staleAlertSent ? '/alert sent' : ''}, ` +
        `social ${socialPublishing.published} published/${socialPublishing.retrying} retrying/${socialPublishing.deferred} deferred/${socialPublishing.failed} failed`,
    );

    this.lastRunAt = now;
    return {
      runAt: now.toISOString(),
      growth,
      dunning,
      consentSync,
      churn,
      ratingPrompts,
      referrals,
      webhooks,
      partnerSync: partnerSyncResult,
      joinReminders,
      smsProviderBalance,
      crmLifecycle,
      conversionDelivery,
      adSpendSync,
      leadAds,
      aiTranslation,
      marketingInsights,
      loyalty,
      events,
      billing,
      payouts,
      errorReporting,
      backups,
      socialPublishing,
    };
  }
}
