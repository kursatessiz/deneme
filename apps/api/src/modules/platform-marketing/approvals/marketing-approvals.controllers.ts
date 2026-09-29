import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import {
  ApprovalListQuerySchema,
  ApproveRequestSchema,
  CancelRequestSchema,
  RejectRequestSchema,
  RequestCampaignApprovalSchema,
  UpdateMarketingSettingsSchema,
  type ApprovalListQuery,
  type ApproveRequestInput,
  type CancelRequestInput,
  type RejectRequestInput,
  type RequestCampaignApprovalInput,
  type UpdateMarketingSettingsInput,
} from '@platform/shared';
import { Platform, PlatformScoped, RequirePlatformPermission } from '../../auth/decorators/platform-scoped.decorator';
import { SuperAdminOnly } from '../../auth/decorators/super-admin-only.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { SuperAdminGuard } from '../../auth/guards/super-admin.guard';
import type { AuthUser, PlatformContext } from '../../auth/tenant-context';
import { ZodBody, ZodQuery } from '../../../common/zod-body.pipe';
import { CampaignApprovalService, type ApprovalActor } from '../../growth/campaigns/approval/campaign-approval.service';
import { MarketingSettingsService } from '../../growth/campaigns/approval/marketing-settings.service';
import { CampaignsService } from '../../growth/campaigns/campaigns.service';

const actorOf = (platform: PlatformContext): ApprovalActor => ({ userId: platform.userId, isSuperAdmin: platform.isSuperAdmin });

/**
 * Approval queue (M3b, docs/PAZARLAMA_MODULU.md 6.1). Reading needs
 * platform.marketing.view; approve and reject are for super admins only
 * (SuperAdminGuard after the platform guard) with the four-eyes rule in the
 * service; cancel is for the requester or a super admin.
 */
@Controller('platform/marketing/approvals')
@PlatformScoped()
export class MarketingApprovalsController {
  constructor(private readonly approvals: CampaignApprovalService) {}

  @Get()
  @RequirePlatformPermission('platform.marketing.view')
  list(@Platform() platform: PlatformContext, @ZodQuery(ApprovalListQuerySchema) query: ApprovalListQuery) {
    return this.approvals.list(platform.platformStudioId, actorOf(platform), query);
  }

  @Get(':id')
  @RequirePlatformPermission('platform.marketing.view')
  detail(@Platform() platform: PlatformContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.approvals.detail(platform.platformStudioId, actorOf(platform), id);
  }

  @Post(':id/approve')
  @HttpCode(200)
  @RequirePlatformPermission('platform.marketing.approve')
  @UseGuards(SuperAdminGuard)
  approve(@Platform() platform: PlatformContext, @Param('id', ParseUUIDPipe) id: string, @ZodBody(ApproveRequestSchema) body: ApproveRequestInput) {
    return this.approvals.approve(platform.platformStudioId, actorOf(platform), id, body.note);
  }

  @Post(':id/reject')
  @HttpCode(200)
  @RequirePlatformPermission('platform.marketing.approve')
  @UseGuards(SuperAdminGuard)
  reject(@Platform() platform: PlatformContext, @Param('id', ParseUUIDPipe) id: string, @ZodBody(RejectRequestSchema) body: RejectRequestInput) {
    return this.approvals.reject(platform.platformStudioId, actorOf(platform), id, body.note);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePlatformPermission('platform.marketing.send')
  cancel(@Platform() platform: PlatformContext, @Param('id', ParseUUIDPipe) id: string, @ZodBody(CancelRequestSchema) body: CancelRequestInput) {
    return this.approvals.cancel(platform.platformStudioId, actorOf(platform), id, body.note);
  }
}

/** Sending actions on platform campaigns (M3b): request approval, pause, resume; all need platform.marketing.send. */
@Controller('platform/marketing/campaigns')
@PlatformScoped()
@RequirePlatformPermission('platform.marketing.send')
export class PlatformCampaignsController {
  constructor(
    private readonly approvals: CampaignApprovalService,
    private readonly campaigns: CampaignsService,
  ) {}

  @Post(':id/request-approval')
  @HttpCode(200)
  requestApproval(
    @Platform() platform: PlatformContext,
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(RequestCampaignApprovalSchema) body: RequestCampaignApprovalInput,
  ) {
    return this.approvals.requestForCampaign(platform.platformStudioId, actorOf(platform), id, body.scheduledAt);
  }

  @Post(':id/pause')
  @HttpCode(200)
  pause(@Platform() platform: PlatformContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.campaigns.pause(platform.platformStudioId, id, platform.userId);
  }

  @Post(':id/resume')
  @HttpCode(200)
  resume(@Platform() platform: PlatformContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.campaigns.resume(platform.platformStudioId, id, platform.userId);
  }
}

/** Super admin: marketing settings of the platform tenant (thresholds, caps, TTL, weekly summary). Every change is audit logged. */
@Controller('admin/marketing/settings')
@SuperAdminOnly()
export class AdminMarketingSettingsController {
  constructor(private readonly settings: MarketingSettingsService) {}

  @Get()
  async get() {
    return this.settings.view(await this.settings.platformStudioId());
  }

  @Patch()
  async update(@CurrentUser() user: AuthUser, @ZodBody(UpdateMarketingSettingsSchema) body: UpdateMarketingSettingsInput) {
    return this.settings.update(await this.settings.platformStudioId(), user.id, body);
  }
}
