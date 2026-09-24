import { Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { z } from 'zod';
import {
  CreateCheckInPointSchema,
  CreateCheckInPointInput,
  StaffCheckInMemberQrSchema,
  StaffCheckInMemberQrInput,
  UpdateCheckInWindowSchema,
  UpdateCheckInWindowInput,
} from '@platform/shared';
import { StudioScoped, RequirePermission } from '../auth/decorators/require-permission.decorator';
import { CurrentUser, Tenant } from '../auth/decorators/current-user.decorator';
import { ZodBody } from '../../common/zod-body.pipe';
import type { AuthUser, TenantContext } from '../auth/tenant-context';
import { CheckInService } from './checkin.service';

const SetPointActiveSchema = z.object({ isActive: z.boolean() });

/** Staff-facing check-in management: points, window, and the member-QR scan. */
@Controller('studios/:studioId/check-in')
@StudioScoped()
export class CheckInController {
  constructor(private readonly checkIn: CheckInService) {}

  @Get('window')
  @RequirePermission('studio.settings.view')
  async getWindow(@Tenant() tenant: TenantContext) {
    return this.checkIn.getWindow(tenant.studioId);
  }

  @Put('window')
  @RequirePermission('studio.settings.manage')
  async updateWindow(@Tenant() tenant: TenantContext, @ZodBody(UpdateCheckInWindowSchema) body: UpdateCheckInWindowInput) {
    return this.checkIn.updateWindow(tenant, body);
  }

  @Post('points')
  @RequirePermission('studio.settings.manage')
  async createPoint(@Tenant() tenant: TenantContext, @ZodBody(CreateCheckInPointSchema) body: CreateCheckInPointInput) {
    return this.checkIn.createPoint(tenant, body);
  }

  @Get('points')
  @RequirePermission('studio.settings.manage')
  async listPoints(@Tenant() tenant: TenantContext) {
    return this.checkIn.listPoints(tenant);
  }

  /** Regenerates the QR payload (invalidates the old poster); this is also the "printable" retrieval. */
  @Post('points/:pointId/rotate')
  @RequirePermission('studio.settings.manage')
  async rotatePoint(@Tenant() tenant: TenantContext, @Param('pointId', ParseUUIDPipe) pointId: string) {
    return this.checkIn.rotatePoint(tenant, pointId);
  }

  @Patch('points/:pointId')
  @RequirePermission('studio.settings.manage')
  async setPointActive(
    @Tenant() tenant: TenantContext,
    @Param('pointId', ParseUUIDPipe) pointId: string,
    @ZodBody(SetPointActiveSchema) body: z.infer<typeof SetPointActiveSchema>,
  ) {
    return this.checkIn.setPointActive(tenant, pointId, body.isActive);
  }

  /** Reception scans a member's dynamic QR. Branch-restricted staff only see/check-in bookings in their branches. */
  @Post('member-qr')
  @RequirePermission('attendance.manage')
  async checkInByMemberQr(
    @Tenant() tenant: TenantContext,
    @CurrentUser() _actor: AuthUser,
    @ZodBody(StaffCheckInMemberQrSchema) body: StaffCheckInMemberQrInput,
  ) {
    return this.checkIn.checkInByMemberQr(tenant.studioId, tenant.branchIds, body.token, body.scheduleId);
  }
}
