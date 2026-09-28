import { Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { CreateAdConnectionSchema, UpdateAdConnectionSchema, type CreateAdConnectionInput, type UpdateAdConnectionInput } from '@platform/shared';
import { RequirePermission, StudioScoped } from '../../auth/decorators/require-permission.decorator';
import { CurrentUser, Tenant } from '../../auth/decorators/current-user.decorator';
import type { AuthUser, TenantContext } from '../../auth/tenant-context';
import { ZodBody } from '../../../common/zod-body.pipe';
import { AdConnectionsService } from './ad-connections.service';
import { AdConnectionTestService } from './ad-connection-test.service';
import { AdsRateLimitGuard } from '../ads-rate-limit.guard';

/** Ad platform connection CRUD and the "test connection" action (docs/REKLAM_ENTEGRASYONU.md). Credentials are always write-only. */
@Controller('studios/:studioId/ads/connections')
@StudioScoped()
export class AdConnectionsController {
  constructor(
    private readonly connections: AdConnectionsService,
    private readonly test: AdConnectionTestService,
  ) {}

  @Get()
  @RequirePermission('ads.manage')
  list(@Tenant() tenant: TenantContext) {
    return this.connections.list(tenant);
  }

  @Post()
  @RequirePermission('ads.manage')
  create(@Tenant() tenant: TenantContext, @CurrentUser() user: AuthUser, @ZodBody(CreateAdConnectionSchema) body: CreateAdConnectionInput) {
    return this.connections.create(tenant, user.id, body);
  }

  @Patch(':connectionId')
  @RequirePermission('ads.manage')
  update(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @Param('connectionId', ParseUUIDPipe) connectionId: string,
    @ZodBody(UpdateAdConnectionSchema) body: UpdateAdConnectionInput,
  ) {
    return this.connections.update(tenant, user.id, connectionId, body);
  }

  @Delete(':connectionId')
  @RequirePermission('ads.manage')
  remove(@Tenant() tenant: TenantContext, @CurrentUser() user: AuthUser, @Param('connectionId', ParseUUIDPipe) connectionId: string) {
    return this.connections.remove(tenant, user.id, connectionId);
  }

  @Post(':connectionId/test')
  @RequirePermission('ads.manage')
  @UseGuards(AdsRateLimitGuard)
  testConnection(@Tenant() tenant: TenantContext, @Param('connectionId', ParseUUIDPipe) connectionId: string) {
    return this.test.test(tenant, connectionId);
  }
}
