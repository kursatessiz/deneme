import { Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ActivateAddOnSchema } from '@platform/shared';
import type { ActivateAddOnInput } from '@platform/shared';
import { RequirePermission, SelfService, StudioScoped } from '../../auth/decorators/require-permission.decorator';
import { CurrentUser, Tenant } from '../../auth/decorators/current-user.decorator';
import type { AuthUser, TenantContext } from '../../auth/tenant-context';
import { ZodBody } from '../../../common/zod-body.pipe';
import { StudioAddOnsService } from './studio-add-ons.service';

/**
 * The tenant's add-on marketplace (G5c-2). Owner only: billing.manage is in
 * OWNER_ONLY_PERMISSIONS and on the restricted-mode allow-list; buying and
 * trying additionally refuse a restricted tenant inside the service (a
 * restricted tenant activates its account first), cancelling always works.
 * `features` is readable by every member of the studio (module-off empty
 * states), it exposes no billing data.
 */
@Controller('studios/:studioId')
@StudioScoped()
export class StudioAddOnsController {
  constructor(private readonly addOns: StudioAddOnsService) {}

  @Get('add-ons')
  @RequirePermission('billing.manage')
  list(@Tenant() tenant: TenantContext) {
    return this.addOns.list(tenant.studioId);
  }

  @Get('features')
  @SelfService()
  features(@Tenant() tenant: TenantContext) {
    return this.addOns.features(tenant.studioId);
  }

  @Post('add-ons/:key/start-trial')
  @HttpCode(200)
  @RequirePermission('billing.manage')
  startTrial(@Tenant() tenant: TenantContext, @CurrentUser() user: AuthUser, @Param('key') key: string) {
    return this.addOns.startTrial(tenant, user.id, key);
  }

  @Post('add-ons/:key/activate')
  @HttpCode(200)
  @RequirePermission('billing.manage')
  activate(@Tenant() tenant: TenantContext, @CurrentUser() user: AuthUser, @Param('key') key: string, @ZodBody(ActivateAddOnSchema) body: ActivateAddOnInput) {
    return this.addOns.activate(tenant, user.id, key, body);
  }

  @Post('add-ons/:key/cancel')
  @HttpCode(200)
  @RequirePermission('billing.manage')
  cancel(@Tenant() tenant: TenantContext, @CurrentUser() user: AuthUser, @Param('key') key: string) {
    return this.addOns.cancel(tenant, user.id, key);
  }
}
