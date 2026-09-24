import { Controller, Get, Post, Param, Query, Patch } from '@nestjs/common';
import { SchedulesService } from './schedules.service';
import { StudioScoped, RequirePermission, SelfService } from '../auth/decorators/require-permission.decorator';
import { Tenant } from '../auth/decorators/current-user.decorator';
import { ZodBody } from '../../common/zod-body.pipe';
import type { TenantContext } from '../auth/tenant-context';
import {
  CreateScheduleSchema,
  CreateScheduleInput,
  BookSessionSchema,
  BookSessionInput,
  CancelBookingSchema,
  CancelBookingInput,
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
  async checkIn(@Param('bookingId') bookingId: string, @Tenant() tenant: TenantContext) {
    return this.schedulesService.checkIn(tenant, bookingId);
  }
}
