import { Controller, Delete, Get, HttpCode, Param, Post, Put, UseGuards } from '@nestjs/common';
import {
  RegisterPushDeviceSchema,
  UpdateNotificationPreferencesSchema,
  type CalendarFeedCreatedDTO,
  type MeSummaryDTO,
  type MeUpcomingBookingsDTO,
} from '@platform/shared';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ZodBody } from '../../common/zod-body.pipe';
import { NotificationPreferencesService } from '../notifications/notification-preferences.service';
import { CalendarService } from '../calendar/calendar.service';
import { MeBookingsService } from '../calendar/me-bookings.service';
import type { AuthUser } from '../auth/tenant-context';

/**
 * The signed-in user's own account settings ("Hesabım"). Not studio
 * scoped: preferences and devices belong to the global user.
 */
@Controller('me')
@UseGuards(JwtAuthGuard)
export class MeController {
  constructor(
    private readonly preferences: NotificationPreferencesService,
    private readonly calendar: CalendarService,
    private readonly bookings: MeBookingsService,
  ) {}

  @Get('bookings/upcoming')
  async getUpcomingBookings(@CurrentUser() user: AuthUser): Promise<MeUpcomingBookingsDTO> {
    return this.bookings.getUpcomingBookings(user.id);
  }

  @Get('summary')
  async getSummary(@CurrentUser() user: AuthUser): Promise<MeSummaryDTO> {
    return this.bookings.getSummary(user.id);
  }

  @Post('calendar-feed')
  async createCalendarFeed(@CurrentUser() user: AuthUser): Promise<CalendarFeedCreatedDTO> {
    return this.calendar.rotate(user.id);
  }

  @Delete('calendar-feed')
  @HttpCode(204)
  async revokeCalendarFeed(@CurrentUser() user: AuthUser): Promise<void> {
    await this.calendar.revoke(user.id);
  }

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
