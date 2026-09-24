import { Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CreateKioskDeviceSchema, CreateKioskDeviceInput } from '@platform/shared';
import { StudioScoped, RequirePermission } from '../auth/decorators/require-permission.decorator';
import { CurrentUser, Tenant } from '../auth/decorators/current-user.decorator';
import { ZodBody } from '../../common/zod-body.pipe';
import type { AuthUser, TenantContext } from '../auth/tenant-context';
import { KioskService } from './kiosk.service';

/** Staff-facing kiosk device management: pairing, listing, revoking. */
@Controller('studios/:studioId/kiosk-devices')
@StudioScoped()
export class KioskAdminController {
  constructor(private readonly kiosk: KioskService) {}

  @Post()
  @RequirePermission('studio.settings.manage')
  async create(
    @Tenant() tenant: TenantContext,
    @CurrentUser() actor: AuthUser,
    @ZodBody(CreateKioskDeviceSchema) body: CreateKioskDeviceInput,
  ) {
    return this.kiosk.createDevice(tenant, actor, body);
  }

  @Get()
  @RequirePermission('studio.settings.manage')
  async list(@Tenant() tenant: TenantContext) {
    return this.kiosk.listDevices(tenant);
  }

  @Post(':deviceId/revoke')
  @RequirePermission('studio.settings.manage')
  async revoke(
    @Tenant() tenant: TenantContext,
    @CurrentUser() actor: AuthUser,
    @Param('deviceId', ParseUUIDPipe) deviceId: string,
  ) {
    return this.kiosk.revokeDevice(tenant, actor, deviceId);
  }
}
