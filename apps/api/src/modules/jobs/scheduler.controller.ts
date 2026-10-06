import { BadRequestException, Body, Controller, Post } from '@nestjs/common';
import { SuperAdminOnly } from '../auth/decorators/super-admin-only.decorator';
import { JobsService } from './jobs.service';
import { apiError } from '../../common/api-error';

/**
 * Super-admin trigger for the scheduler heartbeat (automations, dunning,
 * İYS consent sync). Always available, regardless of whether the BullMQ
 * repeatable job is registered: this is what tests and local dev without
 * Redis use, and what an external cron may call in place of BullMQ.
 */
@Controller('admin/scheduler')
@SuperAdminOnly()
export class SchedulerController {
  constructor(private readonly jobs: JobsService) {}

  @Post('run')
  async run(@Body() body: { now?: string }) {
    // A custom clock is for tests and local runs only: in production it
    // could fire future reminders and campaigns early.
    if (body?.now && process.env.NODE_ENV === 'production') {
      throw new BadRequestException(apiError('apiErrors.jobs.timeValueCannotSuppliedProduction'));
    }
    const now = body?.now ? new Date(body.now) : new Date();
    if (Number.isNaN(now.getTime())) {
      throw new BadRequestException(apiError('apiErrors.jobs.invalidTimeValue'));
    }
    return this.jobs.runAll(now);
  }
}
