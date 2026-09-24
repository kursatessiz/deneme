import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import {
  CreatePartnerConnectionSchema,
  UpdatePartnerConnectionSchema,
  type CreatePartnerConnectionInput,
  type UpdatePartnerConnectionInput,
} from '@platform/shared';
import { StudioScoped, RequirePermission } from '../auth/decorators/require-permission.decorator';
import { CurrentUser, Tenant } from '../auth/decorators/current-user.decorator';
import { ZodBody } from '../../common/zod-body.pipe';
import type { AuthUser, TenantContext } from '../auth/tenant-context';
import { PartnerConnectionsService } from './partner-connections.service';

/** Connection CRUD for the owner's "Partner platformlar" screen. Credentials are always write-only. */
@Controller('partners/connections')
@StudioScoped()
export class PartnersController {
  constructor(private readonly connections: PartnerConnectionsService) {}

  @Get()
  @RequirePermission('integrations.partners.manage')
  async list(@Tenant() tenant: TenantContext) {
    return this.connections.list(tenant);
  }

  @Post()
  @RequirePermission('integrations.partners.manage')
  async create(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @ZodBody(CreatePartnerConnectionSchema) body: CreatePartnerConnectionInput,
  ) {
    return this.connections.create(tenant, user.id, body);
  }

  @Patch(':connectionId')
  @RequirePermission('integrations.partners.manage')
  async update(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @Param('connectionId') connectionId: string,
    @ZodBody(UpdatePartnerConnectionSchema) body: UpdatePartnerConnectionInput,
  ) {
    return this.connections.update(tenant, user.id, connectionId, body);
  }

  @Delete(':connectionId')
  @RequirePermission('integrations.partners.manage')
  async remove(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @Param('connectionId') connectionId: string,
  ) {
    return this.connections.remove(tenant, user.id, connectionId);
  }
}
