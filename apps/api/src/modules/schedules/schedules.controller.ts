import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  Patch,
} from '@nestjs/common';
import { SchedulesService } from './schedules.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { StudioTenantGuard } from '../auth/guards/studio-tenant.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import {
  CreateScheduleSchema,
  CreateScheduleInput,
  BookSessionSchema,
  BookSessionInput,
  CancelBookingSchema,
  CancelBookingInput,
} from '@platform/shared';

@Controller('schedules')
@UseGuards(JwtAuthGuard, StudioTenantGuard)
export class SchedulesController {
  constructor(private schedulesService: SchedulesService) {}

  @Get('studio/:studioId')
  async getSchedules(
    @Param('studioId') studioId: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Query('trainerId') trainerId?: string,
    @Query('roomId') roomId?: string,
  ) {
    const start = startDate ? new Date(startDate) : new Date();
    const end = endDate
      ? new Date(endDate)
      : new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);

    return this.schedulesService.getSchedules(studioId, start, end, trainerId, roomId);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('STUDIO_ADMIN', 'RECEPTIONIST')
  async createSchedule(@Body() body: CreateScheduleInput) {
    const validated = CreateScheduleSchema.parse(body);
    return this.schedulesService.createSchedule(validated);
  }

  @Post('book')
  async bookSession(@Body() body: BookSessionInput) {
    const validated = BookSessionSchema.parse(body);
    return this.schedulesService.bookSession(validated);
  }

  @Post('cancel')
  async cancelBooking(@Body() body: CancelBookingInput) {
    const validated = CancelBookingSchema.parse(body);
    return this.schedulesService.cancelBooking(validated);
  }

  @Patch('check-in/:bookingId')
  @UseGuards(RolesGuard)
  @Roles('STUDIO_ADMIN', 'RECEPTIONIST', 'TRAINER')
  async checkIn(@Param('bookingId') bookingId: string) {
    return this.schedulesService.checkIn(bookingId);
  }
}
