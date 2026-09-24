import { Controller, Get, Post, Param, Query, Patch, ParseUUIDPipe } from '@nestjs/common';
import { SchedulesService } from './schedules.service';
import { StudioScoped, RequirePermission, SelfService } from '../auth/decorators/require-permission.decorator';
import { CurrentUser, Tenant } from '../auth/decorators/current-user.decorator';
import { ZodBody } from '../../common/zod-body.pipe';
import type { AuthUser, TenantContext } from '../auth/tenant-context';
import {
  CreateScheduleSchema,
  CreateScheduleInput,
  BookSessionSchema,
  BookSessionInput,
  CancelBookingSchema,
  CancelBookingInput,
  MarkNoShowSchema,
  MarkNoShowInput,
  JoinWaitlistSchema,
  JoinWaitlistInput,
  LeaveWaitlistSchema,
  LeaveWaitlistInput,
  SubstituteTrainerSchema,
  SubstituteTrainerInput,
} from '@platform/shared';

@Controller('schedules')
@StudioScoped()
export class SchedulesController {
  constructor(private schedulesService: SchedulesService) {}

  @Get('studio/:studioId')
  @RequirePermission('schedule.view')
  async getSchedules(
    @Tenant() tenant: TenantContext,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Query('trainerId') trainerId?: string,
    @Query('resourceId') resourceId?: string,
  ) {
    const start = startDate ? new Date(startDate) : new Date();
    const end = endDate ? new Date(endDate) : new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);

    return this.schedulesService.getSchedules(tenant, start, end, trainerId, resourceId);
  }

  @Post()
  @RequirePermission('schedule.manage')
  async createSchedule(@Tenant() tenant: TenantContext, @ZodBody(CreateScheduleSchema) body: CreateScheduleInput) {
    return this.schedulesService.createSchedule(tenant, body);
  }

  @Post('book')
  @RequirePermission('bookings.manage')
  async bookSession(@Tenant() tenant: TenantContext, @ZodBody(BookSessionSchema) body: BookSessionInput) {
    return this.schedulesService.bookSession(tenant, body);
  }

  @Post('book/self')
  @SelfService()
  async bookSessionSelf(@Tenant() tenant: TenantContext, @ZodBody(BookSessionSchema) body: BookSessionInput) {
    return this.schedulesService.bookSessionSelf(tenant, body);
  }

  @Post('cancel')
  @RequirePermission('bookings.manage')
  async cancelBooking(@Tenant() tenant: TenantContext, @ZodBody(CancelBookingSchema) body: CancelBookingInput) {
    return this.schedulesService.cancelBooking(tenant, body);
  }

  @Post('cancel/self')
  @SelfService()
  async cancelBookingSelf(@Tenant() tenant: TenantContext, @ZodBody(CancelBookingSchema) body: CancelBookingInput) {
    return this.schedulesService.cancelBookingSelf(tenant, body);
  }

  @Patch('check-in/:bookingId')
  @RequirePermission('attendance.manage')
  async checkIn(@Param('bookingId', ParseUUIDPipe) bookingId: string, @Tenant() tenant: TenantContext) {
    return this.schedulesService.checkIn(tenant, bookingId);
  }

  @Patch('no-show/:bookingId')
  @RequirePermission('attendance.manage')
  async markNoShow(
    @Param('bookingId', ParseUUIDPipe) bookingId: string,
    @Tenant() tenant: TenantContext,
    @ZodBody(MarkNoShowSchema) body: MarkNoShowInput,
  ) {
    return this.schedulesService.markNoShow(tenant, bookingId, body);
  }

  @Get('waitlist/:scheduleId')
  @RequirePermission('bookings.view')
  async getWaitlist(@Param('scheduleId', ParseUUIDPipe) scheduleId: string, @Tenant() tenant: TenantContext) {
    return this.schedulesService.getWaitlist(tenant, scheduleId);
  }

  @Post('waitlist')
  @RequirePermission('bookings.manage')
  async joinWaitlist(@Tenant() tenant: TenantContext, @ZodBody(JoinWaitlistSchema) body: JoinWaitlistInput) {
    return this.schedulesService.joinWaitlist(tenant, body);
  }

  @Post('waitlist/self')
  @SelfService()
  async joinWaitlistSelf(@Tenant() tenant: TenantContext, @ZodBody(JoinWaitlistSchema) body: JoinWaitlistInput) {
    return this.schedulesService.joinWaitlistSelf(tenant, body);
  }

  @Post('waitlist/leave')
  @RequirePermission('bookings.manage')
  async leaveWaitlist(@Tenant() tenant: TenantContext, @ZodBody(LeaveWaitlistSchema) body: LeaveWaitlistInput) {
    return this.schedulesService.leaveWaitlist(tenant, body);
  }

  @Post('waitlist/leave/self')
  @SelfService()
  async leaveWaitlistSelf(@Tenant() tenant: TenantContext, @ZodBody(LeaveWaitlistSchema) body: LeaveWaitlistInput) {
    return this.schedulesService.leaveWaitlistSelf(tenant, body);
  }

  @Post(':scheduleId/substitute')
  @RequirePermission('schedule.manage')
  async substituteTrainer(
    @Param('scheduleId', ParseUUIDPipe) scheduleId: string,
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @ZodBody(SubstituteTrainerSchema) body: SubstituteTrainerInput,
  ) {
    return this.schedulesService.substituteTrainer(tenant, user.id, scheduleId, body);
  }
}
