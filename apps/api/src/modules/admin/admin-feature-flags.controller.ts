import { Body, Controller, Get, Post } from '@nestjs/common';
import { SetFeatureFlagSchema, FEATURE_FLAGS } from '@platform/shared';
import type { SetFeatureFlagInput } from '@platform/shared';
import { SuperAdminOnly } from '../auth/decorators/super-admin-only.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/tenant-context';
import { ZodBody } from '../../common/zod-body.pipe';
import { FeatureFlagsService } from './feature-flags.service';

@Controller('admin/feature-flags')
@SuperAdminOnly()
export class AdminFeatureFlagsController {
  constructor(private readonly flags: FeatureFlagsService) {}

  @Get('catalog')
  catalog() {
    return { items: Object.entries(FEATURE_FLAGS).map(([key, description]) => ({ key, description })) };
  }

  @Get()
  async list() {
    return { items: await this.flags.list() };
  }

  @Post()
  async set(@CurrentUser() user: AuthUser, @ZodBody(SetFeatureFlagSchema) body: SetFeatureFlagInput) {
    return this.flags.set(user.id, body);
  }
}
