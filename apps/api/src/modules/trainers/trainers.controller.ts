import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { TrainersService } from './trainers.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { StudioTenantGuard } from '../auth/guards/studio-tenant.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('trainers')
@UseGuards(JwtAuthGuard, StudioTenantGuard, RolesGuard)
export class TrainersController {
  constructor(private trainersService: TrainersService) {}

  @Get('studio/:studioId')
  @Roles('STUDIO_ADMIN', 'RECEPTIONIST')
  async findAll(@Param('studioId') studioId: string) {
    return this.trainersService.findAll(studioId);
  }

  @Get(':trainerId/commission/studio/:studioId')
  @Roles('STUDIO_ADMIN')
  async getCommission(
    @Param('trainerId') trainerId: string,
    @Param('studioId') studioId: string,
    @Query('month') month?: string,
    @Query('year') year?: string,
  ) {
    const current = new Date();
    const m = month ? parseInt(month, 10) : current.getMonth() + 1;
    const y = year ? parseInt(year, 10) : current.getFullYear();

    return this.trainersService.calculateCommissionReport(studioId, trainerId, m, y);
  }
}
