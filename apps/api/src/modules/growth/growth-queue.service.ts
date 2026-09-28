import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';

export const GROWTH_QUEUE = 'growth';
export const JOURNEY_ENROLLMENT_JOB = 'journey-enrollment';
export const CAMPAIGN_BATCH_JOB = 'campaign-batch';

export interface JourneyEnrollmentJobData {
  enrollmentId: string;
}

export interface CampaignBatchJobData {
  campaignId: string;
}

/**
 * BullMQ jobs for campaigns and journeys (G2a). With Redis (production)
 * every journey step and every campaign batch is its own job, delayed until
 * it is due; without Redis (local development, the e2e suite) nothing is
 * queued and the 15-minute scheduler heartbeat runs the same idempotent
 * code (JourneyEngineService.processDue, CampaignsRunner.processDue). The
 * heartbeat also runs in production as the safety net for a lost job.
 */
@Injectable()
export class GrowthQueueService {
  private readonly logger = new Logger(GrowthQueueService.name);

  constructor(@Optional() @InjectQueue(GROWTH_QUEUE) private readonly queue?: Queue) {}

  get enabled(): boolean {
    return Boolean(this.queue);
  }

  async scheduleEnrollment(enrollmentId: string, runAt: Date): Promise<void> {
    if (!this.queue) return;
    const delay = Math.max(0, runAt.getTime() - Date.now());
    await this.add(JOURNEY_ENROLLMENT_JOB, { enrollmentId } satisfies JourneyEnrollmentJobData, `${enrollmentId}:${runAt.getTime()}`, delay);
  }

  async scheduleCampaign(campaignId: string, runAt: Date): Promise<void> {
    if (!this.queue) return;
    const delay = Math.max(0, runAt.getTime() - Date.now());
    await this.add(CAMPAIGN_BATCH_JOB, { campaignId } satisfies CampaignBatchJobData, `${campaignId}:${runAt.getTime()}`, delay);
  }

  private async add(name: string, data: object, jobId: string, delay: number): Promise<void> {
    try {
      await this.queue!.add(name, data, { jobId, delay, removeOnComplete: 1000, removeOnFail: 1000, attempts: 3, backoff: { type: 'exponential', delay: 60_000 } });
    } catch (err) {
      // The heartbeat picks the work up anyway; a queue outage must not fail the request.
      this.logger.warn(`Could not queue ${name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
