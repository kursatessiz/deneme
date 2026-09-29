import { Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { CreateJourneyFromTemplateSchema, CreateJourneySchema, JourneyEnrollmentsQuerySchema, UpdateJourneySchema } from '@platform/shared';
import type { CreateJourneyFromTemplateInput, CreateJourneyInput, JourneyEnrollmentsQuery, UpdateJourneyInput } from '@platform/shared';
import { RequirePermission, StudioScoped } from '../../auth/decorators/require-permission.decorator';
import { Tenant } from '../../auth/decorators/current-user.decorator';
import type { TenantContext } from '../../auth/tenant-context';
import { ZodBody, ZodQuery } from '../../../common/zod-body.pipe';
import { JourneysService } from './journeys.service';

/** Journeys (G2a), replacing /automation-rules. Studio from the tenant guard only. */
@Controller('studios/:studioId/journeys')
@StudioScoped()
export class JourneysController {
  constructor(private readonly journeys: JourneysService) {}

  @Get()
  @RequirePermission('journeys.view')
  async list(@Tenant() tenant: TenantContext) {
    return { items: await this.journeys.list(tenant.studioId) };
  }

  @Get('templates')
  @RequirePermission('journeys.view')
  templates() {
    return { items: this.journeys.templates() };
  }

  @Post()
  @RequirePermission('journeys.manage')
  create(@Tenant() tenant: TenantContext, @ZodBody(CreateJourneySchema) body: CreateJourneyInput) {
    return this.journeys.create(tenant, body);
  }

  @Post('from-template')
  @RequirePermission('journeys.manage')
  fromTemplate(@Tenant() tenant: TenantContext, @ZodBody(CreateJourneyFromTemplateSchema) body: CreateJourneyFromTemplateInput) {
    return this.journeys.createFromTemplate(tenant, body);
  }

  @Get(':journeyId')
  @RequirePermission('journeys.view')
  detail(@Tenant() tenant: TenantContext, @Param('journeyId', ParseUUIDPipe) journeyId: string) {
    return this.journeys.detail(tenant.studioId, journeyId);
  }

  @Patch(':journeyId')
  @RequirePermission('journeys.manage')
  update(
    @Tenant() tenant: TenantContext,
    @Param('journeyId', ParseUUIDPipe) journeyId: string,
    @ZodBody(UpdateJourneySchema) body: UpdateJourneyInput,
  ) {
    return this.journeys.update(tenant.studioId, journeyId, body);
  }

  @Delete(':journeyId')
  @RequirePermission('journeys.manage')
  remove(@Tenant() tenant: TenantContext, @Param('journeyId', ParseUUIDPipe) journeyId: string) {
    return this.journeys.remove(tenant.studioId, journeyId);
  }

  @Post(':journeyId/activate')
  @RequirePermission('journeys.manage')
  activate(@Tenant() tenant: TenantContext, @Param('journeyId', ParseUUIDPipe) journeyId: string) {
    return this.journeys.activate(tenant.studioId, journeyId);
  }

  @Post(':journeyId/pause')
  @RequirePermission('journeys.manage')
  pause(@Tenant() tenant: TenantContext, @Param('journeyId', ParseUUIDPipe) journeyId: string) {
    return this.journeys.pause(tenant.studioId, journeyId);
  }

  @Post(':journeyId/archive')
  @RequirePermission('journeys.manage')
  archive(@Tenant() tenant: TenantContext, @Param('journeyId', ParseUUIDPipe) journeyId: string) {
    return this.journeys.archive(tenant.studioId, journeyId);
  }

  @Get(':journeyId/enrollments')
  @RequirePermission('journeys.view')
  enrollments(
    @Tenant() tenant: TenantContext,
    @Param('journeyId', ParseUUIDPipe) journeyId: string,
    @ZodQuery(JourneyEnrollmentsQuerySchema) query: JourneyEnrollmentsQuery,
  ) {
    return this.journeys.enrollments(tenant.studioId, journeyId, query);
  }
}
