import { Injectable, Logger } from '@nestjs/common';
import { AutomationRunnerService, RunOutcome } from '../automations/automation-runner.service';
import { DunningService, DunningOutcome } from '../payments/dunning.service';
import { ConsentService } from '../notifications/consent/consent.service';
import { ChurnService } from '../churn/churn.service';
import { RatingPromptService } from '../feedback/rating-prompt.service';
import { ReferralsService } from '../feedback/referrals.service';
import { PartnerSyncService, PartnerSyncOutcome } from '../partners/partner-sync.service';

export interface SchedulerRunResult {
  runAt: string;
  automations: RunOutcome[];
  dunning: DunningOutcome[];
  consentSync: { synced: number; failed: number };
  churn: { studiosProcessed: number; membersScored: number };
  ratingPrompts: { prompted: number };
  referrals: { evaluated: number };
  partnerSync: PartnerSyncOutcome;
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

  constructor(
    private readonly automations: AutomationRunnerService,
    private readonly dunning: DunningService,
    private readonly consent: ConsentService,
    private readonly churn: ChurnService,
    private readonly ratingPrompts: RatingPromptService,
    private readonly referrals: ReferralsService,
    private readonly partnerSync: PartnerSyncService,
  ) {}

  async runAll(now = new Date()): Promise<SchedulerRunResult> {
    const automations = await this.automations.runDueRules(now);
    const dunning = await this.dunning.runDueRenewals(now);
    const consentSync = await this.consent.syncPendingConsents();
    const churn = await this.churn.recomputeStale(now);
    const ratingPrompts = await this.ratingPrompts.promptRecentAttendees(now);
    const referrals = await this.referrals.recomputeOpen();
    const partnerSyncResult = await this.partnerSync.runSync(now);

    this.logger.log(
      `Scheduler heartbeat at ${now.toISOString()}: ${automations.length} automation rule(s), ` +
        `${dunning.length} dunning subscription(s), consent sync ${consentSync.synced} synced/${consentSync.failed} failed, ` +
        `churn ${churn.studiosProcessed} studio(s), ${ratingPrompts.prompted} rating prompt(s), ${referrals.evaluated} referral(s), ` +
        `partner sync ${partnerSyncResult.availabilityPushed} push(es)`,
    );

    return {
      runAt: now.toISOString(),
      automations,
      dunning,
      consentSync,
      churn,
      ratingPrompts,
      referrals,
      partnerSync: partnerSyncResult,
    };
  }
}
