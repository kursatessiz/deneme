import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { randomUUID } from 'crypto';
import { SCHEDULER_QUEUE, SCHEDULER_JOB_NAME } from './jobs.constants';
import { JobsService } from './jobs.service';
import { ErrorCaptureService } from '../error-reporting/error-capture.service';
import { runWithRequestContext } from '../error-reporting/request-context';

/**
 * One in-process worker, concurrency 1 - the 6 GB / 4 vCPU production box
 * (CLAUDE.md) has no headroom for a separate worker process, and this job
 * is cheap (bounded batches per rule, see AUTOMATION_BATCH_LIMIT).
 * Each run gets its own correlation id for logs; a failed run is recorded
 * as a `job` error and then rethrown so BullMQ keeps its retry behaviour.
 */
@Processor(SCHEDULER_QUEUE, { concurrency: 1 })
export class SchedulerProcessor extends WorkerHost {
  private readonly logger = new Logger(SchedulerProcessor.name);

  constructor(
    private readonly jobs: JobsService,
    private readonly errors: ErrorCaptureService,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name !== SCHEDULER_JOB_NAME) return;
    await runWithRequestContext({ requestId: randomUUID() }, async () => {
      this.logger.debug(`Running scheduled job ${job.id}`);
      try {
        await this.jobs.runAll(new Date());
      } catch (err) {
        this.errors.capture({ source: 'job', error: err, route: `job ${SCHEDULER_QUEUE}/${SCHEDULER_JOB_NAME}` });
        throw err;
      }
    });
  }
}
