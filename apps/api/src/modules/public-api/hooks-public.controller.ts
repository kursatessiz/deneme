import { Controller, Delete, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SubscribeHookSchema, WebhookEventSchema, webhookSamplePayload } from '@platform/shared';
import type { SubscribeHookInput, WebhookEvent } from '@platform/shared';
import { PublicApiScoped } from '../api-keys/require-scope.decorator';
import { ApiKeyTenant } from '../api-keys/api-key-tenant.decorator';
import type { ApiKeyTenantContext } from '../api-keys/api-key-tenant-context';
import { WebhooksService } from '../webhooks/webhooks.service';
import { PrismaService } from '../prisma/prisma.service';
import { ZodBody, ZodValidationPipe } from '../../common/zod-body.pipe';

/**
 * REST hooks for automation tools such as Zapier (G3c-3, docs/ZAPIER.md).
 * Authenticated by API key like the rest of `/v1/public/*`, with the same
 * per-key rate limit. A subscription is an ordinary WebhookEndpoint bound to
 * a single event, so delivery, signing, retry and SSRF protection are the
 * ones the staff-managed webhooks already use.
 */
@ApiTags('Public API')
@Controller('v1/public')
export class HooksPublicController {
  constructor(
    private readonly webhooks: WebhooksService,
    private readonly prisma: PrismaService,
  ) {}

  /** Connection test: any valid key works, whatever its scopes. */
  @Get('me')
  @PublicApiScoped()
  async me(@ApiKeyTenant() tenant: ApiKeyTenantContext) {
    const studio = await this.prisma.studio.findUniqueOrThrow({
      where: { id: tenant.studioId },
      select: { id: true, name: true, slug: true },
    });
    return { studioId: studio.id, name: studio.name, slug: studio.slug, scopes: [...tenant.scopes] };
  }

  @Post('hooks')
  @PublicApiScoped('webhooks.manage')
  async subscribe(@ApiKeyTenant() tenant: ApiKeyTenantContext, @ZodBody(SubscribeHookSchema) body: SubscribeHookInput) {
    return this.webhooks.subscribeRestHook(tenant.studioId, tenant.apiKeyId, body);
  }

  @Delete('hooks/:id')
  @PublicApiScoped('webhooks.manage')
  async unsubscribe(@ApiKeyTenant() tenant: ApiKeyTenantContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.webhooks.unsubscribeRestHook(tenant.studioId, tenant.apiKeyId, id);
  }

  /** A realistic delivery for the event, so the automation tool can show its fields. */
  @Get('hooks/samples/:event')
  @PublicApiScoped()
  async sample(@ApiKeyTenant() tenant: ApiKeyTenantContext, @Param('event', new ZodValidationPipe(WebhookEventSchema)) event: WebhookEvent) {
    return webhookSamplePayload(event, tenant.studioId);
  }
}
