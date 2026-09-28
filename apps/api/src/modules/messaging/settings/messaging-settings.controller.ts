import { ConflictException, Controller, Delete, Get, Param, ParseUUIDPipe, Put } from '@nestjs/common';
import { MessagingRoutingSchema, TemplateListQuerySchema, TenantMessagingSettingsSchema, TenantTemplateUpsertSchema } from '@platform/shared';
import type { MessagingRoutingInput, TemplateListQuery, TenantMessagingSettingsInput, TenantTemplateUpsertInput } from '@platform/shared';
import { Tenant } from '../../auth/decorators/current-user.decorator';
import { RequirePermission, StudioScoped } from '../../auth/decorators/require-permission.decorator';
import { SuperAdminOnly } from '../../auth/decorators/super-admin-only.decorator';
import type { TenantContext } from '../../auth/tenant-context';
import { ZodBody, ZodQuery } from '../../../common/zod-body.pipe';
import { PrismaService } from '../../prisma/prisma.service';
import { MessageTemplatesService } from './message-templates.service';

/** Ayarlar > Mesaj şablonları: per-locale templates and sending settings (notifications.manage). */
@Controller('studios/:studioId/messaging')
@StudioScoped()
export class MessagingSettingsController {
  constructor(private readonly templates: MessageTemplatesService) {}

  @Get('settings')
  @RequirePermission('notifications.manage')
  getSettings(@Tenant() tenant: TenantContext) {
    return this.templates.getSettings(tenant.studioId);
  }

  @Put('settings')
  @RequirePermission('notifications.manage')
  updateSettings(@Tenant() tenant: TenantContext, @ZodBody(TenantMessagingSettingsSchema) body: TenantMessagingSettingsInput) {
    return this.templates.updateSettings(tenant.studioId, body);
  }

  @Get('templates')
  @RequirePermission('notifications.manage')
  list(@Tenant() tenant: TenantContext, @ZodQuery(TemplateListQuerySchema) query: TemplateListQuery) {
    return this.templates.list(tenant.studioId, query);
  }

  @Put('templates')
  @RequirePermission('notifications.manage')
  upsert(@Tenant() tenant: TenantContext, @ZodBody(TenantTemplateUpsertSchema) body: TenantTemplateUpsertInput) {
    return this.templates.upsert(tenant.studioId, body);
  }

  @Delete('templates/:templateId')
  @RequirePermission('notifications.manage')
  remove(@Tenant() tenant: TenantContext, @Param('templateId', ParseUUIDPipe) templateId: string) {
    return this.templates.remove(tenant.studioId, templateId);
  }
}

/** Platform owner: which tenant owns an inbound WhatsApp number / SMS number (inbound routing). */
@Controller('admin/messaging/studios/:studioId')
@SuperAdminOnly()
export class MessagingRoutingAdminController {
  constructor(
    private readonly templates: MessageTemplatesService,
    private readonly prisma: PrismaService,
  ) {}

  @Put('routing')
  async setRouting(@Param('studioId', ParseUUIDPipe) studioId: string, @ZodBody(MessagingRoutingSchema) body: MessagingRoutingInput) {
    for (const [path, value] of [
      ['whatsappPhoneNumberId', body.whatsappPhoneNumberId],
      ['inboundSmsNumber', body.inboundSmsNumber],
    ] as const) {
      if (!value) continue;
      const taken = await this.prisma.studio.findFirst({
        where: { id: { not: studioId }, messagingSettings: { path: [path], equals: value } },
        select: { id: true },
      });
      if (taken) throw new ConflictException('Bu numara başka bir işletmeye atanmış');
    }
    return this.templates.updateSettings(studioId, body);
  }
}
