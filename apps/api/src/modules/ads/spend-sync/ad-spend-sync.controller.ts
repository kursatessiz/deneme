import { Controller, Get, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { CAMPAIGN_NAME_PATTERN, parseCampaignName, UpdateAttributionWindowSchema, type UpdateAttributionWindowInput } from '@platform/shared';
import { RequirePermission, StudioScoped } from '../../auth/decorators/require-permission.decorator';
import { Tenant } from '../../auth/decorators/current-user.decorator';
import type { TenantContext } from '../../auth/tenant-context';
import { PrismaService } from '../../prisma/prisma.service';
import { ZodBody } from '../../../common/zod-body.pipe';
import { AdsRateLimitGuard } from '../ads-rate-limit.guard';
import { AdSpendSyncService } from './ad-spend-sync.service';

export interface NamingCheckRow {
  externalId: string;
  name: string;
  platform: string;
}

/** Manual "senkronize et" and the campaign naming convention check (docs/BUYUME_VE_GLOBAL_MIMARI.md 4.3). */
@Controller('studios/:studioId/ads')
@StudioScoped()
export class AdSpendSyncController {
  constructor(
    private readonly spendSync: AdSpendSyncService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('spend/sync')
  @RequirePermission('ads.manage')
  @UseGuards(AdsRateLimitGuard)
  sync(@Tenant() tenant: TenantContext) {
    return this.spendSync.syncStudio(tenant.studioId);
  }

  /** Attribution window tenant setting (default 30 days, see docs/CRM_VE_ATIF.md section 10). */
  @Patch('settings')
  @RequirePermission('ads.manage')
  async updateSettings(@Tenant() tenant: TenantContext, @ZodBody(UpdateAttributionWindowSchema) body: UpdateAttributionWindowInput) {
    const studio = await this.prisma.studio.update({
      where: { id: tenant.studioId },
      data: { attributionWindowDays: body.attributionWindowDays },
      select: { attributionWindowDays: true },
    });
    return studio;
  }

  @Get('naming-check')
  @RequirePermission('ads.manage')
  async namingCheck(@Tenant() tenant: TenantContext, @Query('platform') platform?: string): Promise<NamingCheckRow[]> {
    const campaigns = await this.prisma.adEntity.findMany({
      where: { studioId: tenant.studioId, level: 'CAMPAIGN', ...(platform ? { platform } : {}) },
      select: { externalId: true, name: true, platform: true },
    });
    return campaigns
      .filter((c) => !CAMPAIGN_NAME_PATTERN.test(c.name.trim().toLowerCase()) || !parseCampaignName(c.name))
      .map((c) => ({ externalId: c.externalId, name: c.name, platform: c.platform }));
  }
}
