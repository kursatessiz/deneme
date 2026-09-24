import { Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AcceptInviteSchema, CreateInviteSchema } from '@platform/shared';
import { InvitesService } from './invites.service';
import { StudioScoped, SelfService } from '../auth/decorators/require-permission.decorator';
import { CurrentUser, Tenant } from '../auth/decorators/current-user.decorator';
import { ZodBody } from '../../common/zod-body.pipe';
import type { AuthUser, TenantContext } from '../auth/tenant-context';

@Controller('invites')
export class InvitesController {
  constructor(private readonly invites: InvitesService) {}

  /**
   * members.manage for member invites, staff.manage for staff roles; the
   * service checks which one applies to the requested role.
   */
  @Post()
  @StudioScoped()
  @SelfService()
  async create(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @ZodBody(CreateInviteSchema) body: ReturnType<typeof CreateInviteSchema.parse>,
  ) {
    return this.invites.create(tenant, user, body);
  }

  // Public: the token itself is the credential (256 bits, single use, 72 h).
  @Get(':token')
  async preview(@Param('token') token: string) {
    return this.invites.preview(token);
  }

  @Post(':token/otp')
  @HttpCode(202)
  async requestOtp(@Param('token') token: string, @Req() req: Request) {
    return this.invites.requestOtp(token, req.ip ?? null);
  }

  @Post(':token/accept')
  @HttpCode(200)
  async accept(
    @Param('token') token: string,
    @ZodBody(AcceptInviteSchema) body: ReturnType<typeof AcceptInviteSchema.parse>,
    @Req() req: Request,
  ) {
    return this.invites.accept(token, body, req.ip ?? null);
  }
}
