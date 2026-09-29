import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';

export const AI_QUEUE = 'ai';
export const AI_TRANSLATION_JOB = 'translation';

export interface AiTranslationJobData {
  jobId: string;
}

/**
 * BullMQ queue for AI translation jobs. With Redis (production) a job runs
 * as soon as it is created and re-queues itself until it is finished; without
 * Redis (local development, the e2e suite) nothing is queued and the
 * 15-minute scheduler heartbeat (JobsService) advances the same idempotent
 * TranslationEngineService.processPending. The heartbeat also runs in
 * production as the safety net for a lost queue job.
 */
@Injectable()
export class AiQueueService {
  private readonly logger = new Logger(AiQueueService.name);

  constructor(@Optional() @InjectQueue(AI_QUEUE) private readonly queue?: Queue) {}

  get enabled(): boolean {
    return Boolean(this.queue);
  }

  async enqueueTranslation(jobId: string, delayMs = 0): Promise<void> {
    if (!this.queue) return;
    try {
      await this.queue.add(AI_TRANSLATION_JOB, { jobId } satisfies AiTranslationJobData, {
        jobId: `${jobId}:${Date.now()}`,
        delay: delayMs,
        removeOnComplete: 200,
        removeOnFail: 200,
        attempts: 1,
      });
    } catch (err) {
      // The heartbeat picks the job up anyway; a queue outage must not fail the request.
      this.logger.warn(`Could not queue AI translation job ${jobId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
