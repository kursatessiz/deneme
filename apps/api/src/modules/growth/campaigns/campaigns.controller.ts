import { Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { CampaignRecipientsQuerySchema, CreateCampaignSchema, ScheduleCampaignSchema, UpdateCampaignSchema } from '@platform/shared';
import type { CampaignRecipientsQuery, CreateCampaignInput, ScheduleCampaignInput, UpdateCampaignInput } from '@platform/shared';
import { RequirePermission, StudioScoped } from '../../auth/decorators/require-permission.decorator';
import { Tenant } from '../../auth/decorators/current-user.decorator';
import type { TenantContext } from '../../auth/tenant-context';
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
  create(@Tenant() tenant: TenantContext, @ZodBody(CreateCampaignSchema) body: CreateCampaignInput) {
    return this.campaigns.create(tenant, body);
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
    @Param('campaignId', ParseUUIDPipe) campaignId: string,
    @ZodBody(UpdateCampaignSchema) body: UpdateCampaignInput,
  ) {
    return this.campaigns.update(tenant.studioId, campaignId, body);
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
  cancel(@Tenant() tenant: TenantContext, @Param('campaignId', ParseUUIDPipe) campaignId: string) {
    return this.campaigns.cancel(tenant.studioId, campaignId);
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
