import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { UpsertPlanSchema } from '@platform/shared';
import type { UpsertPlanInput } from '@platform/shared';
import { SuperAdminOnly } from '../auth/decorators/super-admin-only.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/tenant-context';
import { ZodBody } from '../../common/zod-body.pipe';
import { AdminPlansService } from './admin-plans.service';

@Controller('admin/plans')
@SuperAdminOnly()
export class AdminPlansController {
  constructor(private readonly plans: AdminPlansService) {}

  @Get()
  async list() {
    return { items: await this.plans.list() };
  }

  @Post()
  async upsert(@CurrentUser() user: AuthUser, @ZodBody(UpsertPlanSchema) body: UpsertPlanInput) {
    return this.plans.upsert(user.id, body);
  }

  @Post(':key/deactivate')
  async deactivate(@CurrentUser() user: AuthUser, @Param('key') key: string) {
    return this.plans.setActive(user.id, key, false);
  }

  @Post(':key/activate')
  async activate(@CurrentUser() user: AuthUser, @Param('key') key: string) {
    return this.plans.setActive(user.id, key, true);
  }
}
