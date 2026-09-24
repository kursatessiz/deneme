import { Controller, Get, Put } from '@nestjs/common';
import { UpdateFeedbackSettingsSchema } from '@platform/shared';
import type { UpdateFeedbackSettingsInput } from '@platform/shared';
import { RequirePermission, StudioScoped } from '../auth/decorators/require-permission.decorator';
import { CurrentUser, Tenant } from '../auth/decorators/current-user.decorator';
import { ZodBody } from '../../common/zod-body.pipe';
import type { AuthUser, TenantContext } from '../auth/tenant-context';
import { FeedbackSettingsService } from './feedback-settings.service';

/** Studio-level googleReviewUrl and referral reward settings. */
@Controller('studios/:studioId/feedback-settings')
@StudioScoped()
export class FeedbackSettingsController {
  constructor(private readonly settings: FeedbackSettingsService) {}

  @Get()
  @RequirePermission('studio.settings.view')
  async get(@Tenant() tenant: TenantContext) {
    return this.settings.get(tenant.studioId);
  }

  @Put()
  @RequirePermission('studio.settings.manage')
  async update(@Tenant() tenant: TenantContext, @CurrentUser() user: AuthUser, @ZodBody(UpdateFeedbackSettingsSchema) body: UpdateFeedbackSettingsInput) {
    return this.settings.update(tenant.studioId, user.id, body);
  }
}
