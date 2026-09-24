import { Controller, Delete, Get, HttpCode, Param, Post, Put, UseGuards } from '@nestjs/common';
import { RegisterPushDeviceSchema, UpdateNotificationPreferencesSchema } from '@platform/shared';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ZodBody } from '../../common/zod-body.pipe';
import { NotificationPreferencesService } from '../notifications/notification-preferences.service';
import type { AuthUser } from '../auth/tenant-context';

/**
 * The signed-in user's own account settings ("Hesabım"). Not studio
 * scoped: preferences and devices belong to the global user.
 */
@Controller('me')
@UseGuards(JwtAuthGuard)
export class MeController {
  constructor(private readonly preferences: NotificationPreferencesService) {}

  @Get('notification-preferences')
  async getPreferences(@CurrentUser() user: AuthUser) {
    return this.preferences.get(user.id);
  }

  @Put('notification-preferences')
  async updatePreferences(
    @CurrentUser() user: AuthUser,
    @ZodBody(UpdateNotificationPreferencesSchema) body: ReturnType<typeof UpdateNotificationPreferencesSchema.parse>,
  ) {
    return this.preferences.update(user.id, body);
  }

  @Post('push-devices')
  @HttpCode(204)
  async registerDevice(
    @CurrentUser() user: AuthUser,
    @ZodBody(RegisterPushDeviceSchema) body: ReturnType<typeof RegisterPushDeviceSchema.parse>,
  ) {
    await this.preferences.registerDevice(user.id, body);
  }

  @Delete('push-devices/:token')
  @HttpCode(204)
  async removeDevice(@CurrentUser() user: AuthUser, @Param('token') token: string) {
    await this.preferences.removeDevice(user.id, token);
  }
}
