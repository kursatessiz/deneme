import { Controller, Get, Param, Post } from '@nestjs/common';
import { UpsertSmsPackageSchema } from '@platform/shared';
import type { UpsertSmsPackageInput } from '@platform/shared';
import { SuperAdminOnly } from '../auth/decorators/super-admin-only.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/tenant-context';
import { ZodBody } from '../../common/zod-body.pipe';
import { AdminSmsPackagesService } from './admin-sms-packages.service';

@Controller('admin/sms-packages')
@SuperAdminOnly()
export class AdminSmsPackagesController {
  constructor(private readonly packages: AdminSmsPackagesService) {}

  @Get()
  async list() {
    return { items: await this.packages.list() };
  }

  @Post()
  async upsert(@CurrentUser() user: AuthUser, @ZodBody(UpsertSmsPackageSchema) body: UpsertSmsPackageInput) {
    return this.packages.upsert(user.id, body);
  }

  @Post(':key/deactivate')
  async deactivate(@CurrentUser() user: AuthUser, @Param('key') key: string) {
    return this.packages.setActive(user.id, key, false);
  }

  @Post(':key/activate')
  async activate(@CurrentUser() user: AuthUser, @Param('key') key: string) {
    return this.packages.setActive(user.id, key, true);
  }
}
