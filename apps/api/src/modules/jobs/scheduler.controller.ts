import { BadRequestException, Body, Controller, ForbiddenException, Post, UseGuards } from '@nestjs/common';
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
    // A custom clock is for tests and local runs only: in production it
    // could fire future reminders and campaigns early.
    if (body?.now && process.env.NODE_ENV === 'production') {
      throw new BadRequestException('Üretimde zaman değeri verilemez');
    }
    const now = body?.now ? new Date(body.now) : new Date();
    if (Number.isNaN(now.getTime())) {
      throw new BadRequestException('Geçersiz zaman değeri');
    }
    return this.jobs.runAll(now);
  }
}
