import { Controller, Get } from '@nestjs/common';
import { DashboardQuerySchema } from '@platform/shared';
import type { DashboardQuery } from '@platform/shared';
import { Platform, PlatformScoped, RequirePlatformPermission } from '../../auth/decorators/platform-scoped.decorator';
import type { PlatformContext } from '../../auth/tenant-context';
import { ZodQuery } from '../../../common/zod-body.pipe';
import { MarketingDashboardService } from './marketing-dashboard.service';

/**
 * KPI dashboard of the marketing panel (M3a, docs/PAZARLAMA_MODULU.md 3.3):
 * read-only and aggregate. The MRR block is added only for a caller with
 * platform.referrals.view or the super admin.
 */
@Controller('platform/marketing/dashboard')
@PlatformScoped()
export class MarketingDashboardController {
  constructor(private readonly dashboard: MarketingDashboardService) {}

  @Get()
  @RequirePlatformPermission('platform.marketing.view')
  view(@Platform() platform: PlatformContext, @ZodQuery(DashboardQuerySchema) query: DashboardQuery) {
    return this.dashboard.dashboard(platform, query);
  }
}
