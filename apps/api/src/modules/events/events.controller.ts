import { Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Res } from '@nestjs/common';
import type { Response } from 'express';
import {
  CancelEventSchema,
  CancelRegistrationSchema,
  CreateEventSchema,
  CreateTicketTypeSchema,
  EventExportQuerySchema,
  EventListQuerySchema,
  MemberPayRegistrationSchema,
  MemberRegisterSchema,
  RecordEventPaymentSchema,
  RegistrationListQuerySchema,
  ReplaceOccurrencesSchema,
  StaffRegisterSchema,
  UpdateEventSchema,
  UpdateTicketTypeSchema,
} from '@platform/shared';
import type {
  CancelEventInput,
  CancelRegistrationInput,
  CreateEventInput,
  CreateTicketTypeInput,
  EventExportQuery,
  EventListQuery,
  MemberPayRegistrationInput,
  MemberRegisterInput,
  RecordEventPaymentInput,
  RegistrationListQuery,
  ReplaceOccurrencesInput,
  StaffRegisterInput,
  UpdateEventInput,
  UpdateTicketTypeInput,
} from '@platform/shared';
import { RequirePermission, SelfService, StudioScoped } from '../auth/decorators/require-permission.decorator';
import { CurrentUser, Tenant } from '../auth/decorators/current-user.decorator';
import type { AuthUser, TenantContext } from '../auth/tenant-context';
import { ZodBody, ZodQuery } from '../../common/zod-body.pipe';
import { EventsService } from './events.service';
import { EventRegistrationsService } from './event-registrations.service';

/**
 * Member self-service (docs/ETKINLIKLER.md). Registered before the staff
 * controller so `self` is never taken for an event id. Every handler is
 * limited to the caller's own member profile.
 */
@Controller('studios/:studioId/events/self')
@StudioScoped()
export class EventsSelfController {
  constructor(private readonly registrations: EventRegistrationsService) {}

  @Get()
  @SelfService()
  async list(@Tenant() tenant: TenantContext) {
    return { items: await this.registrations.listForMember(tenant) };
  }

  @Get('registrations')
  @SelfService()
  async mine(@Tenant() tenant: TenantContext) {
    return { items: await this.registrations.myRegistrations(tenant) };
  }

  @Get(':eventId')
  @SelfService()
  get(@Tenant() tenant: TenantContext, @Param('eventId', ParseUUIDPipe) eventId: string) {
    return this.registrations.getForMember(tenant, eventId);
  }

  @Post(':eventId/register')
  @SelfService()
  register(@Tenant() tenant: TenantContext, @Param('eventId', ParseUUIDPipe) eventId: string, @ZodBody(MemberRegisterSchema) body: MemberRegisterInput) {
    return this.registrations.memberRegister(tenant, eventId, body);
  }

  @Post('registrations/:registrationId/cancel')
  @HttpCode(200)
  @SelfService()
  cancel(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @Param('registrationId', ParseUUIDPipe) registrationId: string,
    @ZodBody(CancelRegistrationSchema) body: CancelRegistrationInput,
  ) {
    return this.registrations.memberCancel(tenant, user.id, registrationId, body);
  }

  @Post('registrations/:registrationId/pay')
  @HttpCode(200)
  @SelfService()
  pay(@Tenant() tenant: TenantContext, @Param('registrationId', ParseUUIDPipe) registrationId: string, @ZodBody(MemberPayRegistrationSchema) body: MemberPayRegistrationInput) {
    return this.registrations.memberPay(tenant, registrationId, body.installmentCount);
  }
}

/**
 * Staff side of events (docs/ETKINLIKLER.md). The studio always comes from
 * the tenant guard; branch-restricted staff only reach their branches'
 * events.
 */
@Controller('studios/:studioId/events')
@StudioScoped()
export class EventsController {
  constructor(
    private readonly events: EventsService,
    private readonly registrations: EventRegistrationsService,
  ) {}

  @Get()
  @RequirePermission('events.view')
  async list(@Tenant() tenant: TenantContext, @ZodQuery(EventListQuerySchema) query: EventListQuery) {
    return { items: await this.events.list(tenant, query) };
  }

  @Post()
  @RequirePermission('events.manage')
  create(@Tenant() tenant: TenantContext, @ZodBody(CreateEventSchema) body: CreateEventInput) {
    return this.events.create(tenant, body);
  }

  // -- Registrations by id (before ':eventId' routes of the same shape) -------

  @Post('registrations/:registrationId/payment')
  @HttpCode(200)
  @RequirePermission('events.manage')
  recordPayment(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @Param('registrationId', ParseUUIDPipe) registrationId: string,
    @ZodBody(RecordEventPaymentSchema) body: RecordEventPaymentInput,
  ) {
    return this.registrations.recordPayment(tenant, user.id, registrationId, body);
  }

  @Post('registrations/:registrationId/cancel')
  @HttpCode(200)
  @RequirePermission('events.manage')
  cancelRegistration(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @Param('registrationId', ParseUUIDPipe) registrationId: string,
    @ZodBody(CancelRegistrationSchema) body: CancelRegistrationInput,
  ) {
    return this.registrations.staffCancel(tenant, user.id, registrationId, body);
  }

  @Post('registrations/:registrationId/check-in')
  @HttpCode(200)
  @RequirePermission('events.checkin')
  checkIn(@Tenant() tenant: TenantContext, @Param('registrationId', ParseUUIDPipe) registrationId: string) {
    return this.registrations.checkIn(tenant, registrationId);
  }

  @Post('registrations/:registrationId/no-show')
  @HttpCode(200)
  @RequirePermission('events.checkin')
  noShow(@Tenant() tenant: TenantContext, @Param('registrationId', ParseUUIDPipe) registrationId: string) {
    return this.registrations.markNoShow(tenant, registrationId);
  }

  // -- One event -----------------------------------------------------------------

  @Get(':eventId')
  @RequirePermission('events.view')
  get(@Tenant() tenant: TenantContext, @Param('eventId', ParseUUIDPipe) eventId: string) {
    return this.events.get(tenant, eventId);
  }

  @Patch(':eventId')
  @RequirePermission('events.manage')
  update(@Tenant() tenant: TenantContext, @Param('eventId', ParseUUIDPipe) eventId: string, @ZodBody(UpdateEventSchema) body: UpdateEventInput) {
    return this.events.update(tenant, eventId, body);
  }

  @Put(':eventId/occurrences')
  @RequirePermission('events.manage')
  replaceOccurrences(
    @Tenant() tenant: TenantContext,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @ZodBody(ReplaceOccurrencesSchema) body: ReplaceOccurrencesInput,
  ) {
    return this.events.replaceOccurrences(tenant, eventId, body);
  }

  @Post(':eventId/publish')
  @HttpCode(200)
  @RequirePermission('events.manage')
  publish(@Tenant() tenant: TenantContext, @CurrentUser() user: AuthUser, @Param('eventId', ParseUUIDPipe) eventId: string) {
    return this.events.publish(tenant, user.id, eventId);
  }

  @Post(':eventId/cancel')
  @HttpCode(200)
  @RequirePermission('events.manage')
  cancel(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @ZodBody(CancelEventSchema) body: CancelEventInput,
  ) {
    return this.events.cancel(tenant, user.id, eventId, body);
  }

  @Post(':eventId/tickets')
  @RequirePermission('events.manage')
  createTicket(@Tenant() tenant: TenantContext, @Param('eventId', ParseUUIDPipe) eventId: string, @ZodBody(CreateTicketTypeSchema) body: CreateTicketTypeInput) {
    return this.events.createTicket(tenant, eventId, body);
  }

  @Patch(':eventId/tickets/:ticketId')
  @RequirePermission('events.manage')
  updateTicket(
    @Tenant() tenant: TenantContext,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
    @ZodBody(UpdateTicketTypeSchema) body: UpdateTicketTypeInput,
  ) {
    return this.events.updateTicket(tenant, eventId, ticketId, body);
  }

  @Delete(':eventId/tickets/:ticketId')
  @RequirePermission('events.manage')
  async deleteTicket(@Tenant() tenant: TenantContext, @Param('eventId', ParseUUIDPipe) eventId: string, @Param('ticketId', ParseUUIDPipe) ticketId: string) {
    await this.events.deleteTicket(tenant, eventId, ticketId);
    return { deleted: true };
  }

  @Get(':eventId/registrations')
  @RequirePermission('events.view')
  async listRegistrations(
    @Tenant() tenant: TenantContext,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @ZodQuery(RegistrationListQuerySchema) query: RegistrationListQuery,
  ) {
    return { items: await this.registrations.listRegistrations(tenant, eventId, query) };
  }

  @Post(':eventId/registrations')
  @RequirePermission('events.manage')
  register(@Tenant() tenant: TenantContext, @Param('eventId', ParseUUIDPipe) eventId: string, @ZodBody(StaffRegisterSchema) body: StaffRegisterInput) {
    return this.registrations.staffRegister(tenant, eventId, body);
  }

  @Get(':eventId/registrations/export.csv')
  @RequirePermission('events.view')
  async exportCsv(
    @Tenant() tenant: TenantContext,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @ZodQuery(EventExportQuerySchema) query: EventExportQuery,
    @Res() res: Response,
  ) {
    const { filename, csv } = await this.registrations.exportCsv(tenant, eventId, query);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  }
}
