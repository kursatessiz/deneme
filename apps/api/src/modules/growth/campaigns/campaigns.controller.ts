import { Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { CampaignRecipientsQuerySchema, CreateCampaignSchema, PickCampaignWinnerSchema, ScheduleCampaignSchema, UpdateCampaignSchema } from '@platform/shared';
import type { CampaignRecipientsQuery, CreateCampaignInput, PickCampaignWinnerInput, ScheduleCampaignInput, UpdateCampaignInput } from '@platform/shared';
import { RequirePermission, StudioScoped } from '../../auth/decorators/require-permission.decorator';
import { CurrentUser, Tenant } from '../../auth/decorators/current-user.decorator';
import type { AuthUser, TenantContext } from '../../auth/tenant-context';
import { ZodBody, ZodQuery } from '../../../common/zod-body.pipe';
import { CampaignsService } from './campaigns.service';

/** Campaigns (G2a). Studio from the tenant guard only. */
@Controller('studios/:studioId/campaigns')
@StudioScoped()
export class CampaignsController {
  constructor(private readonly campaigns: CampaignsService) {}

  @Get()
  @RequirePermission('campaigns.view')
  async list(@Tenant() tenant: TenantContext) {
    return { items: await this.campaigns.list(tenant.studioId) };
  }

  @Post()
  @RequirePermission('campaigns.manage')
  create(@Tenant() tenant: TenantContext, @CurrentUser() user: AuthUser, @ZodBody(CreateCampaignSchema) body: CreateCampaignInput) {
    return this.campaigns.create(tenant, body, user.id);
  }

  @Get(':campaignId')
  @RequirePermission('campaigns.view')
  detail(@Tenant() tenant: TenantContext, @Param('campaignId', ParseUUIDPipe) campaignId: string) {
    return this.campaigns.detail(tenant.studioId, campaignId);
  }

  @Patch(':campaignId')
  @RequirePermission('campaigns.manage')
  update(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @Param('campaignId', ParseUUIDPipe) campaignId: string,
    @ZodBody(UpdateCampaignSchema) body: UpdateCampaignInput,
  ) {
    return this.campaigns.update(tenant.studioId, campaignId, body, user.id);
  }

  @Delete(':campaignId')
  @RequirePermission('campaigns.manage')
  remove(@Tenant() tenant: TenantContext, @Param('campaignId', ParseUUIDPipe) campaignId: string) {
    return this.campaigns.remove(tenant.studioId, campaignId);
  }

  @Post(':campaignId/schedule')
  @RequirePermission('campaigns.manage')
  schedule(
    @Tenant() tenant: TenantContext,
    @Param('campaignId', ParseUUIDPipe) campaignId: string,
    @ZodBody(ScheduleCampaignSchema) body: ScheduleCampaignInput,
  ) {
    return this.campaigns.schedule(tenant.studioId, campaignId, body);
  }

  @Post(':campaignId/cancel')
  @RequirePermission('campaigns.manage')
  cancel(@Tenant() tenant: TenantContext, @CurrentUser() user: AuthUser, @Param('campaignId', ParseUUIDPipe) campaignId: string) {
    return this.campaigns.cancel(tenant.studioId, campaignId, new Date(), user.id);
  }

  /** The campaign owner picks the A/B winner now instead of waiting (M3c). */
  @Post(':campaignId/pick-winner')
  @RequirePermission('campaigns.manage')
  pickWinner(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @Param('campaignId', ParseUUIDPipe) campaignId: string,
    @ZodBody(PickCampaignWinnerSchema) body: PickCampaignWinnerInput,
  ) {
    return this.campaigns.pickWinner(tenant.studioId, campaignId, body, user.id);
  }

  @Post(':campaignId/test-send')
  @RequirePermission('campaigns.manage')
  testSend(@Tenant() tenant: TenantContext, @Param('campaignId', ParseUUIDPipe) campaignId: string) {
    return this.campaigns.testSend(tenant, campaignId);
  }

  @Get(':campaignId/recipients')
  @RequirePermission('campaigns.view')
  recipients(
    @Tenant() tenant: TenantContext,
    @Param('campaignId', ParseUUIDPipe) campaignId: string,
    @ZodQuery(CampaignRecipientsQuerySchema) query: CampaignRecipientsQuery,
  ) {
    return this.campaigns.recipients(tenant.studioId, campaignId, query);
  }
}
