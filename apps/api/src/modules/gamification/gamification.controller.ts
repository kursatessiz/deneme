import { Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import {
  CreateBadgeDefinitionSchema,
  LeaderboardOptInSchema,
  LeaderboardQuerySchema,
  SetMonthlyGoalSchema,
  UpdateBadgeDefinitionSchema,
  UpdateGamificationSettingsSchema,
  type CreateBadgeDefinitionInput,
  type LeaderboardOptInInput,
  type LeaderboardQuery,
  type SetMonthlyGoalInput,
  type UpdateBadgeDefinitionInput,
  type UpdateGamificationSettingsInput,
} from '@platform/shared';
import { RequirePermission, SelfService, StudioScoped } from '../auth/decorators/require-permission.decorator';
import { Tenant } from '../auth/decorators/current-user.decorator';
import { ZodBody, ZodQuery } from '../../common/zod-body.pipe';
import type { TenantContext } from '../auth/tenant-context';
import { GamificationService } from './gamification.service';

@Controller('gamification/studio/:studioId')
@StudioScoped()
export class GamificationController {
  constructor(private readonly gamification: GamificationService) {}

  // -- Staff: enable / disable gamification for the studio ------------------

  @Get('settings')
  @RequirePermission('reports.view')
  async getSettings(@Tenant() tenant: TenantContext) {
    return this.gamification.getSettings(tenant);
  }

  @Put('settings')
  @RequirePermission('studio.settings.manage')
  async updateSettings(@Tenant() tenant: TenantContext, @ZodBody(UpdateGamificationSettingsSchema) body: UpdateGamificationSettingsInput) {
    return this.gamification.updateSettings(tenant, body.enabled);
  }

  // -- Staff: badge definitions -------------------------------------------

  @Get('badge-definitions')
  @RequirePermission('reports.view')
  async listDefinitions(@Tenant() tenant: TenantContext) {
    return this.gamification.listDefinitions(tenant);
  }

  @Post('badge-definitions')
  @RequirePermission('studio.settings.manage')
  async createDefinition(@Tenant() tenant: TenantContext, @ZodBody(CreateBadgeDefinitionSchema) body: CreateBadgeDefinitionInput) {
    return this.gamification.createDefinition(tenant, body);
  }

  @Put('badge-definitions/:id')
  @RequirePermission('studio.settings.manage')
  async updateDefinition(
    @Tenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(UpdateBadgeDefinitionSchema) body: UpdateBadgeDefinitionInput,
  ) {
    return this.gamification.updateDefinition(tenant, id, body);
  }

  @Delete('badge-definitions/:id')
  @RequirePermission('studio.settings.manage')
  async deleteDefinition(@Tenant() tenant: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.gamification.deleteDefinition(tenant, id);
    return { deleted: true };
  }

  // -- Staff: member achievements and backfill -----------------------------

  @Get('achievements')
  @RequirePermission('reports.view')
  async memberAchievements(@Tenant() tenant: TenantContext) {
    return this.gamification.memberAchievements(tenant);
  }

  @Post('backfill')
  @RequirePermission('studio.settings.manage')
  async backfill(@Tenant() tenant: TenantContext) {
    return this.gamification.backfill(tenant);
  }

  // -- Member self-service ---------------------------------------------------

  @Get('me/stats')
  @SelfService()
  async myStats(@Tenant() tenant: TenantContext) {
    return this.gamification.myStats(tenant);
  }

  @Put('me/goal')
  @SelfService()
  async setGoal(@Tenant() tenant: TenantContext, @ZodBody(SetMonthlyGoalSchema) body: SetMonthlyGoalInput) {
    return this.gamification.setMonthlyGoal(tenant, body);
  }

  @Put('me/leaderboard-opt-in')
  @SelfService()
  async setLeaderboardOptIn(@Tenant() tenant: TenantContext, @ZodBody(LeaderboardOptInSchema) body: LeaderboardOptInInput) {
    return this.gamification.setLeaderboardOptIn(tenant, body.optedIn);
  }

  @Get('leaderboard')
  @SelfService()
  async leaderboard(@Tenant() tenant: TenantContext, @ZodQuery(LeaderboardQuerySchema) query: LeaderboardQuery) {
    return this.gamification.leaderboard(tenant, query.month);
  }
}
