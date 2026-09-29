import { Injectable, Logger } from '@nestjs/common';
import { PayoutSyncService } from './payout-sync.service';

export interface PayoutsHeartbeatResult {
  synced: number;
  payouts: number;
  failed: number;
}

/**
 * Payout sync heartbeat (G5d-2), run from JobsService.runAll every 15
 * minutes. Each studio and provider is visited at most every 6 hours, so
 * most runs do nothing. Needs no Redis: it is plain function calls like the
 * other heartbeat steps.
 */
@Injectable()
export class PayoutsJobsService {
  private readonly logger = new Logger(PayoutsJobsService.name);

  constructor(private readonly sync: PayoutSyncService) {}

  async run(now = new Date()): Promise<PayoutsHeartbeatResult> {
    try {
      return await this.sync.syncDue(now);
    } catch (err) {
      // A failing payout sync must never stop the rest of the heartbeat.
      this.logger.error(`Payout sync run failed: ${(err as Error).message}`);
      return { synced: 0, payouts: 0, failed: 1 };
    }
  }
}
