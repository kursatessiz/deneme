import { Body, Controller, ForbiddenException, Post, UseGuards } from '@nestjs/common';
import { DunningService } from './dunning.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/tenant-context';

/**
 * Platform-wide dunning trigger, not tied to a single studio. BullMQ is not
 * yet wired up in this API (see HANDOVER.md W6), so this endpoint is the
 * documented substitute: a super-admin (or an external cron hitting this
 * endpoint with a service token) drives `DunningService.runDueRenewals`.
 */
@Controller('admin/dunning')
export class DunningController {
  constructor(private dunning: DunningService) {}

  @Post('run')
  @UseGuards(JwtAuthGuard)
  async run(@CurrentUser() user: AuthUser, @Body() body: { now?: string }) {
    if (!user.isSuperAdmin) {
      throw new ForbiddenException('Bu işlem için yetkiniz yok');
    }
    const now = body?.now ? new Date(body.now) : new Date();
    return this.dunning.runDueRenewals(now);
  }
}
