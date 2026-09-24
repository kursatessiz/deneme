import { Controller, Get, Header, Put, UseGuards } from '@nestjs/common';
import { UpdateConsentSchema } from '@platform/shared';
import type { UpdateConsentInput } from '@platform/shared';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser, Tenant } from '../../auth/decorators/current-user.decorator';
import { RequirePermission, SelfService, StudioScoped } from '../../auth/decorators/require-permission.decorator';
import { ZodBody } from '../../../common/zod-body.pipe';
import type { AuthUser, TenantContext } from '../../auth/tenant-context';
import { ConsentService } from './consent.service';

/**
 * Commercial (İYS) communication consent. Transactional messages never need
 * this; only MARKETING-category and other non-transactional templates do.
 */
@Controller('studios/:studioId/notification-consents')
@StudioScoped()
export class ConsentController {
  constructor(private readonly consent: ConsentService) {}

  @Get('self')
  @SelfService()
  async getOwn(@Tenant() tenant: TenantContext, @CurrentUser() user: AuthUser) {
    return { items: await this.consent.listForUser(tenant.studioId, user.id) };
  }

  @Put('self')
  @SelfService()
  async setOwn(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @ZodBody(UpdateConsentSchema) body: UpdateConsentInput,
  ) {
    return { items: await this.consent.setOwn(tenant.studioId, user.id, body) };
  }

  @Get()
  @RequirePermission('members.view')
  async listForStudio(@Tenant() tenant: TenantContext) {
    return { items: await this.consent.listForStudio(tenant.studioId) };
  }

  @Get('export')
  @RequirePermission('members.view')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="iletisim-izinleri.csv"')
  async exportForStudio(@Tenant() tenant: TenantContext) {
    const rows = await this.consent.listForStudio(tenant.studioId);
    const header = 'Ad Soyad,Telefon,Kanal,Durum,Kaynak,Onay Tarihi,İptal Tarihi,İYS Senkron';
    const lines = rows.map((r) =>
      [
        r.fullName,
        r.phone,
        r.channel,
        r.status,
        r.source,
        r.grantedAt?.toISOString() ?? '',
        r.revokedAt?.toISOString() ?? '',
        r.iysSyncedAt?.toISOString() ?? '',
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(','),
    );
    return [header, ...lines].join('\n');
  }
}
