import { Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ApiKeysService } from './api-keys.service';
import { StudioScoped, RequirePermission } from '../auth/decorators/require-permission.decorator';
import { CurrentUser, Tenant } from '../auth/decorators/current-user.decorator';
import { ZodBody } from '../../common/zod-body.pipe';
import { CreateApiKeySchema, CreateApiKeyInput } from '@platform/shared';
import type { AuthUser, TenantContext } from '../auth/tenant-context';

/** Staff management of the studio's own public-API credentials. See docs/PUBLIC_API.md. */
@ApiTags('Integrations')
@Controller('integrations/api-keys')
@StudioScoped()
export class ApiKeysController {
  constructor(private apiKeys: ApiKeysService) {}

  @Post()
  @RequirePermission('integrations.manage')
  async create(@Tenant() tenant: TenantContext, @CurrentUser() user: AuthUser, @ZodBody(CreateApiKeySchema) body: CreateApiKeyInput) {
    return this.apiKeys.create(tenant, user.id, body);
  }

  @Get()
  @RequirePermission('integrations.manage')
  async list(@Tenant() tenant: TenantContext) {
    return this.apiKeys.list(tenant);
  }

  @Delete(':id')
  @RequirePermission('integrations.manage')
  async revoke(@Param('id') id: string, @Tenant() tenant: TenantContext, @CurrentUser() user: AuthUser) {
    return this.apiKeys.revoke(tenant, user.id, id);
  }
}
