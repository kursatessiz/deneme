import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { AI_QUEUE, AI_TRANSLATION_JOB, AiQueueService, type AiTranslationJobData } from './ai-queue.service';
import { TranslationEngineService } from './translation-engine.service';

/** How long one queue job works before it re-queues itself, so a long language never blocks the worker. */
const RUN_SLICE_MS = 10 * 60_000;

/**
 * In-process worker for the AI queue (concurrency 1: translation batches are
 * sequential per job and the production box has little headroom). A paused
 * job (deadline or provider outage) is queued again, with a backoff after an
 * outage; the scheduler heartbeat is the safety net if that fails.
 */
@Processor(AI_QUEUE, { concurrency: 1 })
export class AiProcessor extends WorkerHost {
  constructor(
    private readonly engine: TranslationEngineService,
    private readonly queue: AiQueueService,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name !== AI_TRANSLATION_JOB) return;
    const { jobId } = job.data as AiTranslationJobData;
    const outcome = await this.engine.processJob(jobId, new Date(Date.now() + RUN_SLICE_MS));
    if (outcome.state === 'PAUSED') await this.queue.enqueueTranslation(jobId, outcome.retryAfterMs);
  }
}
