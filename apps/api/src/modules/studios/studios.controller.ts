import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { StudiosService } from './studios.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { StudioTenantGuard } from '../auth/guards/studio-tenant.guard';

@Controller('studios')
export class StudiosController {
  constructor(private studiosService: StudiosService) {}

  @Get()
  async findAll() {
    return this.studiosService.findAll();
  }

  @Get('public/:slug')
  async findBySlug(@Param('slug') slug: string) {
    return this.studiosService.findBySlug(slug);
  }

  @Get(':studioId/metrics')
  @UseGuards(JwtAuthGuard, StudioTenantGuard)
  async getMetrics(@Param('studioId') studioId: string) {
    return this.studiosService.getDashboardMetrics(studioId);
  }
}
