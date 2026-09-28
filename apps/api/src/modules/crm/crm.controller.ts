import { Controller, Delete, Get, Header, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import {
  AddContactActivitySchema,
  AttributionReportQuerySchema,
  ContactExportQuerySchema,
  ContactFieldListQuerySchema,
  ContactListQuerySchema,
  ContactTagsSchema,
  ContactTaskListQuerySchema,
  CreateContactFieldSchema,
  CreateContactSchema,
  CreateContactTaskSchema,
  CreatePipelineStageSchema,
  MergeContactsSchema,
  UpdateContactFieldSchema,
  UpdateContactSchema,
  UpdateContactTaskSchema,
  UpdatePipelineStageSchema,
  UpdateContactConsentSchema,
} from '@platform/shared';
import type {
  AddContactActivityInput,
  AttributionReportQuery,
  ContactExportQuery,
  ContactFieldListQuery,
  ContactListQuery,
  ContactTagsInput,
  ContactTaskListQuery,
  CreateContactFieldInput,
  CreateContactInput,
  CreateContactTaskInput,
  CreatePipelineStageInput,
  MergeContactsInput,
  UpdateContactFieldInput,
  UpdateContactInput,
  UpdateContactTaskInput,
  UpdatePipelineStageInput,
  UpdateContactConsentInput,
  ContactDetailDTO,
} from '@platform/shared';
import { RequirePermission, StudioScoped } from '../auth/decorators/require-permission.decorator';
import { CurrentUser, Tenant } from '../auth/decorators/current-user.decorator';
import type { AuthUser, TenantContext } from '../auth/tenant-context';
import { ZodBody, ZodQuery } from '../../common/zod-body.pipe';
import { ContactsService } from './contacts/contacts.service';
import { PipelineService } from './pipeline/pipeline.service';
import { FieldsService } from './fields/fields.service';
import { TasksService } from './tasks/tasks.service';
import { AttributionService } from './attribution/attribution.service';
import { ContactConsentService } from '../notifications/consent/contact-consent.service';

/**
 * CRM (G1b): contacts, tags, custom fields, pipeline stages, tasks, CSV
 * export and the attribution report. Every route is studio scoped through
 * :studioId and declares crm.view, crm.manage or crm.export; services
 * always filter by tenant.studioId.
 */
@Controller('crm/studios/:studioId')
@StudioScoped()
export class CrmController {
  constructor(
    private readonly contacts: ContactsService,
    private readonly pipeline: PipelineService,
    private readonly fields: FieldsService,
    private readonly tasks: TasksService,
    private readonly attribution: AttributionService,
    private readonly consents: ContactConsentService,
  ) {}

  // -- contacts ---------------------------------------------------------------

  @Get('contacts')
  @RequirePermission('crm.view')
  list(@Tenant() tenant: TenantContext, @ZodQuery(ContactListQuerySchema) query: ContactListQuery) {
    return this.contacts.list(tenant, query);
  }

  @Get('contacts/export')
  @RequirePermission('crm.export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="contacts.csv"')
  @Header('Cache-Control', 'no-store')
  export(@Tenant() tenant: TenantContext, @ZodQuery(ContactExportQuerySchema) query: ContactExportQuery) {
    return this.contacts.exportCsv(tenant, query);
  }

  @Post('contacts/merge')
  @RequirePermission('crm.manage')
  merge(@Tenant() tenant: TenantContext, @CurrentUser() user: AuthUser, @ZodBody(MergeContactsSchema) body: MergeContactsInput) {
    return this.contacts.merge(tenant, user.id, body);
  }

  @Get('contacts/:contactId')
  @RequirePermission('crm.view')
  async detail(@Tenant() tenant: TenantContext, @Param('contactId', ParseUUIDPipe) contactId: string): Promise<ContactDetailDTO> {
    const detail = await this.contacts.detail(tenant, contactId);
    return { ...detail, consents: await this.consents.listForContact(tenant.studioId, contactId) };
  }

  /** Contact-level commercial consent (G2a): effective status per channel, merged with the member's own. */
  @Get('contacts/:contactId/consents')
  @RequirePermission('crm.view')
  async listConsents(@Tenant() tenant: TenantContext, @Param('contactId', ParseUUIDPipe) contactId: string) {
    await this.contacts.getOwn(tenant, contactId);
    return { items: await this.consents.listForContact(tenant.studioId, contactId) };
  }

  @Put('contacts/:contactId/consents')
  @RequirePermission('crm.manage')
  async setConsent(
    @Tenant() tenant: TenantContext,
    @Param('contactId', ParseUUIDPipe) contactId: string,
    @ZodBody(UpdateContactConsentSchema) body: UpdateContactConsentInput,
  ) {
    await this.contacts.getOwn(tenant, contactId);
    return { items: await this.consents.set(tenant.studioId, contactId, body, 'staff-entry') };
  }

  @Post('contacts')
  @RequirePermission('crm.manage')
  create(@Tenant() tenant: TenantContext, @ZodBody(CreateContactSchema) body: CreateContactInput) {
    return this.contacts.create(tenant, body);
  }

  @Patch('contacts/:contactId')
  @RequirePermission('crm.manage')
  update(
    @Tenant() tenant: TenantContext,
    @Param('contactId', ParseUUIDPipe) contactId: string,
    @ZodBody(UpdateContactSchema) body: UpdateContactInput,
  ) {
    return this.contacts.update(tenant, contactId, body);
  }

  @Post('contacts/:contactId/tags')
  @RequirePermission('crm.manage')
  tags(
    @Tenant() tenant: TenantContext,
    @Param('contactId', ParseUUIDPipe) contactId: string,
    @ZodBody(ContactTagsSchema) body: ContactTagsInput,
  ) {
    return this.contacts.updateTags(tenant, contactId, body);
  }

  @Post('contacts/:contactId/activities')
  @RequirePermission('crm.manage')
  addActivity(
    @Tenant() tenant: TenantContext,
    @Param('contactId', ParseUUIDPipe) contactId: string,
    @ZodBody(AddContactActivitySchema) body: AddContactActivityInput,
  ) {
    return this.contacts.addActivity(tenant, contactId, body);
  }

  @Post('contacts/:contactId/tasks')
  @RequirePermission('crm.manage')
  createTask(
    @Tenant() tenant: TenantContext,
    @Param('contactId', ParseUUIDPipe) contactId: string,
    @ZodBody(CreateContactTaskSchema) body: CreateContactTaskInput,
  ) {
    return this.tasks.create(tenant, contactId, body);
  }

  @Get('tags')
  @RequirePermission('crm.view')
  listTags(@Tenant() tenant: TenantContext) {
    return this.contacts.listTags(tenant);
  }

  // -- tasks ------------------------------------------------------------------

  @Get('tasks')
  @RequirePermission('crm.view')
  listTasks(@Tenant() tenant: TenantContext, @ZodQuery(ContactTaskListQuerySchema) query: ContactTaskListQuery) {
    return this.tasks.list(tenant, query);
  }

  @Patch('tasks/:taskId')
  @RequirePermission('crm.manage')
  updateTask(
    @Tenant() tenant: TenantContext,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @ZodBody(UpdateContactTaskSchema) body: UpdateContactTaskInput,
  ) {
    return this.tasks.update(tenant, taskId, body);
  }

  // -- pipeline stages --------------------------------------------------------

  @Get('pipeline-stages')
  @RequirePermission('crm.view')
  listStages(@Tenant() tenant: TenantContext) {
    return this.pipeline.list(tenant.studioId);
  }

  @Post('pipeline-stages')
  @RequirePermission('crm.manage')
  createStage(@Tenant() tenant: TenantContext, @ZodBody(CreatePipelineStageSchema) body: CreatePipelineStageInput) {
    return this.pipeline.create(tenant.studioId, body);
  }

  @Patch('pipeline-stages/:stageId')
  @RequirePermission('crm.manage')
  updateStage(
    @Tenant() tenant: TenantContext,
    @Param('stageId', ParseUUIDPipe) stageId: string,
    @ZodBody(UpdatePipelineStageSchema) body: UpdatePipelineStageInput,
  ) {
    return this.pipeline.update(tenant.studioId, stageId, body);
  }

  @Delete('pipeline-stages/:stageId')
  @RequirePermission('crm.manage')
  deleteStage(@Tenant() tenant: TenantContext, @Param('stageId', ParseUUIDPipe) stageId: string) {
    return this.pipeline.remove(tenant.studioId, stageId);
  }

  // -- custom fields ----------------------------------------------------------

  @Get('fields')
  @RequirePermission('crm.view')
  listFields(@Tenant() tenant: TenantContext, @ZodQuery(ContactFieldListQuerySchema) query: ContactFieldListQuery) {
    return this.fields.list(tenant.studioId, query.includeArchived);
  }

  @Post('fields')
  @RequirePermission('crm.manage')
  createField(@Tenant() tenant: TenantContext, @ZodBody(CreateContactFieldSchema) body: CreateContactFieldInput) {
    return this.fields.create(tenant.studioId, body);
  }

  @Patch('fields/:fieldId')
  @RequirePermission('crm.manage')
  updateField(
    @Tenant() tenant: TenantContext,
    @Param('fieldId', ParseUUIDPipe) fieldId: string,
    @ZodBody(UpdateContactFieldSchema) body: UpdateContactFieldInput,
  ) {
    return this.fields.update(tenant.studioId, fieldId, body);
  }

  @Delete('fields/:fieldId')
  @RequirePermission('crm.manage')
  deleteField(@Tenant() tenant: TenantContext, @Param('fieldId', ParseUUIDPipe) fieldId: string) {
    return this.fields.remove(tenant.studioId, fieldId);
  }

  // -- attribution report -----------------------------------------------------

  @Get('attribution')
  @RequirePermission('crm.view')
  attributionReport(@Tenant() tenant: TenantContext, @ZodQuery(AttributionReportQuerySchema) query: AttributionReportQuery) {
    return this.attribution.report(tenant.studioId, query);
  }
}
