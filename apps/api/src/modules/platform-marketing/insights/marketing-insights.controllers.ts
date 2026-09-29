import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { GenerateInsightSchema, InsightListQuerySchema, insightWeekFor } from '@platform/shared';
import type { GenerateInsightInput, GenerateInsightResultDTO, InsightListDTO, InsightListQuery } from '@platform/shared';
import { Platform, PlatformScoped, RequirePlatformPermission } from '../../auth/decorators/platform-scoped.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { SuperAdminOnly } from '../../auth/decorators/super-admin-only.decorator';
import type { AuthUser, PlatformContext } from '../../auth/tenant-context';
import { ZodBody, ZodQuery } from '../../../common/zod-body.pipe';
import { MarketingSettingsService } from '../../growth/campaigns/approval/marketing-settings.service';
import { MarketingInsightsService } from './marketing-insights.service';

/** Weekly marketing summaries (M3d, docs/PAZARLAMA_MODULU.md 3.3): read-only, aggregate figures only. */
@Controller('platform/marketing/insights')
@PlatformScoped()
export class MarketingInsightsController {
  constructor(private readonly insights: MarketingInsightsService) {}

  @Get()
  @RequirePlatformPermission('platform.marketing.view')
  async list(@Platform() platform: PlatformContext, @ZodQuery(InsightListQuerySchema) query: InsightListQuery): Promise<InsightListDTO> {
    return { items: await this.insights.list(platform.platformStudioId, query.limit) };
  }
}

/** Super admin: generate the insight of the last complete week now (testing); an existing week is kept unless `force`. */
@Controller('admin/marketing/insights')
@SuperAdminOnly()
export class AdminMarketingInsightsController {
  constructor(
    private readonly insights: MarketingInsightsService,
    private readonly settings: MarketingSettingsService,
  ) {}

  @Post('generate')
  @HttpCode(200)
  async generate(@CurrentUser() user: AuthUser, @ZodBody(GenerateInsightSchema) body: GenerateInsightInput): Promise<GenerateInsightResultDTO> {
    const now = body.at ? new Date(body.at) : new Date();
    return this.insights.generate(await this.settings.platformStudioId(), insightWeekFor(now), {
      now,
      force: body.force,
      notify: body.notify,
      actorUserId: user.id,
    });
  }
}
