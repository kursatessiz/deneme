import { Injectable, Logger } from '@nestjs/common';
import { AutomationRunnerService, RunOutcome } from '../automations/automation-runner.service';
import { DunningService, DunningOutcome } from '../payments/dunning.service';
import { ConsentService } from '../notifications/consent/consent.service';

export interface SchedulerRunResult {
  runAt: string;
  automations: RunOutcome[];
  dunning: DunningOutcome[];
  consentSync: { synced: number; failed: number };
}

/**
 * The single unit of work run every 15 minutes: automation rule evaluation
 * (W10), dunning retries (W6) and İYS consent sync (W7). All three are safe
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
  ) {}

  async runAll(now = new Date()): Promise<SchedulerRunResult> {
    const automations = await this.automations.runDueRules(now);
    const dunning = await this.dunning.runDueRenewals(now);
    const consentSync = await this.consent.syncPendingConsents();

    this.logger.log(
      `Scheduler heartbeat at ${now.toISOString()}: ${automations.length} automation rule(s), ` +
        `${dunning.length} dunning subscription(s), consent sync ${consentSync.synced} synced/${consentSync.failed} failed`,
    );

    return { runAt: now.toISOString(), automations, dunning, consentSync };
  }
}
