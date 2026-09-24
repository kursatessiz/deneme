import { Controller, Get, Param, Query } from '@nestjs/common';
import { TrainersService } from './trainers.service';
import { StudioScoped, RequirePermission, SelfService } from '../auth/decorators/require-permission.decorator';
import { Tenant } from '../auth/decorators/current-user.decorator';
import type { TenantContext } from '../auth/tenant-context';

@Controller('trainers')
@StudioScoped()
export class TrainersController {
  constructor(private trainersService: TrainersService) {}

  @Get('studio/:studioId')
  @RequirePermission('schedule.view')
  async findAll(@Tenant() tenant: TenantContext) {
    return this.trainersService.findAll(tenant);
  }

  @Get(':trainerId/commission/studio/:studioId')
  @SelfService()
  async getCommission(
    @Param('trainerId') trainerId: string,
    @Tenant() tenant: TenantContext,
    @Query('month') month?: string,
    @Query('year') year?: string,
  ) {
    const current = new Date();
    const m = month ? parseInt(month, 10) : current.getMonth() + 1;
    const y = year ? parseInt(year, 10) : current.getFullYear();

    return this.trainersService.calculateCommissionReport(tenant, trainerId, m, y);
  }
}
