import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import {
  CreateAutomationRuleSchema,
  ToggleAutomationRuleSchema,
  UpdateAutomationRuleSchema,
  AutomationRunHistoryQuerySchema,
  type CreateAutomationRuleInput,
  type ToggleAutomationRuleInput,
  type UpdateAutomationRuleInput,
  type AutomationRunHistoryQuery,
} from '@platform/shared';
import { RequirePermission, StudioScoped } from '../auth/decorators/require-permission.decorator';
import { Tenant } from '../auth/decorators/current-user.decorator';
import { ZodBody, ZodQuery } from '../../common/zod-body.pipe';
import type { TenantContext } from '../auth/tenant-context';
import { AutomationRulesService } from './automation-rules.service';

@Controller('studios/:studioId/automation-rules')
@StudioScoped()
export class AutomationRulesController {
  constructor(private readonly rules: AutomationRulesService) {}

  @Get()
  @RequirePermission('notifications.manage')
  async list(@Tenant() tenant: TenantContext) {
    return { items: await this.rules.list(tenant.studioId) };
  }

  @Get('stats')
  @RequirePermission('notifications.manage')
  async stats(@Tenant() tenant: TenantContext) {
    return { items: await this.rules.stats(tenant.studioId) };
  }

  @Get('runs')
  @RequirePermission('notifications.manage')
  async history(@Tenant() tenant: TenantContext, @ZodQuery(AutomationRunHistoryQuerySchema) query: AutomationRunHistoryQuery) {
    return this.rules.history(tenant.studioId, query);
  }

  @Get(':id')
  @RequirePermission('notifications.manage')
  async get(@Tenant() tenant: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.rules.get(tenant.studioId, id);
  }

  @Get(':id/preview')
  @RequirePermission('notifications.manage')
  async preview(@Tenant() tenant: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.rules.previewAudience(tenant.studioId, id);
  }

  @Post()
  @RequirePermission('notifications.manage')
  async create(@Tenant() tenant: TenantContext, @ZodBody(CreateAutomationRuleSchema) body: CreateAutomationRuleInput) {
    return this.rules.create(tenant.studioId, body);
  }

  @Put(':id')
  @RequirePermission('notifications.manage')
  async update(
    @Tenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(UpdateAutomationRuleSchema) body: UpdateAutomationRuleInput,
  ) {
    return this.rules.update(tenant.studioId, id, body);
  }

  @Patch(':id/toggle')
  @RequirePermission('notifications.manage')
  async toggle(
    @Tenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(ToggleAutomationRuleSchema) body: ToggleAutomationRuleInput,
  ) {
    return this.rules.toggle(tenant.studioId, id, body.isActive);
  }
}
