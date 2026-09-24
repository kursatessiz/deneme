import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { SCHEDULER_QUEUE, SCHEDULER_JOB_NAME } from './jobs.constants';
import { JobsService } from './jobs.service';

/**
 * One in-process worker, concurrency 1 - the 6 GB / 4 vCPU production box
 * (CLAUDE.md) has no headroom for a separate worker process, and this job
 * is cheap (bounded batches per rule, see AUTOMATION_BATCH_LIMIT).
 */
@Processor(SCHEDULER_QUEUE, { concurrency: 1 })
export class SchedulerProcessor extends WorkerHost {
  private readonly logger = new Logger(SchedulerProcessor.name);

  constructor(private readonly jobs: JobsService) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name !== SCHEDULER_JOB_NAME) return;
    this.logger.debug(`Running scheduled job ${job.id}`);
    await this.jobs.runAll(new Date());
  }
}
