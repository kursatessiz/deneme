import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { CAMPAIGN_BATCH_JOB, GROWTH_QUEUE, JOURNEY_ENROLLMENT_JOB } from './growth-queue.service';
import type { CampaignBatchJobData, JourneyEnrollmentJobData } from './growth-queue.service';
import { JourneyEngineService } from './journeys/journey-engine.service';
import { CampaignsService } from './campaigns/campaigns.service';

/**
 * In-process worker for the growth queue (concurrency 2: the production box
 * has no room for a separate worker process). Each job is idempotent: the
 * enrollment is claimed before a step runs and every send carries an
 * idempotency key.
 */
@Processor(GROWTH_QUEUE, { concurrency: 2 })
export class GrowthProcessor extends WorkerHost {
  constructor(
    private readonly journeys: JourneyEngineService,
    private readonly campaigns: CampaignsService,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    const now = new Date();
    if (job.name === JOURNEY_ENROLLMENT_JOB) {
      await this.journeys.processEnrollment((job.data as JourneyEnrollmentJobData).enrollmentId, now);
    } else if (job.name === CAMPAIGN_BATCH_JOB) {
      await this.campaigns.processCampaign((job.data as CampaignBatchJobData).campaignId, now);
    }
  }
}
