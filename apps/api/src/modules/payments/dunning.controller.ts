import { Body, Controller, Post } from '@nestjs/common';
import { DunningService } from './dunning.service';
import { SuperAdminOnly } from '../auth/decorators/super-admin-only.decorator';

/**
 * Platform-wide dunning trigger, not tied to a single studio. BullMQ is not
 * yet wired up in this API (see HANDOVER.md W6), so this endpoint is the
 * documented substitute: a super-admin (or an external cron hitting this
 * endpoint with a service token) drives `DunningService.runDueRenewals`.
 */
@Controller('admin/dunning')
@SuperAdminOnly()
export class DunningController {
  constructor(private dunning: DunningService) {}

  @Post('run')
  async run(@Body() body: { now?: string }) {
    const now = body?.now ? new Date(body.now) : new Date();
    return this.dunning.runDueRenewals(now);
  }
}
