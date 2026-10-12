import { Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import {
  ApproveErasureRequestSchema,
  ErasureRequestListQuerySchema,
  RejectErasureRequestSchema,
  StartErasureSchema,
  type ApproveErasureRequestInput,
  type ErasureRequestListQuery,
  type RejectErasureRequestInput,
  type StartErasureInput,
} from '@platform/shared';
import { AllowWhenRestricted, RequirePermission, SelfService, StudioScoped } from '../auth/decorators/require-permission.decorator';
import { CurrentUser, Tenant } from '../auth/decorators/current-user.decorator';
import { ZodBody, ZodQuery } from '../../common/zod-body.pipe';

import type { AuthUser, TenantContext } from '../auth/tenant-context';
import { ErasureRequestsService } from './erasure-requests.service';

/**
 * Staff side of KVKK/GDPR erasure (docs/KVKK_SILME.md): the request list, the
 * approve and reject decisions and the direct start from the member card.
 * Every route needs `members.erase`. The writes stay open in restricted
 * billing mode: a data subject request is a legal duty (docs/DENEME_VE_ETKINLESTIRME.md).
 */
@Controller('studios/:studioId')
@StudioScoped()
export class ErasureStaffController {
  constructor(private readonly requests: ErasureRequestsService) {}

  @Get('erasure-requests')
  @RequirePermission('members.erase')
  async list(@Tenant() tenant: TenantContext, @ZodQuery(ErasureRequestListQuerySchema) query: ErasureRequestListQuery) {
    return this.requests.list(tenant, query);
  }

  @Post('erasure-requests/:requestId/approve')
  @AllowWhenRestricted()
  @RequirePermission('members.erase')
  async approve(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @ZodBody(ApproveErasureRequestSchema) body: ApproveErasureRequestInput,
  ) {
    return this.requests.approve(tenant, user.id, requestId, body.note);
  }

  @Post('erasure-requests/:requestId/reject')
  @AllowWhenRestricted()
  @RequirePermission('members.erase')
  async reject(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @ZodBody(RejectErasureRequestSchema) body: RejectErasureRequestInput,
  ) {
    return this.requests.reject(tenant, user.id, requestId, body.note);
  }

  @Get('members/:memberId/erasure')
  @RequirePermission('members.erase')
  async memberStatus(@Tenant() tenant: TenantContext, @Param('memberId', ParseUUIDPipe) memberId: string) {
    return this.requests.getForMember(tenant, memberId);
  }

  @Post('members/:memberId/erasure')
  @AllowWhenRestricted()
  @RequirePermission('members.erase')
  async start(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @ZodBody(StartErasureSchema) body: StartErasureInput,
  ) {
    return this.requests.startDirect(tenant, user.id, memberId, body.note);
  }
}

/** The signed-in member's own request ("Hesabım > Gizlilik"). */
@Controller('me/erasure')
@StudioScoped()
export class ErasureSelfController {
  constructor(private readonly requests: ErasureRequestsService) {}

  @Get()
  @SelfService()
  async status(@Tenant() tenant: TenantContext) {
    return this.requests.getOwn(tenant);
  }

  @Post()
  @AllowWhenRestricted()
  @SelfService()
  async request(@Tenant() tenant: TenantContext, @CurrentUser() user: AuthUser) {
    return this.requests.requestOwn(tenant, user.id);
  }
}
