import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { UpsertBusinessTypeTemplateSchema } from '@platform/shared';
import type { UpsertBusinessTypeTemplateInput } from '@platform/shared';
import { SuperAdminOnly } from '../auth/decorators/super-admin-only.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/tenant-context';
import { ZodBody } from '../../common/zod-body.pipe';
import { AdminBusinessTypesService } from './admin-business-types.service';

@Controller('admin/business-type-templates')
@SuperAdminOnly()
export class AdminBusinessTypesController {
  constructor(private readonly businessTypes: AdminBusinessTypesService) {}

  @Get()
  async list() {
    return { items: await this.businessTypes.list() };
  }

  @Post()
  async upsert(@CurrentUser() user: AuthUser, @ZodBody(UpsertBusinessTypeTemplateSchema) body: UpsertBusinessTypeTemplateInput) {
    return this.businessTypes.upsert(user.id, body);
  }

  @Post(':key/apply-to-tenant/:studioId')
  async applyToTenant(
    @CurrentUser() user: AuthUser,
    @Param('key') key: string,
    @Param('studioId', ParseUUIDPipe) studioId: string,
  ) {
    return this.businessTypes.applyToTenant(user.id, studioId, key);
  }
}
