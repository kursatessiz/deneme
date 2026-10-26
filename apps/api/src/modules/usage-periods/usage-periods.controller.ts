import { Controller, Get, Put } from '@nestjs/common';
import { StudioScoped, RequirePermission } from '../auth/decorators/require-permission.decorator';
import { CurrentUser, Tenant } from '../auth/decorators/current-user.decorator';
import { ZodBody } from '../../common/zod-body.pipe';
import type { AuthUser, TenantContext } from '../auth/tenant-context';
import { UpdateUsagePeriodsSettingSchema } from '@platform/shared';
import type { UpdateUsagePeriodsSettingInput, UsagePeriodsSettingDTO } from '@platform/shared';
import { UsagePeriodsService } from './usage-periods.service';

/** The studio switch of the usage periods feature (docs/KULLANIM_DONEMLERI.md). */
@Controller('studios')
export class UsagePeriodsController {
  constructor(private readonly usagePeriods: UsagePeriodsService) {}

  @Get(':studioId/usage-periods')
  @StudioScoped()
  @RequirePermission('studio.settings.view')
  async get(@Tenant() tenant: TenantContext): Promise<UsagePeriodsSettingDTO> {
    return this.usagePeriods.getSetting(tenant.studioId);
  }

  /** Owner only: a non-owner gets 403 even with studio.settings.manage. */
  @Put(':studioId/usage-periods')
  @StudioScoped()
  @RequirePermission('studio.settings.manage')
  async set(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @ZodBody(UpdateUsagePeriodsSettingSchema) body: UpdateUsagePeriodsSettingInput,
  ): Promise<UsagePeriodsSettingDTO> {
    return this.usagePeriods.setEnabled(tenant, user.id, body.enabled);
  }
}
