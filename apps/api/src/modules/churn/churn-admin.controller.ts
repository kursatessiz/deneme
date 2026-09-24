import { Body, Controller, Post } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SuperAdminOnly } from '../auth/decorators/super-admin-only.decorator';
import { ChurnService } from './churn.service';

/**
 * Platform-wide churn-risk recompute trigger, not tied to a single studio.
 * The daily refresh runs from the scheduler heartbeat (JobsService ->
 * ChurnService.recomputeStale); this endpoint forces a full recompute.
 */
@Controller('admin/churn')
@SuperAdminOnly()
export class ChurnAdminController {
  constructor(
    private readonly churn: ChurnService,
    private readonly config: ConfigService,
  ) {}

  @Post('recompute-all')
  async recomputeAll(@Body() body: { now?: string }) {
    const isTest = this.config.get<string>('NODE_ENV') === 'test';
    const now = isTest && body?.now ? new Date(body.now) : new Date();
    return this.churn.recomputeAll(now);
  }
}
