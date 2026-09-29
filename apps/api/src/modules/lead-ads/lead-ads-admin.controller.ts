import { Body, Controller, Get, Put } from '@nestjs/common';
import { SetLeadgenVerifyTokenSchema, type SetLeadgenVerifyTokenInput } from '@platform/shared';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SuperAdminOnly } from '../auth/decorators/super-admin-only.decorator';
import type { AuthUser } from '../auth/tenant-context';
import { ZodValidationPipe } from '../../common/zod-body.pipe';
import { LeadAdsAdminService } from './lead-ads-admin.service';

/**
 * Super admin only: the Meta leadgen webhook verify token. The token is a
 * platform-wide setting, never an environment variable; only its hash is
 * stored and the plaintext is returned once, when it is set or generated.
 */
@Controller('admin/integrations/lead-ads/verify-token')
@SuperAdminOnly()
export class LeadAdsAdminController {
  constructor(private readonly admin: LeadAdsAdminService) {}

  @Get()
  state() {
    return this.admin.verifyTokenState();
  }

  @Put()
  set(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(SetLeadgenVerifyTokenSchema)) body: SetLeadgenVerifyTokenInput) {
    return this.admin.setVerifyToken(user.id, body.token);
  }
}
