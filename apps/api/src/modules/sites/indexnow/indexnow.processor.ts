import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { INDEXNOW_QUEUE } from './indexnow-queue.service';
import type { IndexNowJobData } from './indexnow-queue.service';
import { IndexNowSubmitter } from './indexnow-submitter.service';

/** In-process worker of the IndexNow queue (one at a time: submissions are tiny and rate-limited by the engines). */
@Processor(INDEXNOW_QUEUE, { concurrency: 1 })
export class IndexNowProcessor extends WorkerHost {
  constructor(private readonly submitter: IndexNowSubmitter) {
    super();
  }

  async process(job: Job<IndexNowJobData>): Promise<void> {
    await this.submitter.submit(job.data);
  }
}
