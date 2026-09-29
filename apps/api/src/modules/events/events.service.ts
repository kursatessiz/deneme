import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@platform/database';
import type { Event } from '@platform/database';
import { EVENT_CANCELLABLE_STATUSES, EVENT_TEMPLATE_KEYS, occurrenceSpan } from '@platform/shared';
import type {
  CancelEventInput,
  CreateEventInput,
  CreateTicketTypeInput,
  EventCancelResultDTO,
  EventDTO,
  EventListQuery,
  EventOccurrenceInput,
  EventTicketTypeDTO,
  ReplaceOccurrencesInput,
  UpdateEventInput,
  UpdateTicketTypeInput,
} from '@platform/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentsService } from '../payments/payments.service';
import type { TenantContext } from '../auth/tenant-context';
import { assertBranchAccess, branchScope } from '../branches/branch-access';
import { EventSeatsService } from './event-seats.service';
import { eventError } from './events.errors';
import { EVENT_INCLUDE, EventWithDetails, toEventDTO, toTicketDTO } from './events.mapper';

type Tx = Prisma.TransactionClient;

const EDITABLE: ReadonlySet<string> = new Set(['DRAFT', 'PUBLISHED']);
const date = (v: string | null | undefined): Date | null | undefined => (v === undefined ? undefined : v === null ? null : new Date(v));

/**
 * Staff side of events (docs/ETKINLIKLER.md): events, occurrences, ticket
 * types, publishing and cancelling. Every query is scoped by the tenant's
 * studio, and branch-restricted staff only act on their branches' events.
 */
@Injectable()
export class EventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly seats: EventSeatsService,
    private readonly payments: PaymentsService,
  ) {}

  // -------------------------------------------------------------------------
  // Reading
  // -------------------------------------------------------------------------

  async waitlistCounts(studioId: string, eventIds: string[]): Promise<Map<string, number>> {
    if (eventIds.length === 0) return new Map();
    const rows = await this.prisma.eventRegistration.groupBy({
      by: ['eventId'],
      where: { studioId, eventId: { in: eventIds }, status: 'WAITLIST' },
      _count: { _all: true },
    });
    return new Map(rows.map((r) => [r.eventId, r._count._all]));
  }

  async list(tenant: TenantContext, query: EventListQuery): Promise<EventDTO[]> {
    const events = await this.prisma.event.findMany({
      where: {
        studioId: tenant.studioId,
        ...branchScope(tenant),
        ...(query.status ? { status: query.status } : {}),
        ...(query.from ? { OR: [{ endsAt: { gte: new Date(query.from) } }, { endsAt: null }] } : {}),
        ...(query.to ? { startsAt: { lte: new Date(query.to) } } : {}),
      },
      include: EVENT_INCLUDE,
      orderBy: [{ startsAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }],
      take: 500,
    });
    const counts = await this.waitlistCounts(tenant.studioId, events.map((e) => e.id));
    return events.map((e) => toEventDTO(e, counts.get(e.id) ?? 0));
  }

  /** The event if it belongs to the tenant's studio and branches; 404 otherwise. */
  async findOwn(tenant: TenantContext, eventId: string): Promise<EventWithDetails> {
    const event = await this.prisma.event.findFirst({ where: { id: eventId, studioId: tenant.studioId }, include: EVENT_INCLUDE });
    if (!event) throw eventError('EVENT_NOT_FOUND');
    assertBranchAccess(tenant, event.branchId);
    return event;
  }

  async get(tenant: TenantContext, eventId: string): Promise<EventDTO> {
    const event = await this.findOwn(tenant, eventId);
    const counts = await this.waitlistCounts(tenant.studioId, [event.id]);
    return toEventDTO(event, counts.get(event.id) ?? 0);
  }

  // -------------------------------------------------------------------------
  // Writing
  // -------------------------------------------------------------------------

  private async resolveBranch(tenant: TenantContext, branchId: string | null | undefined): Promise<string | null> {
    if (branchId) {
      const branch = await this.prisma.branch.findFirst({ where: { id: branchId, studioId: tenant.studioId, isActive: true } });
      if (!branch) throw new BadRequestException({ statusCode: 400, message: 'Branch not found in this studio' });
    } else if (tenant.branchIds !== null) {
      // Branch-restricted staff create events in one of their branches.
      throw new BadRequestException({ statusCode: 400, message: 'Branch is required' });
    }
    assertBranchAccess(tenant, branchId ?? null);
    return branchId ?? null;
  }

  /**
   * Validates occurrences: resources and trainers belong to the studio, and
   * neither is already busy in a session or another live event at the time.
   */
  private async validateOccurrences(studioId: string, occurrences: readonly EventOccurrenceInput[], excludeEventId?: string): Promise<void> {
    for (const o of occurrences) {
      const start = new Date(o.startsAt);
      const end = new Date(o.endsAt);
      if (o.resourceId) {
        const resource = await this.prisma.resource.findFirst({ where: { id: o.resourceId, studioId, isMaintenance: false } });
        if (!resource) throw new BadRequestException({ statusCode: 400, message: 'Resource not found or under maintenance' });
      }
      if (o.trainerId) {
        const trainer = await this.prisma.trainerProfile.findFirst({ where: { id: o.trainerId, studioId } });
        if (!trainer) throw new NotFoundException({ statusCode: 404, message: 'Trainer not found' });
      }
      const overlap = { startTime: { lt: end }, endTime: { gt: start } };
      const busyClauses = [
        ...(o.trainerId ? [{ trainerId: o.trainerId }] : []),
        ...(o.resourceId ? [{ resourceId: o.resourceId }] : []),
      ];
      if (busyClauses.length === 0) continue;
      const session = await this.prisma.sessionSchedule.findFirst({ where: { studioId, isCancelled: false, ...overlap, OR: busyClauses } });
      const otherEvent = await this.prisma.eventOccurrence.findFirst({
        where: {
          studioId,
          startsAt: { lt: end },
          endsAt: { gt: start },
          OR: busyClauses,
          event: { status: { in: ['DRAFT', 'PUBLISHED'] }, ...(excludeEventId ? { id: { not: excludeEventId } } : {}) },
        },
      });
      if (session || otherEvent) throw eventError('EVENT_OCCURRENCE_CONFLICT');
    }
  }

  private occurrenceRows(studioId: string, eventId: string, occurrences: readonly EventOccurrenceInput[]) {
    return occurrences.map((o) => ({
      studioId,
      eventId,
      startsAt: new Date(o.startsAt),
      endsAt: new Date(o.endsAt),
      resourceId: o.resourceId ?? null,
      trainerId: o.trainerId ?? null,
    }));
  }

  async create(tenant: TenantContext, dto: CreateEventInput): Promise<EventDTO> {
    const studioId = tenant.studioId;
    const branchId = await this.resolveBranch(tenant, dto.branchId);
    await this.validateOccurrences(studioId, dto.occurrences);
    const span = occurrenceSpan(dto.occurrences.map((o) => ({ startsAt: new Date(o.startsAt), endsAt: new Date(o.endsAt) })));
    const created = await this.prisma.$transaction(async (tx) => {
      const event = await tx.event.create({
        data: {
          studioId,
          branchId,
          title: dto.title,
          description: dto.description ?? null,
          kind: dto.kind,
          capacity: dto.capacity,
          waitlistEnabled: dto.waitlistEnabled,
          visibility: dto.visibility,
          coverImageUrl: dto.coverImageUrl ?? null,
          registrationOpensAt: date(dto.registrationOpensAt) ?? null,
          registrationClosesAt: date(dto.registrationClosesAt) ?? null,
          fullRefundHoursBefore: dto.fullRefundHoursBefore,
          startsAt: span.startsAt,
          endsAt: span.endsAt,
          createdByMembershipId: tenant.membershipId,
        },
      });
      if (dto.occurrences.length > 0) await tx.eventOccurrence.createMany({ data: this.occurrenceRows(studioId, event.id, dto.occurrences) });
      return event;
    });
    return this.get(tenant, created.id);
  }

  private assertEditable(event: Pick<Event, 'status'>): void {
    if (!EDITABLE.has(event.status)) throw eventError('EVENT_NOT_EDITABLE');
  }

  async update(tenant: TenantContext, eventId: string, dto: UpdateEventInput): Promise<EventDTO> {
    const event = await this.findOwn(tenant, eventId);
    this.assertEditable(event);
    const branchId = dto.branchId !== undefined ? await this.resolveBranch(tenant, dto.branchId) : undefined;
    const data: Prisma.EventUpdateManyMutationInput & { branchId?: string | null } = {
      ...(dto.title !== undefined ? { title: dto.title } : {}),
      ...(dto.description !== undefined ? { description: dto.description } : {}),
      ...(branchId !== undefined ? { branchId } : {}),
      ...(dto.capacity !== undefined ? { capacity: dto.capacity } : {}),
      ...(dto.waitlistEnabled !== undefined ? { waitlistEnabled: dto.waitlistEnabled } : {}),
      ...(dto.visibility !== undefined ? { visibility: dto.visibility } : {}),
      ...(dto.coverImageUrl !== undefined ? { coverImageUrl: dto.coverImageUrl } : {}),
      ...(dto.registrationOpensAt !== undefined ? { registrationOpensAt: date(dto.registrationOpensAt) } : {}),
      ...(dto.registrationClosesAt !== undefined ? { registrationClosesAt: date(dto.registrationClosesAt) } : {}),
      ...(dto.fullRefundHoursBefore !== undefined ? { fullRefundHoursBefore: dto.fullRefundHoursBefore } : {}),
    };
    // Conditional on the seats already taken, so a concurrent registration cannot be squeezed out.
    const updated = await this.prisma.event.updateMany({
      where: {
        id: event.id,
        studioId: tenant.studioId,
        status: { in: [...EDITABLE] },
        ...(dto.capacity !== undefined ? { seatsTaken: { lte: dto.capacity } } : {}),
      },
      data,
    });
    if (updated.count === 0) {
      const current = await this.prisma.event.findUniqueOrThrow({ where: { id: event.id } });
      if (!EDITABLE.has(current.status)) throw eventError('EVENT_NOT_EDITABLE');
      throw eventError('EVENT_CAPACITY_BELOW_TAKEN');
    }
    // A larger event or a newly enabled waitlist may seat people who are waiting.
    if ((dto.capacity !== undefined && dto.capacity > event.capacity) || dto.waitlistEnabled) {
      await this.seats.promoteWaitlistSafe(tenant.studioId, event.id);
    }
    return this.get(tenant, event.id);
  }

  async replaceOccurrences(tenant: TenantContext, eventId: string, dto: ReplaceOccurrencesInput): Promise<EventDTO> {
    const event = await this.findOwn(tenant, eventId);
    this.assertEditable(event);
    if (event.kind === 'SINGLE' && dto.occurrences.length !== 1) throw eventError('EVENT_SINGLE_OCCURRENCE');
    await this.validateOccurrences(tenant.studioId, dto.occurrences, event.id);
    const span = occurrenceSpan(dto.occurrences.map((o) => ({ startsAt: new Date(o.startsAt), endsAt: new Date(o.endsAt) })));
    await this.prisma.$transaction(async (tx) => {
      await tx.eventOccurrence.deleteMany({ where: { studioId: tenant.studioId, eventId: event.id } });
      await tx.eventOccurrence.createMany({ data: this.occurrenceRows(tenant.studioId, event.id, dto.occurrences) });
      await tx.event.update({ where: { id: event.id }, data: { startsAt: span.startsAt, endsAt: span.endsAt } });
    });
    return this.get(tenant, event.id);
  }

  async publish(tenant: TenantContext, actorUserId: string, eventId: string): Promise<EventDTO> {
    const event = await this.findOwn(tenant, eventId);
    if (event.status === 'PUBLISHED') return this.get(tenant, event.id);
    if (event.status !== 'DRAFT') throw eventError('EVENT_NOT_EDITABLE');
    if (event.occurrences.length === 0 || !event.ticketTypes.some((t) => t.isActive)) throw eventError('EVENT_PUBLISH_INCOMPLETE');
    const now = new Date();
    const moved = await this.prisma.event.updateMany({
      where: { id: event.id, studioId: tenant.studioId, status: 'DRAFT' },
      data: { status: 'PUBLISHED', publishedAt: now },
    });
    if (moved.count === 1) {
      await this.prisma.auditLog.create({
        data: { studioId: tenant.studioId, userId: actorUserId, action: 'events.publish', entityType: 'Event', entityId: event.id },
      });
    }
    return this.get(tenant, event.id);
  }

  /**
   * The business cancels the whole event: the status flips first inside the
   * transaction (serialising against registrations, which need PUBLISHED),
   * every live registration is cancelled with its package units returned,
   * then completed payments are refunded in full through the payments
   * module and the registrants are told (EVENT_CANCELLED, transactional).
   */
  async cancel(tenant: TenantContext, actorUserId: string, eventId: string, dto: CancelEventInput): Promise<EventCancelResultDTO> {
    const studioId = tenant.studioId;
    const event = await this.findOwn(tenant, eventId);
    const now = new Date();
    const affected = await this.prisma.$transaction(async (tx) => {
      const flipped = await tx.event.updateMany({
        where: { id: event.id, studioId, status: { in: [...EDITABLE] } },
        data: { status: 'CANCELLED', cancelledAt: now, cancellationReason: dto.reason ?? null, seatsTaken: 0 },
      });
      if (flipped.count === 0) throw eventError('EVENT_NOT_EDITABLE');
      const registrations = await tx.eventRegistration.findMany({
        where: { studioId, eventId: event.id, status: { in: [...EVENT_CANCELLABLE_STATUSES] } },
      });
      for (const r of registrations) {
        await tx.eventRegistration.update({
          where: { id: r.id },
          data: {
            status: 'CANCELLED',
            dedupeKey: null,
            waitlistPosition: null,
            cancelledAt: now,
            cancellationReason: 'EVENT_CANCELLED',
            paymentDueAt: null,
            paymentLink: null,
            refundedUnits: r.unitsCharged,
          },
        });
        await this.seats.refundCredits(tx, studioId, r.memberPackageId, r.unitsCharged);
      }
      await tx.eventTicketType.updateMany({ where: { studioId, eventId: event.id }, data: { soldCount: 0 } });
      await tx.auditLog.create({
        data: {
          studioId,
          userId: actorUserId,
          action: 'events.cancel',
          entityType: 'Event',
          entityId: event.id,
          metadata: { reason: dto.reason ?? null, cancelledRegistrations: registrations.length },
        },
      });
      return registrations;
    });

    let refundedPayments = 0;
    let refundFailures = 0;
    for (const r of affected) {
      const outcome = await this.refundInFull(tenant, actorUserId, r, dto.reason ?? null);
      if (outcome === 'REFUNDED') refundedPayments++;
      if (outcome === 'FAILED') refundFailures++;
    }

    let notified = 0;
    if (dto.notify) {
      for (const r of affected) {
        if (await this.seats.notify(r.id, EVENT_TEMPLATE_KEYS.cancelled, `event-cancelled:${r.id}`)) notified++;
      }
    }
    return { eventId: event.id, cancelledRegistrations: affected.length, refundedPayments, refundFailures, notified };
  }

  /**
   * Refunds what a registration paid, in full: a Payment row through the
   * payments module's refund (provider refund, invoice cancel, audit), a
   * guest's pay-at-desk amount as a recorded refund to hand back at the desk.
   */
  async refundInFull(
    tenant: TenantContext,
    actorUserId: string,
    r: { id: string; paymentId: string | null; amountPaid: Prisma.Decimal; refundedAmount: Prisma.Decimal },
    reason: string | null,
  ): Promise<'REFUNDED' | 'NONE' | 'FAILED'> {
    if (r.paymentId) {
      const payment = await this.prisma.payment.findFirst({ where: { id: r.paymentId, studioId: tenant.studioId } });
      if (!payment || payment.paymentStatus !== 'COMPLETED') return 'NONE';
      const remaining = new Prisma.Decimal(payment.amount).minus(payment.refundedAmount);
      if (remaining.lte(0)) return 'NONE';
      try {
        const refunded = await this.payments.refundPayment(tenant, actorUserId, payment.id, {
          reason: reason && reason.trim().length >= 3 ? reason.trim() : `event registration ${r.id}`,
        });
        await this.prisma.eventRegistration.update({ where: { id: r.id }, data: { refundedAmount: refunded.refundedAmount } });
        return 'REFUNDED';
      } catch {
        return 'FAILED';
      }
    }
    const paid = new Prisma.Decimal(r.amountPaid);
    if (paid.lte(new Prisma.Decimal(r.refundedAmount))) return 'NONE';
    await this.prisma.eventRegistration.update({ where: { id: r.id }, data: { refundedAmount: paid } });
    return 'REFUNDED';
  }

  // -------------------------------------------------------------------------
  // Ticket types
  // -------------------------------------------------------------------------

  private async assertTicketInput(
    tx: Tx | PrismaService,
    studioId: string,
    dto: { currency?: string; creditServiceTypeId?: string | null },
  ): Promise<void> {
    if (dto.currency !== undefined) {
      const studio = await tx.studio.findUniqueOrThrow({ where: { id: studioId }, select: { currency: true } });
      // Rule 8 and the payments ledger: every amount is in the studio currency.
      if (dto.currency !== studio.currency) throw eventError('EVENT_CURRENCY_MISMATCH');
    }
    if (dto.creditServiceTypeId) {
      const serviceType = await tx.serviceType.findFirst({ where: { id: dto.creditServiceTypeId, studioId } });
      if (!serviceType) throw new BadRequestException({ statusCode: 400, message: 'Service type not found in this studio' });
    }
  }

  async createTicket(tenant: TenantContext, eventId: string, dto: CreateTicketTypeInput): Promise<EventTicketTypeDTO> {
    const event = await this.findOwn(tenant, eventId);
    this.assertEditable(event);
    await this.assertTicketInput(this.prisma, tenant.studioId, dto);
    const ticket = await this.prisma.eventTicketType.create({
      data: {
        studioId: tenant.studioId,
        eventId: event.id,
        name: dto.name,
        description: dto.description ?? null,
        priceAmount: new Prisma.Decimal(dto.priceAmount).toDecimalPlaces(2),
        currency: dto.currency,
        quantityLimit: dto.quantityLimit ?? null,
        salesStartAt: date(dto.salesStartAt) ?? null,
        salesEndAt: date(dto.salesEndAt) ?? null,
        membersOnly: dto.membersOnly,
        allowMultiple: dto.allowMultiple,
        creditServiceTypeId: dto.creditServiceTypeId ?? null,
        creditUnits: dto.creditUnits ?? null,
        isActive: dto.isActive,
        sortOrder: dto.sortOrder,
      },
    });
    return toTicketDTO(ticket, new Date());
  }

  async updateTicket(tenant: TenantContext, eventId: string, ticketId: string, dto: UpdateTicketTypeInput): Promise<EventTicketTypeDTO> {
    const event = await this.findOwn(tenant, eventId);
    this.assertEditable(event);
    const ticket = event.ticketTypes.find((t) => t.id === ticketId);
    if (!ticket) throw eventError('EVENT_TICKET_UNAVAILABLE');
    await this.assertTicketInput(this.prisma, tenant.studioId, dto);
    const creditServiceTypeId = dto.creditServiceTypeId !== undefined ? dto.creditServiceTypeId : ticket.creditServiceTypeId;
    const creditUnits = dto.creditUnits !== undefined ? dto.creditUnits : ticket.creditUnits;
    if ((creditServiceTypeId == null) !== (creditUnits == null)) throw eventError('EVENT_CREDITS_NOT_ACCEPTED');
    const updated = await this.prisma.eventTicketType.updateMany({
      where: {
        id: ticket.id,
        studioId: tenant.studioId,
        // The limit never drops below what is already sold (the CHECK constraint backs this up).
        ...(dto.quantityLimit != null ? { soldCount: { lte: dto.quantityLimit } } : {}),
      },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.priceAmount !== undefined ? { priceAmount: new Prisma.Decimal(dto.priceAmount).toDecimalPlaces(2) } : {}),
        ...(dto.currency !== undefined ? { currency: dto.currency } : {}),
        ...(dto.quantityLimit !== undefined ? { quantityLimit: dto.quantityLimit } : {}),
        ...(dto.salesStartAt !== undefined ? { salesStartAt: date(dto.salesStartAt) } : {}),
        ...(dto.salesEndAt !== undefined ? { salesEndAt: date(dto.salesEndAt) } : {}),
        ...(dto.membersOnly !== undefined ? { membersOnly: dto.membersOnly } : {}),
        ...(dto.allowMultiple !== undefined ? { allowMultiple: dto.allowMultiple } : {}),
        creditServiceTypeId,
        creditUnits,
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
      },
    });
    if (updated.count === 0) throw eventError('EVENT_CAPACITY_BELOW_TAKEN');
    return toTicketDTO(await this.prisma.eventTicketType.findUniqueOrThrow({ where: { id: ticket.id } }), new Date());
  }

  /** A ticket type nobody registered with is deleted; one with registrations is refused (deactivate it instead). */
  async deleteTicket(tenant: TenantContext, eventId: string, ticketId: string): Promise<void> {
    const event = await this.findOwn(tenant, eventId);
    const ticket = event.ticketTypes.find((t) => t.id === ticketId);
    if (!ticket) throw eventError('EVENT_TICKET_UNAVAILABLE');
    const used = await this.prisma.eventRegistration.count({ where: { studioId: tenant.studioId, ticketTypeId: ticket.id } });
    if (used > 0) throw eventError('EVENT_TICKET_IN_USE');
    await this.prisma.eventTicketType.deleteMany({ where: { id: ticket.id, studioId: tenant.studioId } });
  }
}
