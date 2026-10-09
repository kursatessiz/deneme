import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { SCHEDULER_JOB_NAME, SCHEDULER_QUEUE } from './jobs.constants';
import { MembersService } from '../members/members.service';
import { ErrorCaptureService } from '../error-reporting/error-capture.service';
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
import { OAuthRefreshService, type OAuthRefreshResult } from '../platform-marketing/oauth/oauth-refresh.service';
import { EmailDomainService, type EmailDomainHeartbeatResult } from '../platform-marketing/integrations/email-domain.service';
import { BackupsJobsService } from '../backups/backups.module';
import type { BackupsHeartbeatResult } from '../backups/backups.module';

export interface SchedulerRunResult {
  runAt: string;
  growth: GrowthHeartbeatResult;
  dunning: DunningOutcome[];
  consentSync: { synced: number; failed: number };
  churn: { studiosProcessed: number; membersScored: number };
  /** Frozen packages whose freeze period ended and that returned to ACTIVE. */
  packageFreezes: { released: number };
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
  /** M4a: OAuth tokens refreshed, retrying or needing a reconnect; old OAuth states purged. */
  oauthRefresh: OAuthRefreshResult;
  /** M5: sender domains re-checked (DKIM from SES when configured, DNS otherwise). */
  emailDomains: EmailDomainHeartbeatResult;
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
  /** Names of the steps that threw in the current run; reported in the heartbeat log line. */
  private failedSteps: string[] = [];

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
    private readonly oauthRefresh: OAuthRefreshService,
    private readonly emailDomains: EmailDomainService,
    private readonly members: MembersService,
    @Optional() private readonly errors?: ErrorCaptureService,
    @Optional() @InjectQueue(SCHEDULER_QUEUE) private readonly queue?: Queue,
  ) {}

  /** Waiting + delayed job count on the scheduler queue, or null without Redis. Used by admin system health. */
  async getQueueDepth(): Promise<number | null> {
    if (!this.queue) return null;
    const counts = await this.queue.getJobCounts('waiting', 'delayed');
    return (counts.waiting ?? 0) + (counts.delayed ?? 0);
  }

  /**
   * Runs one heartbeat step in isolation: a throw is logged and captured
   * (ErrorCaptureService, source `job`) and the step yields its empty
   * fallback, so one broken subsystem cannot stop the steps after it.
   */
  private async step<T>(name: string, fn: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      this.failedSteps.push(name);
      this.logger.error(`Scheduler step "${name}" failed: ${err instanceof Error ? err.message : String(err)}`);
      this.errors?.capture({ source: 'job', error: err, route: `job ${SCHEDULER_QUEUE}/${SCHEDULER_JOB_NAME}/${name}` });
      return fallback;
    }
  }

  async runAll(now = new Date()): Promise<SchedulerRunResult> {
    this.failedSteps = [];
    const growth = await this.step('growth', () => this.growth.run(now), {
      legacyMigrated: 0,
      segmentsRefreshed: 0,
      segmentEntries: 0,
      journeysScanned: 0,
      journeysEnrolled: 0,
      journeySteps: 0,
      journeysCompleted: 0,
      campaigns: { campaigns: 0, sent: 0, skipped: 0, failed: 0 },
      approvalsExpired: 0,
      marketingGuards: {
        fuse: { checked: false, tripped: [], pausedCampaigns: 0, alertsSent: 0 },
        adSpendAlerts: 0,
        adCapPaused: 0,
        adCapPauseFailed: 0,
      },
      contactConsentSync: { synced: 0, failed: 0 },
    });
    const dunning = await this.step('dunning', () => this.dunning.runDueRenewals(now), []);
    const consentSync = await this.step('consentSync', () => this.consent.syncPendingConsents(), { synced: 0, failed: 0 });
    const churn = await this.step('churn', () => this.churn.recomputeStale(now), { studiosProcessed: 0, membersScored: 0 });
    const packageFreezes = await this.step('packageFreezes', () => this.members.releaseElapsedFreezes(now), { released: 0 });
    const ratingPrompts = await this.step('ratingPrompts', () => this.ratingPrompts.promptRecentAttendees(now), { prompted: 0 });
    const referrals = await this.step('referrals', () => this.referrals.recomputeOpen(), { evaluated: 0 });
    const webhooks = await this.step('webhooks', () => this.webhookDispatcher.dispatchDue(now), {
      attempted: 0,
      succeeded: 0,
      failed: 0,
      abandoned: 0,
    });
    const partnerSyncResult = await this.step('partnerSync', () => this.partnerSync.runSync(now), {
      releasedAllocations: 0,
      availabilityPushed: 0,
      availabilityFailed: 0,
      reconciledCheckIns: 0,
    });
    const joinReminders = await this.step('joinReminders', () => this.joinReminders.sendDueReminders(now), { reminded: 0 });
    const smsProviderBalance = await this.step('smsProviderBalance', () => this.smsProviderBalance.checkIfDue(now), {
      provider: 'MOCK',
      status: 'error',
      credits: null,
      threshold: 0,
      checkedAt: now.toISOString(),
    });
    const crmLifecycle = await this.step('crmLifecycle', () => this.crm.sweepLapsed(now), { lapsed: 0 });
    // M4a: before the steps that call ad and social APIs, so they use a fresh token.
    const oauthRefresh = await this.step('oauthRefresh', () => this.oauthRefresh.processDue(now), {
      refreshed: 0,
      retrying: 0,
      reauthRequired: 0,
      statesPurged: 0,
    });
    const conversionDelivery = await this.step('conversionDelivery', () => this.conversionDelivery.dispatchDue(now), {
      attempted: 0,
      sent: 0,
      skipped: 0,
      retrying: 0,
      failed: 0,
    });
    const adSpendSync = await this.step<SpendSyncOutcome | null>('adSpendSync', () => this.adSpendSync.syncAllDueIfStale(now), null);
    // M3d: after the spend sync, so the week's ad spend is in when the summary is written.
    const marketingInsights = await this.step<WeeklyRunResult>('marketingInsights', () => this.marketingInsights.runWeekly(now), {
      generated: false,
      skipped: null,
    });
    const leadAds = await this.step('leadAds', () => this.leadAds.processDue(now), { processed: 0, retrying: 0, failed: 0 });
    const loyalty = await this.step('loyalty', () => this.loyalty.run(now), {
      birthdayPoints: 0,
      expiredMembers: 0,
      expiredPoints: 0,
      expiryNotices: 0,
    });
    const events = await this.step('events', () => this.events.run(now), { holdsReleased: 0, promoted: 0, reminders: 0, completed: 0 });
    const billing = await this.step('billing', () => this.billing.run(now), {
      restricted: 0,
      reminders: 0,
      addOns: { reminders: 0, expired: 0, renewed: 0, failed: 0 },
    });
    const payouts = await this.step('payouts', () => this.payouts.run(now), { synced: 0, payouts: 0, failed: 0 });
    const socialPublishing = await this.step('socialPublishing', () => this.socialPublishing.processDue(now), {
      published: 0,
      retrying: 0,
      deferred: 0,
      failed: 0,
      skipped: 0,
      interrupted: 0,
    });
    // M5: after the OAuth refresh; reads the SES identity status (or DNS) of the platform's sender domains.
    const emailDomains = await this.step('emailDomains', () => this.emailDomains.processDue(now), { checked: 0, failed: 0 });
    const errorReporting = await this.step('errorReporting', () => this.errorReporting.run(now), {
      purged: 0,
      sourcemapsPurged: 0,
      digestSent: false,
      bucketsPurged: 0,
      spikeAlerts: 0,
      sinkRetries: 0,
      sinkRetriesSucceeded: 0,
    });
    // Only starts the daily backup in the background; the run itself does not block the heartbeat.
    const backups = await this.step<BackupsHeartbeatResult>('backups', () => this.backups.run(now), {
      scheduled: { started: false, runId: null, reason: 'NOT_DUE' },
      status: 'error',
      staleAlertSent: false,
    });
    // Last: AI translation batches may take a while; the other steps are time-sensitive.
    const aiTranslation = await this.step('aiTranslation', () => this.aiTranslation.processPending(now), { jobs: 0, paused: 0 });

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
        `billing ${billing.restricted} trial(s) restricted/${billing.reminders} reminder(s)/add-ons ${billing.addOns.expired} expired/${billing.addOns.renewed} renewed/${billing.addOns.failed} failed, ` +
        `payouts ${payouts.synced} synced/${payouts.payouts} payout(s)/${payouts.failed} failed, ` +
        `errors ${errorReporting.purged} event(s) purged/digest ${errorReporting.digestSent ? 'sent' : 'not due'}, ` +
        `backups ${backups.scheduled.reason.toLowerCase()}/status ${backups.status}${backups.staleAlertSent ? '/alert sent' : ''}, ` +
        `social ${socialPublishing.published} published/${socialPublishing.retrying} retrying/${socialPublishing.deferred} deferred/${socialPublishing.failed} failed, ` +
        `oauth ${oauthRefresh.refreshed} refreshed/${oauthRefresh.retrying} retrying/${oauthRefresh.reauthRequired} reauth required, ` +
        `email domains ${emailDomains.checked} checked/${emailDomains.failed} failed, ` +
        `package freezes ${packageFreezes.released} released, ` +
        `failed steps ${this.failedSteps.length ? this.failedSteps.join(',') : 'none'}`,
    );

    this.lastRunAt = now;
    return {
      runAt: now.toISOString(),
      growth,
      dunning,
      consentSync,
      churn,
      packageFreezes,
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
      oauthRefresh,
      emailDomains,
    };
  }
}
