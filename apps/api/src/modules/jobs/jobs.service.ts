import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { SCHEDULER_QUEUE } from './jobs.constants';
import { AutomationRunnerService, RunOutcome } from '../automations/automation-runner.service';
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

export interface SchedulerRunResult {
  runAt: string;
  automations: RunOutcome[];
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
}

/**
 * The single unit of work run every 15 minutes: automation rule evaluation
 * (W10), dunning retries (W6), İYS consent sync (W7) and the daily churn-risk
 * refresh (W12, only studios scored more than 20 hours ago), rating prompts
 * and referral qualification (W15). All are safe
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
    private readonly automations: AutomationRunnerService,
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
    @Optional() @InjectQueue(SCHEDULER_QUEUE) private readonly queue?: Queue,
  ) {}

  /** Waiting + delayed job count on the scheduler queue, or null without Redis. Used by admin system health. */
  async getQueueDepth(): Promise<number | null> {
    if (!this.queue) return null;
    const counts = await this.queue.getJobCounts('waiting', 'delayed');
    return (counts.waiting ?? 0) + (counts.delayed ?? 0);
  }

  async runAll(now = new Date()): Promise<SchedulerRunResult> {
    const automations = await this.automations.runDueRules(now);
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

    this.logger.log(
      `Scheduler heartbeat at ${now.toISOString()}: ${automations.length} automation rule(s), ` +
        `${dunning.length} dunning subscription(s), consent sync ${consentSync.synced} synced/${consentSync.failed} failed, ` +
        `churn ${churn.studiosProcessed} studio(s), ${ratingPrompts.prompted} rating prompt(s), ${referrals.evaluated} referral(s), ` +
        `webhooks ${webhooks.succeeded} succeeded/${webhooks.failed} retrying/${webhooks.abandoned} abandoned, ` +
        `partner sync ${partnerSyncResult.availabilityPushed} push(es), ` +
        `${joinReminders.reminded} join reminder(s), sms provider balance ${smsProviderBalance.status}, ` +
        `${crmLifecycle.lapsed} contact(s) lapsed, conversion delivery ${conversionDelivery.sent} sent/${conversionDelivery.retrying} retrying/${conversionDelivery.failed} failed, ` +
        `ad spend sync ${adSpendSync ? `${adSpendSync.connectionsSynced} connection(s)` : 'skipped (not due)'}`,
    );

    this.lastRunAt = now;
    return {
      runAt: now.toISOString(),
      automations,
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
    };
  }
}
