import { Body, Controller, ForbiddenException, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/tenant-context';
import { JobsService } from './jobs.service';

/**
 * Super-admin trigger for the scheduler heartbeat (automations, dunning,
 * İYS consent sync). Always available, regardless of whether the BullMQ
 * repeatable job is registered: this is what tests and local dev without
 * Redis use, and what an external cron may call in place of BullMQ.
 */
@Controller('admin/scheduler')
export class SchedulerController {
  constructor(private readonly jobs: JobsService) {}

  @Post('run')
  @UseGuards(JwtAuthGuard)
  async run(@CurrentUser() user: AuthUser, @Body() body: { now?: string }) {
    if (!user.isSuperAdmin) {
      throw new ForbiddenException('Bu işlem için yetkiniz yok');
    }
    const now = body?.now ? new Date(body.now) : new Date();
    return this.jobs.runAll(now);
  }
}
