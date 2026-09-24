import { Controller, ForbiddenException, Get, Post, Put, UseGuards } from '@nestjs/common';
import { NotificationSettingsSchema, TopUpSmsWalletSchema } from '@platform/shared';
import type { NotificationSettings, TopUpSmsWalletInput } from '@platform/shared';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser, Tenant } from '../../auth/decorators/current-user.decorator';
import { RequirePermission, StudioScoped } from '../../auth/decorators/require-permission.decorator';
import { ZodBody } from '../../../common/zod-body.pipe';
import type { AuthUser, TenantContext } from '../../auth/tenant-context';
import { NotificationSettingsService } from './notification-settings.service';

@Controller('studios/:studioId/notification-settings')
@StudioScoped()
export class NotificationSettingsController {
  constructor(private readonly settings: NotificationSettingsService) {}

  @Get()
  @RequirePermission('notifications.manage')
  async get(@Tenant() tenant: TenantContext) {
    return this.settings.getSettings(tenant.studioId);
  }

  @Put()
  @RequirePermission('notifications.manage')
  async update(@Tenant() tenant: TenantContext, @ZodBody(NotificationSettingsSchema) body: NotificationSettings) {
    return this.settings.updateSettings(tenant.studioId, body);
  }
}

@Controller('studios/:studioId/sms-wallet')
@StudioScoped()
export class SmsWalletController {
  constructor(private readonly settings: NotificationSettingsService) {}

  @Get()
  @RequirePermission('notifications.manage')
  async getWallet(@Tenant() tenant: TenantContext) {
    return this.settings.getWallet(tenant.studioId);
  }

  @Get('transactions')
  @RequirePermission('notifications.manage')
  async listTransactions(@Tenant() tenant: TenantContext) {
    return { items: await this.settings.listTransactions(tenant.studioId) };
  }
}

/** Platform-wide manual SMS credit top-up: super admin only. */
@Controller('sms-wallet')
@UseGuards(JwtAuthGuard)
export class SmsWalletAdminController {
  constructor(private readonly settings: NotificationSettingsService) {}

  @Post('top-up')
  async topUp(@CurrentUser() user: AuthUser, @ZodBody(TopUpSmsWalletSchema) body: TopUpSmsWalletInput) {
    if (!user.isSuperAdmin) {
      throw new ForbiddenException('Bu işlem için yetkiniz yok');
    }
    return this.settings.topUp(user.id, body);
  }
}
