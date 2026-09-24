import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { RequirePermission, StudioScoped } from '../auth/decorators/require-permission.decorator';
import { Tenant } from '../auth/decorators/current-user.decorator';
import type { TenantContext } from '../auth/tenant-context';
import { MemberHealthService } from './member-health.service';

/**
 * Staff view of a member's opted-in health trend, for the member card.
 * Requires members.health.view and, for branch-restricted staff, access to
 * the member's home branch; only ever returns data when the member has
 * separately turned shareWithStudio on.
 */
@Controller('studios/:studioId/members/:memberId/health')
@StudioScoped()
export class StudioMemberHealthController {
  constructor(private readonly health: MemberHealthService) {}

  @Get()
  @RequirePermission('members.health.view')
  async getMemberHealth(@Tenant() tenant: TenantContext, @Param('memberId', ParseUUIDPipe) memberId: string) {
    return this.health.staffGetMemberHealth(tenant, memberId);
  }
}
