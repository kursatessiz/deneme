import { Controller, Delete, Get, HttpCode, Post, Put, Req } from '@nestjs/common';
import type { Request } from 'express';
import {
  AcceptHealthConsentSchema,
  CreateHealthSyncRecordSchema,
  UpdateHealthSettingsSchema,
  UpsertHealthSummariesSchema,
  type AcceptHealthConsentInput,
  type CreateHealthSyncRecordInput,
  type UpdateHealthSettingsInput,
  type UpsertHealthSummariesInput,
} from '@platform/shared';
import { SelfService, StudioScoped } from '../auth/decorators/require-permission.decorator';
import { CurrentUser, Tenant } from '../auth/decorators/current-user.decorator';
import { ZodBody } from '../../common/zod-body.pipe';
import type { AuthUser, TenantContext } from '../auth/tenant-context';
import { MemberHealthService } from './member-health.service';

/**
 * The signed-in member's own Apple Health / Health Connect integration
 * ("Hesabım > Sağlık entegrasyonu"). Every route is self-service: the caller
 * only ever sees or changes their own membership's health data.
 */
@Controller('me/health')
@StudioScoped()
export class MemberHealthController {
  constructor(private readonly health: MemberHealthService) {}

  @Get('settings')
  @SelfService()
  async getSettings(@Tenant() tenant: TenantContext) {
    return this.health.getSettings(tenant);
  }

  @Put('settings')
  @SelfService()
  async updateSettings(@Tenant() tenant: TenantContext, @ZodBody(UpdateHealthSettingsSchema) body: UpdateHealthSettingsInput) {
    return this.health.updateSettings(tenant, body);
  }

  @Get('consent')
  @SelfService()
  async getConsent(@Tenant() tenant: TenantContext) {
    return this.health.getConsentStatus(tenant);
  }

  @Post('consent')
  @SelfService()
  async acceptConsent(
    @Tenant() tenant: TenantContext,
    @ZodBody(AcceptHealthConsentSchema) body: AcceptHealthConsentInput,
    @Req() req: Request,
  ) {
    return this.health.acceptConsent(tenant, body, req.ip ?? null);
  }

  @Post('summaries')
  @SelfService()
  async upsertSummaries(@Tenant() tenant: TenantContext, @ZodBody(UpsertHealthSummariesSchema) body: UpsertHealthSummariesInput) {
    return this.health.upsertSummaries(tenant, body);
  }

  @Get('summaries')
  @SelfService()
  async getSummaries(@Tenant() tenant: TenantContext) {
    return this.health.getMySummaries(tenant);
  }

  @Delete('data')
  @SelfService()
  @HttpCode(200)
  async deleteData(@Tenant() tenant: TenantContext, @CurrentUser() user: AuthUser) {
    return this.health.deleteAllData(tenant, user.id);
  }

  @Get('sync-records')
  @SelfService()
  async listSyncRecords(@Tenant() tenant: TenantContext) {
    return this.health.listSyncRecords(tenant);
  }

  @Get('pending-workouts')
  @SelfService()
  async getPendingWorkouts(@Tenant() tenant: TenantContext) {
    return this.health.getPendingWorkouts(tenant);
  }

  @Post('sync-records')
  @SelfService()
  async createSyncRecord(@Tenant() tenant: TenantContext, @ZodBody(CreateHealthSyncRecordSchema) body: CreateHealthSyncRecordInput) {
    return this.health.createSyncRecord(tenant, body);
  }
}
