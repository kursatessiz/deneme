import { Controller, Get } from '@nestjs/common';
import { SuperAdminOnly } from '../auth/decorators/super-admin-only.decorator';
import { AdminHealthService } from './admin-health.service';

@Controller('admin/health')
@SuperAdminOnly()
export class AdminHealthController {
  constructor(private readonly health: AdminHealthService) {}

  @Get()
  async get() {
    return this.health.getHealth();
  }
}
