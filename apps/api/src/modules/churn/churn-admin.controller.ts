import { Body, Controller, ForbiddenException, Post, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/tenant-context';
import { ChurnService } from './churn.service';

/**
 * Platform-wide churn-risk recompute trigger, not tied to a single studio.
 * No jobs/scheduler module exists in this API yet (see HANDOVER.md W12), so
 * this is the documented substitute: a super-admin (or an external cron
 * hitting this endpoint with a service token) drives
 * `ChurnService.recomputeAll` once a day. When a scheduler module is added,
 * move this call there instead.
 */
@Controller('admin/churn')
export class ChurnAdminController {
  constructor(
    private readonly churn: ChurnService,
    private readonly config: ConfigService,
  ) {}

  @Post('recompute-all')
  @UseGuards(JwtAuthGuard)
  async recomputeAll(@CurrentUser() user: AuthUser, @Body() body: { now?: string }) {
    if (!user.isSuperAdmin) {
      throw new ForbiddenException('Bu işlem için yetkiniz yok');
    }
    const isTest = this.config.get<string>('NODE_ENV') === 'test';
    const now = isTest && body?.now ? new Date(body.now) : new Date();
    return this.churn.recomputeAll(now);
  }
}
