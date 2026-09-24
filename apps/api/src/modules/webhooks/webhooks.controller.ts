import { Controller, Get, Param, Post, Put, Delete } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { WebhooksService } from './webhooks.service';
import { StudioScoped, RequirePermission } from '../auth/decorators/require-permission.decorator';
import { CurrentUser, Tenant } from '../auth/decorators/current-user.decorator';
import { ZodBody, ZodQuery } from '../../common/zod-body.pipe';
import {
  CreateWebhookEndpointSchema,
  CreateWebhookEndpointInput,
  UpdateWebhookEndpointSchema,
  UpdateWebhookEndpointInput,
  SendTestWebhookSchema,
  SendTestWebhookInput,
} from '@platform/shared';
import { z } from 'zod';
import type { AuthUser, TenantContext } from '../auth/tenant-context';

const ListDeliveriesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

/** Staff management of outbound webhooks. See docs/PUBLIC_API.md. */
@ApiTags('Integrations')
@Controller('integrations/webhooks')
@StudioScoped()
export class WebhooksController {
  constructor(private webhooks: WebhooksService) {}

  @Post()
  @RequirePermission('integrations.manage')
  async create(@Tenant() tenant: TenantContext, @CurrentUser() user: AuthUser, @ZodBody(CreateWebhookEndpointSchema) body: CreateWebhookEndpointInput) {
    return this.webhooks.create(tenant, user.id, body);
  }

  @Get()
  @RequirePermission('integrations.manage')
  async list(@Tenant() tenant: TenantContext) {
    return this.webhooks.list(tenant);
  }

  @Put(':id')
  @RequirePermission('integrations.manage')
  async update(
    @Param('id') id: string,
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @ZodBody(UpdateWebhookEndpointSchema) body: UpdateWebhookEndpointInput,
  ) {
    return this.webhooks.update(tenant, user.id, id, body);
  }

  @Delete(':id')
  @RequirePermission('integrations.manage')
  async remove(@Param('id') id: string, @Tenant() tenant: TenantContext, @CurrentUser() user: AuthUser) {
    return this.webhooks.remove(tenant, user.id, id);
  }

  @Post(':id/rotate-secret')
  @RequirePermission('integrations.manage')
  async rotateSecret(@Param('id') id: string, @Tenant() tenant: TenantContext, @CurrentUser() user: AuthUser) {
    return this.webhooks.rotateSecret(tenant, user.id, id);
  }

  @Get(':id/deliveries')
  @RequirePermission('integrations.manage')
  async listDeliveries(@Param('id') id: string, @Tenant() tenant: TenantContext, @ZodQuery(ListDeliveriesQuerySchema) query: { page: number; pageSize: number }) {
    return this.webhooks.listDeliveries(tenant, id, query.page, query.pageSize);
  }

  @Post(':id/deliveries/:deliveryId/redeliver')
  @RequirePermission('integrations.manage')
  async redeliver(
    @Param('id') id: string,
    @Param('deliveryId') deliveryId: string,
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
  ) {
    return this.webhooks.redeliver(tenant, user.id, id, deliveryId);
  }

  @Post(':id/test-event')
  @RequirePermission('integrations.manage')
  async sendTestEvent(
    @Param('id') id: string,
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @ZodBody(SendTestWebhookSchema) body: SendTestWebhookInput,
  ) {
    return this.webhooks.sendTestEvent(tenant, user.id, id, body.event);
  }
}
