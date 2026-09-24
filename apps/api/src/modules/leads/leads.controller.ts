import { Controller, Get, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { LeadsService } from './leads.service';
import { StudioScoped, RequirePermission } from '../auth/decorators/require-permission.decorator';
import { Tenant } from '../auth/decorators/current-user.decorator';
import { ZodBody, ZodQuery } from '../../common/zod-body.pipe';
import type { TenantContext } from '../auth/tenant-context';
import {
  AddLeadActivitySchema,
  AddLeadActivityInput,
  AssignLeadOwnerSchema,
  AssignLeadOwnerInput,
  BookLeadTrialSchema,
  BookLeadTrialInput,
  ChangeLeadStageSchema,
  ChangeLeadStageInput,
  ConvertLeadSchema,
  ConvertLeadInput,
  CreateLeadSchema,
  CreateLeadInput,
  LeadListQuerySchema,
  LeadListQuery,
  UpdateLeadSchema,
  UpdateLeadInput,
} from '@platform/shared';

@Controller('leads')
@StudioScoped()
export class LeadsController {
  constructor(private leadsService: LeadsService) {}

  @Get('studio/:studioId')
  @RequirePermission('leads.view')
  async findAll(@Tenant() tenant: TenantContext, @ZodQuery(LeadListQuerySchema) query: LeadListQuery) {
    return this.leadsService.findAll(tenant, query);
  }

  @Get(':leadId/studio/:studioId')
  @RequirePermission('leads.view')
  async findById(@Param('leadId', ParseUUIDPipe) leadId: string, @Tenant() tenant: TenantContext) {
    return this.leadsService.findById(tenant, leadId);
  }

  @Post()
  @RequirePermission('leads.manage')
  async create(@Tenant() tenant: TenantContext, @ZodBody(CreateLeadSchema) body: CreateLeadInput) {
    return this.leadsService.create(tenant, body);
  }

  @Put(':leadId')
  @RequirePermission('leads.manage')
  async update(
    @Param('leadId', ParseUUIDPipe) leadId: string,
    @Tenant() tenant: TenantContext,
    @ZodBody(UpdateLeadSchema) body: UpdateLeadInput,
  ) {
    return this.leadsService.update(tenant, leadId, body);
  }

  @Post(':leadId/stage')
  @RequirePermission('leads.manage')
  async changeStage(
    @Param('leadId', ParseUUIDPipe) leadId: string,
    @Tenant() tenant: TenantContext,
    @ZodBody(ChangeLeadStageSchema) body: ChangeLeadStageInput,
  ) {
    return this.leadsService.changeStage(tenant, leadId, body);
  }

  @Put(':leadId/owner')
  @RequirePermission('leads.manage')
  async assignOwner(
    @Param('leadId', ParseUUIDPipe) leadId: string,
    @Tenant() tenant: TenantContext,
    @ZodBody(AssignLeadOwnerSchema) body: AssignLeadOwnerInput,
  ) {
    return this.leadsService.assignOwner(tenant, leadId, body);
  }

  @Post(':leadId/activities')
  @RequirePermission('leads.manage')
  async addActivity(
    @Param('leadId', ParseUUIDPipe) leadId: string,
    @Tenant() tenant: TenantContext,
    @ZodBody(AddLeadActivitySchema) body: AddLeadActivityInput,
  ) {
    return this.leadsService.addActivity(tenant, leadId, body);
  }

  @Post(':leadId/convert')
  @RequirePermission('leads.manage')
  async convert(
    @Param('leadId', ParseUUIDPipe) leadId: string,
    @Tenant() tenant: TenantContext,
    @ZodBody(ConvertLeadSchema) body: ConvertLeadInput,
  ) {
    return this.leadsService.convert(tenant, leadId, body);
  }

  @Post(':leadId/trial')
  @RequirePermission('leads.manage')
  async bookTrial(
    @Param('leadId', ParseUUIDPipe) leadId: string,
    @Tenant() tenant: TenantContext,
    @ZodBody(BookLeadTrialSchema) body: BookLeadTrialInput,
  ) {
    return this.leadsService.bookTrial(tenant, leadId, body);
  }
}
