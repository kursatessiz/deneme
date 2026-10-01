import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { IndexNowSubmitter } from './indexnow-submitter.service';

export const INDEXNOW_QUEUE = 'indexnow';
export const INDEXNOW_SUBMIT_JOB = 'submit';

export interface IndexNowJobData {
  studioId: string;
  /** Absolute URLs of the site's canonical origin that changed. */
  urls: string[];
}

/**
 * BullMQ queue of IndexNow notifications (docs/SEO.md "IndexNow"). With Redis (production) every change is a
 * job that retries with backoff; without Redis (local development, the e2e suite) it is submitted in the
 * background of the same process, where the submitter skips the network call in the test environment. The
 * e2e suite replaces this service to observe what would be queued.
 */
@Injectable()
export class IndexNowQueueService {
  private readonly logger = new Logger(IndexNowQueueService.name);

  constructor(
    private readonly submitter: IndexNowSubmitter,
    @Optional() @InjectQueue(INDEXNOW_QUEUE) private readonly queue?: Queue,
  ) {}

  get enabled(): boolean {
    return Boolean(this.queue);
  }

  async enqueue(job: IndexNowJobData): Promise<void> {
    if (!this.queue) {
      void this.submitter.submit(job).catch((err: unknown) => this.logger.warn(`IndexNow submission failed: ${err instanceof Error ? err.message : String(err)}`));
      return;
    }
    try {
      await this.queue.add(INDEXNOW_SUBMIT_JOB, job satisfies IndexNowJobData, { removeOnComplete: 200, removeOnFail: 200, attempts: 3, backoff: { type: 'exponential', delay: 60_000 } });
    } catch (err) {
      this.logger.warn(`Could not queue IndexNow job: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
