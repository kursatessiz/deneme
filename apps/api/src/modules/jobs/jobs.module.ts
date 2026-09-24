import { Logger, Module, OnModuleInit, Optional } from '@nestjs/common';
import { BullModule, InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { AutomationsModule } from '../automations/automations.module';
import { PaymentsModule } from '../payments/payments.module';
import { JobsService } from './jobs.service';
import { SchedulerController } from './scheduler.controller';
import { SchedulerProcessor } from './scheduler.processor';
import { SCHEDULER_INTERVAL_MS, SCHEDULER_JOB_NAME, SCHEDULER_QUEUE } from './jobs.constants';

/**
 * BullMQ is wired up only when REDIS_URL is a real process environment
 * variable at module-load time (production sets it as a container env var,
 * see deploy/docker-compose.prod.yml; CLAUDE.md rule/env.ts already require
 * it in production). Without it - local dev or tests without Redis - no
 * queue or worker is created; the exact same work is still reachable via
 * JobsService.runAll() and the POST /admin/scheduler/run endpoint. Importing
 * SchedulerProcessor is safe either way: the class is only instantiated as a
 * provider (and only then does it touch Redis) when redisConfigured is true.
 */
const redisConfigured = Boolean(process.env.REDIS_URL);

@Module({
  imports: [
    AutomationsModule,
    PaymentsModule,
    ...(redisConfigured
      ? [
          BullModule.forRoot({ connection: { url: process.env.REDIS_URL } }),
          BullModule.registerQueue({ name: SCHEDULER_QUEUE }),
        ]
      : []),
  ],
  controllers: [SchedulerController],
  providers: [JobsService, ...(redisConfigured ? [SchedulerProcessor] : [])],
  exports: [JobsService],
})
export class JobsModule implements OnModuleInit {
  private readonly logger = new Logger(JobsModule.name);

  constructor(@Optional() @InjectQueue(SCHEDULER_QUEUE) private readonly queue?: Queue) {}

  async onModuleInit(): Promise<void> {
    if (!this.queue) {
      this.logger.warn('REDIS_URL not configured: scheduler runs only via POST /admin/scheduler/run.');
      return;
    }
    // Idempotent: same jobId + repeat config replaces any existing schedule
    // rather than duplicating it across restarts/deploys.
    await this.queue.add(
      SCHEDULER_JOB_NAME,
      {},
      { repeat: { every: SCHEDULER_INTERVAL_MS }, jobId: SCHEDULER_JOB_NAME },
    );
    this.logger.log(`Scheduler queue registered: ${SCHEDULER_JOB_NAME} every ${SCHEDULER_INTERVAL_MS / 60000} minutes.`);
  }
}
