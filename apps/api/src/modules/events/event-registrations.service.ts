import { ForbiddenException, Injectable, Logger, Optional } from '@nestjs/common';
import { PaymentMethod, PaymentProvider, PaymentStatus, Prisma } from '@platform/database';
import type { Event, EventRegistration, EventTicketType } from '@platform/database';
import {
  BASE_MESSAGES,
  BUNDLED_MESSAGES,
  EVENT_CANCELLABLE_STATUSES,
  EVENT_DESK_HOLD_HOURS,
  EVENT_ONLINE_HOLD_MINUTES,
  EVENT_TEMPLATE_KEYS,
  createTranslator,
  evaluateEventRefund,
  paymentDueAt,
  registrationBlock,
  registrationDedupeKey,
  ticketOnSale,
} from '@platform/shared';
import type {
  CancelRegistrationInput,
  EventDTO,
  EventDeskPaymentMethod,
  EventExportQuery,
  EventRegisterResultDTO,
  EventRegistrationDTO,
  EventRegistrationSource,
  EventStatus,
  MemberRegisterInput,
  MyEventRegistrationDTO,
  PublicEventDTO,
  PublicEventRegisterInput,
  RecordEventPaymentInput,
  RegistrationCancelResultDTO,
  RegistrationListQuery,
  StaffRegisterInput,
} from '@platform/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentsService } from '../payments/payments.service';
import { PaymentProviderRegistry } from '../payments/providers/payment-provider.registry';
import { ContactsService } from '../crm/contacts/contacts.service';
import { AttributionService } from '../crm/attribution/attribution.service';
import { ConversionService } from '../crm/conversions/conversion.service';
import { LoyaltyEarnService } from '../loyalty/loyalty-earn.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import type { TenantContext } from '../auth/tenant-context';
import { assertBranchAccess } from '../branches/branch-access';
import { toCsv } from '../../common/csv';
import { EventSeatsService } from './event-seats.service';
import { EventsService } from './events.service';
import { eventError } from './events.errors';
import { EVENT_INCLUDE, REGISTRATION_INCLUDE, RegistrationWithPerson, toEventDTO, toPublicEventDTO, toRegistrationDTO } from './events.mapper';

const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

type Person = { memberId: string } | { contactId: string };
type PayPlan = { kind: 'DESK'; method: EventDeskPaymentMethod } | { kind: 'ONLINE'; installmentCount: number } | { kind: 'LATER' };

interface RegisterInput {
  studioId: string;
  event: Event;
  ticket: EventTicketType;
  person: Person;
  source: EventRegistrationSource;
  pay: PayPlan;
  memberPackageId?: string;
  /** Pay with package units even without a chosen package (the one ending first is used). */
  useCredits?: boolean;
  notes?: string | null;
  actorMembershipId?: string | null;
  /** Members and guests are bound by the registration and sales windows; staff are not. */
  enforceWindow: boolean;
}

class DuplicateRegistration extends Error {}

/** Provider name to the Payment.paymentMethod an online checkout is stored with (same mapping as package checkout). */
function onlineMethod(provider: PaymentProvider): PaymentMethod {
  if (provider === PaymentProvider.PAYTR) return PaymentMethod.ONLINE_PAYTR;
  if (provider === PaymentProvider.STRIPE) return PaymentMethod.ONLINE_STRIPE;
  return PaymentMethod.ONLINE_IYZICO;
}

/**
 * Registrations (docs/ETKINLIKLER.md): staff, member self-service and
 * public guest registration, payment (desk, online checkout through the
 * payment provider adapter, or package units), cancellation with the
 * per-event refund policy, check-in and CSV export.
 */
@Injectable()
export class EventRegistrationsService {
  private readonly logger = new Logger(EventRegistrationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    private readonly seats: EventSeatsService,
    private readonly payments: PaymentsService,
    private readonly providers: PaymentProviderRegistry,
    private readonly contacts: ContactsService,
    private readonly attribution: AttributionService,
    private readonly conversions: ConversionService,
    private readonly loyalty: LoyaltyEarnService,
    @Optional() private readonly webhooks?: WebhooksService,
  ) {}

  // -------------------------------------------------------------------------
  // Core registration
  // -------------------------------------------------------------------------

  private async dto(registrationId: string, canViewContact: boolean): Promise<EventRegistrationDTO> {
    const row = await this.prisma.eventRegistration.findUniqueOrThrow({ where: { id: registrationId }, include: REGISTRATION_INCLUDE });
    return toRegistrationDTO(row, canViewContact);
  }

  /**
   * One registration, atomically: a seat (conditional update on the event
   * row) and a ticket (conditional update on the ticket row) or a waitlist
   * place, package units or a desk payment, and the registration row whose
   * unique (event, dedupeKey) makes a repeated call return the first
   * registration instead of a second one.
   */
  private async register(input: RegisterInput): Promise<{ registrationId: string; duplicate: boolean }> {
    const { studioId, event, ticket, person } = input;
    const now = new Date();
    if (event.status !== 'PUBLISHED') throw eventError('EVENT_NOT_PUBLISHED');
    if (ticket.eventId !== event.id || !ticket.isActive) throw eventError('EVENT_TICKET_UNAVAILABLE');
    if (input.enforceWindow) {
      const block = registrationBlock({
        status: event.status as EventStatus,
        opensAt: event.registrationOpensAt,
        closesAt: event.registrationClosesAt,
        endsAt: event.endsAt,
        now,
      });
      if (block) throw eventError(block);
      if (!ticketOnSale({ ...ticket, quantityLimit: null }, now)) throw eventError('EVENT_TICKET_UNAVAILABLE');
    }
    const memberId = 'memberId' in person ? person.memberId : null;
    const contactId = 'contactId' in person ? person.contactId : null;
    if (ticket.membersOnly && !memberId) throw eventError('EVENT_MEMBERS_ONLY');

    const dedupeKey = registrationDedupeKey({ allowMultiple: ticket.allowMultiple, memberId, contactId });
    if (dedupeKey) {
      const existing = await this.prisma.eventRegistration.findFirst({ where: { studioId, eventId: event.id, dedupeKey } });
      if (existing) return { registrationId: existing.id, duplicate: true };
    }

    const price = new Prisma.Decimal(ticket.priceAmount);
    const useCredits = Boolean(input.memberPackageId) || input.useCredits === true;
    let creditPackageId: string | null = null;
    if (useCredits) {
      if (!memberId) throw eventError('EVENT_CREDITS_NOT_ACCEPTED');
      if (!ticket.creditServiceTypeId || !ticket.creditUnits) throw eventError('EVENT_CREDITS_NOT_ACCEPTED');
      const resolved = await this.seats.resolveCreditPackage(this.prisma, studioId, memberId, ticket, input.memberPackageId);
      if (!resolved) throw eventError('EVENT_NO_CREDITS');
      creditPackageId = resolved.memberPackage.id;
    }

    let paymentId: string | null = null;
    let created: EventRegistration;
    try {
      created = await this.prisma.$transaction(async (tx) => {
        let seat = await this.seats.claimSeat(tx, studioId, event.id);
        if (!seat && event.waitlistEnabled) {
          // Row lock on the event, then one more try: a seat freed meanwhile is taken instead of
          // queueing, and concurrent waitlist joins get distinct, ordered positions.
          const locked = await tx.$queryRaw<{ status: string }[]>`
            SELECT "status" FROM "events" WHERE "id" = ${event.id}::uuid AND "studio_id" = ${studioId}::uuid FOR UPDATE`;
          if (locked[0]?.status !== 'PUBLISHED') throw eventError('EVENT_NOT_PUBLISHED');
          seat = await this.seats.claimSeat(tx, studioId, event.id);
        }
        let status: 'CONFIRMED' | 'PENDING_PAYMENT' | 'WAITLIST';
        let waitlistPosition: number | null = null;
        let unitsCharged = 0;
        let memberPackageId: string | null = creditPackageId;
        let amountPaid = new Prisma.Decimal(0);
        let paymentMethod: string | null = null;
        let dueAt: Date | null = null;

        if (!seat) {
          if (!event.waitlistEnabled) throw eventError('EVENT_FULL');
          const last = await tx.eventRegistration.aggregate({ where: { studioId, eventId: event.id }, _max: { waitlistPosition: true } });
          status = 'WAITLIST';
          waitlistPosition = (last._max.waitlistPosition ?? 0) + 1;
        } else {
          if (!(await this.seats.claimTicket(tx, studioId, ticket.id))) throw eventError('EVENT_TICKET_SOLD_OUT');
          if (creditPackageId && memberId) {
            const resolved = await this.seats.resolveCreditPackage(tx, studioId, memberId, ticket, creditPackageId);
            if (!resolved || !(await this.seats.chargeCredits(tx, studioId, resolved.memberPackage.id, resolved.units))) {
              throw eventError('EVENT_NO_CREDITS');
            }
            unitsCharged = resolved.units;
            memberPackageId = resolved.memberPackage.id;
            status = 'CONFIRMED';
          } else if (price.lte(0)) {
            status = 'CONFIRMED';
          } else if (input.pay.kind === 'DESK') {
            status = 'CONFIRMED';
            amountPaid = price;
            paymentMethod = input.pay.method;
            if (memberId) {
              const payment = await tx.payment.create({
                data: {
                  studioId,
                  memberId,
                  branchId: event.branchId,
                  amount: price,
                  currency: ticket.currency,
                  paymentMethod: input.pay.method,
                  paymentStatus: PaymentStatus.COMPLETED,
                  metadata: { eventId: event.id, ticketTypeId: ticket.id },
                },
              });
              paymentId = payment.id;
            }
          } else if (input.pay.kind === 'ONLINE') {
            status = 'PENDING_PAYMENT';
            dueAt = paymentDueAt(now, EVENT_ONLINE_HOLD_MINUTES * MINUTE_MS, event.startsAt);
          } else {
            status = 'PENDING_PAYMENT';
            dueAt = paymentDueAt(now, EVENT_DESK_HOLD_HOURS * HOUR_MS, event.startsAt);
          }
        }

        try {
          return await tx.eventRegistration.create({
            data: {
              studioId,
              eventId: event.id,
              ticketTypeId: ticket.id,
              memberId,
              contactId,
              status,
              source: input.source,
              dedupeKey,
              waitlistPosition,
              amountDue: price,
              amountPaid,
              currency: ticket.currency,
              paymentId,
              paymentMethod,
              paymentDueAt: dueAt,
              memberPackageId,
              unitsCharged,
              notes: input.notes ?? null,
              createdByMembershipId: input.actorMembershipId ?? null,
            },
          });
        } catch (err) {
          if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw new DuplicateRegistration();
          throw err;
        }
      });
    } catch (err) {
      if (err instanceof DuplicateRegistration && dedupeKey) {
        const existing = await this.prisma.eventRegistration.findFirst({ where: { studioId, eventId: event.id, dedupeKey } });
        if (existing) return { registrationId: existing.id, duplicate: true };
      }
      throw err;
    }

    if (paymentId) await this.payments.onPaymentCompleted(studioId, paymentId);
    if (created.status === 'PENDING_PAYMENT' && input.pay.kind === 'ONLINE') {
      await this.startCheckout(created.id, input.pay.installmentCount);
    } else if (created.status === 'CONFIRMED') {
      await this.seats.notify(created.id, EVENT_TEMPLATE_KEYS.confirmed, `event-confirmed:${created.id}`);
    } else if (created.status === 'PENDING_PAYMENT') {
      await this.seats.notify(created.id, EVENT_TEMPLATE_KEYS.paymentDue, `event-payment-due:${created.id}`);
    }
    // Automation hook (G3c-3); best effort, never breaks the registration.
    await this.webhooks?.emit(studioId, 'event.registration.created', {
      registrationId: created.id,
      eventId: created.eventId,
      ticketTypeId: created.ticketTypeId,
      status: created.status,
      memberId: created.memberId,
      contactId: created.contactId,
      amountDue: created.amountDue.toFixed(2),
      currency: created.currency,
    });
    return { registrationId: created.id, duplicate: false };
  }

  /**
   * Online checkout through the studio's payment provider adapter (the
   * same registry package checkout uses). MOCK completes at once; a real
   * provider returns a hosted checkout URL and the payments webhook
   * confirms the registration (EventSeatsService.onPaymentCompleted).
   */
  private async startCheckout(registrationId: string, installmentCount: number): Promise<void> {
    const reg = await this.prisma.eventRegistration.findUniqueOrThrow({ where: { id: registrationId }, include: { event: true } });
    if (reg.status !== 'PENDING_PAYMENT' || !reg.memberId) return;
    const provider = this.providers.default;
    const checkout = await provider.createCheckout({
      studioId: reg.studioId,
      memberId: reg.memberId,
      amount: new Prisma.Decimal(reg.amountDue).toNumber(),
      currency: reg.currency,
      installmentCount,
      description: reg.event.title,
      reference: `event_${reg.id}_${Date.now()}`,
    });
    const completed = checkout.status === 'COMPLETED';
    const payment = await this.prisma.$transaction(async (tx) => {
      const row = await tx.payment.create({
        data: {
          studioId: reg.studioId,
          memberId: reg.memberId as string,
          branchId: reg.event.branchId,
          amount: reg.amountDue,
          currency: reg.currency,
          paymentMethod: onlineMethod(provider.name),
          paymentStatus: completed ? PaymentStatus.COMPLETED : PaymentStatus.PENDING,
          provider: provider.name,
          providerReference: checkout.providerReference,
          installmentCount,
          metadata: { eventId: reg.eventId, eventRegistrationId: reg.id },
        },
      });
      await tx.eventRegistration.update({
        where: { id: reg.id },
        data: completed
          ? { paymentId: row.id, paymentMethod: row.paymentMethod, status: 'CONFIRMED', amountPaid: row.amount, paymentDueAt: null, paymentLink: null }
          : {
              paymentId: row.id,
              paymentMethod: row.paymentMethod,
              paymentLink: checkout.checkoutUrl ?? null,
              paymentDueAt: paymentDueAt(new Date(), EVENT_ONLINE_HOLD_MINUTES * MINUTE_MS, reg.event.startsAt),
            },
      });
      return row;
    });
    if (completed) {
      await this.payments.onPaymentCompleted(reg.studioId, payment.id);
      await this.seats.notify(reg.id, EVENT_TEMPLATE_KEYS.confirmed, `event-confirmed:${reg.id}`);
    }
  }

  private async loadTicket(studioId: string, eventId: string, ticketTypeId: string): Promise<EventTicketType> {
    const ticket = await this.prisma.eventTicketType.findFirst({ where: { id: ticketTypeId, eventId, studioId } });
    if (!ticket) throw eventError('EVENT_TICKET_UNAVAILABLE');
    return ticket;
  }

  // -------------------------------------------------------------------------
  // Staff
  // -------------------------------------------------------------------------

  async listRegistrations(tenant: TenantContext, eventId: string, query: RegistrationListQuery): Promise<EventRegistrationDTO[]> {
    const event = await this.events.findOwn(tenant, eventId);
    const rows = await this.prisma.eventRegistration.findMany({
      where: { studioId: tenant.studioId, eventId: event.id, ...(query.status ? { status: query.status } : {}) },
      include: REGISTRATION_INCLUDE,
      orderBy: [{ createdAt: 'asc' }],
      take: 5000,
    });
    const canViewContact = tenant.permissions.has('members.contact.view');
    return rows.map((r) => toRegistrationDTO(r, canViewContact));
  }

  async staffRegister(tenant: TenantContext, eventId: string, dto: StaffRegisterInput): Promise<EventRegisterResultDTO> {
    const event = await this.events.findOwn(tenant, eventId);
    const ticket = await this.loadTicket(tenant.studioId, event.id, dto.ticketTypeId);
    let person: Person;
    if (dto.memberId) {
      const member = await this.prisma.memberProfile.findFirst({ where: { id: dto.memberId, studioId: tenant.studioId } });
      if (!member) throw eventError('EVENT_NOT_FOUND');
      person = { memberId: member.id };
    } else {
      const contact = await this.prisma.contact.findFirst({ where: { id: dto.contactId, studioId: tenant.studioId, mergedIntoId: null } });
      if (!contact) throw eventError('EVENT_NOT_FOUND');
      person = { contactId: contact.id };
    }
    const result = await this.register({
      studioId: tenant.studioId,
      event,
      ticket,
      person,
      source: 'STAFF',
      pay: dto.paymentMethod ? { kind: 'DESK', method: dto.paymentMethod } : { kind: 'LATER' },
      memberPackageId: dto.memberPackageId,
      notes: dto.notes,
      actorMembershipId: tenant.membershipId,
      enforceWindow: false,
    });
    return { registration: await this.dto(result.registrationId, tenant.permissions.has('members.contact.view')), duplicate: result.duplicate };
  }

  private async findRegistration(tenant: TenantContext, registrationId: string) {
    const reg = await this.prisma.eventRegistration.findFirst({
      where: { id: registrationId, studioId: tenant.studioId },
      include: { event: true },
    });
    if (!reg) throw eventError('EVENT_NOT_FOUND');
    return reg;
  }

  /** Staff take the money for a held seat at the desk. Members get a Payment row; a guest's amount is recorded on the registration. */
  async recordPayment(tenant: TenantContext, actorUserId: string, registrationId: string, dto: RecordEventPaymentInput): Promise<EventRegistrationDTO> {
    const reg = await this.findRegistration(tenant, registrationId);
    assertBranchAccess(tenant, reg.event.branchId);
    if (reg.status !== 'PENDING_PAYMENT') throw eventError('EVENT_REGISTRATION_NOT_CHECKABLE');
    const paymentId = await this.prisma.$transaction(async (tx) => {
      let createdId: string | null = null;
      if (reg.memberId) {
        const payment = await tx.payment.create({
          data: {
            studioId: tenant.studioId,
            memberId: reg.memberId,
            branchId: reg.event.branchId,
            amount: reg.amountDue,
            currency: reg.currency,
            paymentMethod: dto.paymentMethod,
            paymentStatus: PaymentStatus.COMPLETED,
            metadata: { eventId: reg.eventId, eventRegistrationId: reg.id },
          },
        });
        createdId = payment.id;
      }
      const moved = await tx.eventRegistration.updateMany({
        where: { id: reg.id, studioId: tenant.studioId, status: 'PENDING_PAYMENT' },
        data: {
          status: 'CONFIRMED',
          amountPaid: reg.amountDue,
          paymentMethod: dto.paymentMethod,
          paymentDueAt: null,
          paymentLink: null,
          ...(createdId ? { paymentId: createdId } : {}),
        },
      });
      if (moved.count === 0) throw eventError('EVENT_REGISTRATION_NOT_CHECKABLE');
      await tx.auditLog.create({
        data: {
          studioId: tenant.studioId,
          userId: actorUserId,
          action: 'events.registration.payment',
          entityType: 'EventRegistration',
          entityId: reg.id,
          metadata: { amount: new Prisma.Decimal(reg.amountDue).toFixed(2), currency: reg.currency, method: dto.paymentMethod },
        },
      });
      return createdId;
    });
    if (paymentId) await this.payments.onPaymentCompleted(tenant.studioId, paymentId);
    await this.seats.notify(reg.id, EVENT_TEMPLATE_KEYS.confirmed, `event-confirmed:${reg.id}`);
    return this.dto(reg.id, tenant.permissions.has('members.contact.view'));
  }

  async staffCancel(tenant: TenantContext, actorUserId: string, registrationId: string, dto: CancelRegistrationInput): Promise<RegistrationCancelResultDTO> {
    const reg = await this.findRegistration(tenant, registrationId);
    assertBranchAccess(tenant, reg.event.branchId);
    return this.cancel(tenant, actorUserId, reg, dto.reason ?? null, dto.fullRefund === true);
  }

  /**
   * Cancels a live registration under the event's refund policy: in full
   * (money through the payments module's refund, package units back) until
   * `fullRefundHoursBefore` hours before the start, nothing after, unless
   * staff force a full refund. A freed seat goes to the waitlist.
   */
  private async cancel(
    tenant: TenantContext,
    actorUserId: string,
    reg: EventRegistration & { event: Event },
    reason: string | null,
    forceRefund: boolean,
  ): Promise<RegistrationCancelResultDTO> {
    if (!(EVENT_CANCELLABLE_STATUSES as readonly string[]).includes(reg.status)) throw eventError('EVENT_REGISTRATION_NOT_CANCELLABLE');
    const now = new Date();
    const policy = evaluateEventRefund({ startsAt: reg.event.startsAt, now, fullRefundHoursBefore: reg.event.fullRefundHoursBefore });
    const refundable = forceRefund || policy.refundable;
    const cancelled = await this.prisma.$transaction((tx) => this.seats.cancelTx(tx, reg, { reason, refundUnits: refundable, now }));
    if (!cancelled) throw eventError('EVENT_REGISTRATION_NOT_CANCELLABLE');

    let refunded = false;
    if (refundable) {
      const outcome = await this.events.refundInFull(tenant, actorUserId, reg, reason);
      if (outcome === 'FAILED') this.logger.warn(`Refund failed for event registration ${reg.id}`);
      refunded = outcome === 'REFUNDED' || (refundable && reg.unitsCharged > 0);
    }
    const heldSeat = reg.status !== 'WAITLIST';
    const promoted = heldSeat && (!reg.event.startsAt || reg.event.startsAt > now) ? await this.seats.promoteWaitlistSafe(reg.studioId, reg.eventId) : 0;
    const after = await this.prisma.eventRegistration.findUniqueOrThrow({ where: { id: reg.id }, include: REGISTRATION_INCLUDE });
    return {
      registration: toRegistrationDTO(after, tenant.permissions.has('members.contact.view')),
      refunded,
      refundedAmount: new Prisma.Decimal(after.refundedAmount).toFixed(2),
      refundedUnits: after.refundedUnits,
      promotedFromWaitlist: promoted,
    };
  }

  /** Door check-in. A second scan of an attended registration returns it unchanged. */
  async checkIn(tenant: TenantContext, registrationId: string): Promise<EventRegistrationDTO> {
    const reg = await this.findRegistration(tenant, registrationId);
    assertBranchAccess(tenant, reg.event.branchId);
    const canViewContact = tenant.permissions.has('members.contact.view');
    if (reg.status === 'ATTENDED') return this.dto(reg.id, canViewContact);
    if (reg.status === 'PENDING_PAYMENT') throw eventError('EVENT_PAYMENT_PENDING');
    if (reg.event.status !== 'PUBLISHED' && reg.event.status !== 'COMPLETED') throw eventError('EVENT_REGISTRATION_NOT_CHECKABLE');
    const moved = await this.prisma.eventRegistration.updateMany({
      where: { id: reg.id, studioId: tenant.studioId, status: { in: ['CONFIRMED', 'NO_SHOW'] } },
      data: { status: 'ATTENDED', checkedInAt: new Date() },
    });
    if (moved.count === 0) {
      const current = await this.prisma.eventRegistration.findUniqueOrThrow({ where: { id: reg.id } });
      if (current.status !== 'ATTENDED') throw eventError('EVENT_REGISTRATION_NOT_CHECKABLE');
    } else {
      // Best effort inside the earn service: attendance points for members (ATTENDANCE rules).
      await this.loyalty.onEventAttendance(tenant.studioId, reg.id);
    }
    return this.dto(reg.id, canViewContact);
  }

  async markNoShow(tenant: TenantContext, registrationId: string): Promise<EventRegistrationDTO> {
    const reg = await this.findRegistration(tenant, registrationId);
    assertBranchAccess(tenant, reg.event.branchId);
    if (reg.event.startsAt && reg.event.startsAt > new Date()) throw eventError('EVENT_REGISTRATION_NOT_CHECKABLE');
    const moved = await this.prisma.eventRegistration.updateMany({
      where: { id: reg.id, studioId: tenant.studioId, status: 'CONFIRMED' },
      data: { status: 'NO_SHOW' },
    });
    if (moved.count === 0) throw eventError('EVENT_REGISTRATION_NOT_CHECKABLE');
    return this.dto(reg.id, tenant.permissions.has('members.contact.view'));
  }

  /** Registration list as CSV (semicolon separated, formula-safe), headers in the requested or studio language. */
  async exportCsv(tenant: TenantContext, eventId: string, query: EventExportQuery): Promise<{ filename: string; csv: string }> {
    const event = await this.events.findOwn(tenant, eventId);
    const studio = await this.prisma.studio.findUniqueOrThrow({ where: { id: tenant.studioId }, select: { defaultLocale: true } });
    const locale = query.locale && BUNDLED_MESSAGES[query.locale] ? query.locale : studio.defaultLocale;
    const t = createTranslator({ locale, messages: BUNDLED_MESSAGES[locale] ?? BASE_MESSAGES, fallback: BASE_MESSAGES });
    const rows = await this.listRegistrations(tenant, event.id, {});
    const csv = toCsv(
      [
        t('events.csv.name'),
        t('events.csv.phone'),
        t('events.csv.ticket'),
        t('events.csv.status'),
        t('events.csv.amountPaid'),
        t('events.csv.currency'),
        t('events.csv.checkedInAt'),
        t('events.csv.registeredAt'),
      ],
      rows.map((r) => [
        r.displayName,
        r.phone ?? '',
        r.ticketTypeName,
        t(`events.registrationStatus.${r.status}`),
        r.amountPaid,
        r.currency,
        r.checkedInAt ?? '',
        r.createdAt,
      ]),
    );
    return { filename: `event-${event.id}.csv`, csv };
  }

  // -------------------------------------------------------------------------
  // Member self-service
  // -------------------------------------------------------------------------

  private assertMember(tenant: TenantContext): string {
    if (!tenant.memberProfileId) throw new ForbiddenException({ statusCode: 403, message: 'Members only' });
    return tenant.memberProfileId;
  }

  /** Published events a member can see: members-only and public, not yet over. */
  async listForMember(tenant: TenantContext): Promise<EventDTO[]> {
    const now = new Date();
    const events = await this.prisma.event.findMany({
      where: { studioId: tenant.studioId, status: 'PUBLISHED', OR: [{ endsAt: { gte: now } }, { endsAt: null }] },
      include: EVENT_INCLUDE,
      orderBy: [{ startsAt: { sort: 'asc', nulls: 'last' } }],
      take: 200,
    });
    const counts = await this.events.waitlistCounts(tenant.studioId, events.map((e) => e.id));
    return events.map((e) => toEventDTO(e, counts.get(e.id) ?? 0, now));
  }

  async getForMember(tenant: TenantContext, eventId: string): Promise<EventDTO> {
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, studioId: tenant.studioId, status: { in: ['PUBLISHED', 'COMPLETED', 'CANCELLED'] } },
      include: EVENT_INCLUDE,
    });
    if (!event) throw eventError('EVENT_NOT_FOUND');
    const counts = await this.events.waitlistCounts(tenant.studioId, [event.id]);
    return toEventDTO(event, counts.get(event.id) ?? 0);
  }

  async memberRegister(tenant: TenantContext, eventId: string, dto: MemberRegisterInput): Promise<EventRegisterResultDTO> {
    const memberId = this.assertMember(tenant);
    const event = await this.prisma.event.findFirst({ where: { id: eventId, studioId: tenant.studioId } });
    if (!event) throw eventError('EVENT_NOT_FOUND');
    const ticket = await this.loadTicket(tenant.studioId, event.id, dto.ticketTypeId);
    const result = await this.register({
      studioId: tenant.studioId,
      event,
      ticket,
      person: { memberId },
      source: 'MEMBER',
      pay: { kind: 'ONLINE', installmentCount: dto.installmentCount },
      memberPackageId: dto.memberPackageId,
      useCredits: dto.useCredits,
      enforceWindow: true,
    });
    return { registration: await this.dto(result.registrationId, true), duplicate: result.duplicate };
  }

  private async findOwnRegistration(tenant: TenantContext, registrationId: string) {
    const memberId = this.assertMember(tenant);
    const reg = await this.prisma.eventRegistration.findFirst({
      where: { id: registrationId, studioId: tenant.studioId, memberId },
      include: { event: true },
    });
    if (!reg) throw eventError('EVENT_NOT_FOUND');
    return reg;
  }

  async memberCancel(tenant: TenantContext, actorUserId: string, registrationId: string, dto: CancelRegistrationInput): Promise<RegistrationCancelResultDTO> {
    const reg = await this.findOwnRegistration(tenant, registrationId);
    // Members never force a refund past the deadline.
    return this.cancel(tenant, actorUserId, reg, dto.reason ?? null, false);
  }

  /** Starts (or restarts) the online checkout of a held seat, e.g. after a waitlist promotion. */
  async memberPay(tenant: TenantContext, registrationId: string, installmentCount: number): Promise<EventRegistrationDTO> {
    const reg = await this.findOwnRegistration(tenant, registrationId);
    if (reg.status !== 'PENDING_PAYMENT') throw eventError('EVENT_REGISTRATION_NOT_CHECKABLE');
    await this.startCheckout(reg.id, installmentCount);
    return this.dto(reg.id, true);
  }

  async myRegistrations(tenant: TenantContext): Promise<MyEventRegistrationDTO[]> {
    const memberId = this.assertMember(tenant);
    const rows = await this.prisma.eventRegistration.findMany({
      where: { studioId: tenant.studioId, memberId },
      include: { ...REGISTRATION_INCLUDE, event: { select: { title: true, status: true, startsAt: true, endsAt: true } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return rows.map((r) => ({
      ...toRegistrationDTO(r as RegistrationWithPerson, true),
      eventTitle: r.event.title,
      eventStatus: r.event.status as EventStatus,
      eventStartsAt: r.event.startsAt?.toISOString() ?? null,
      eventEndsAt: r.event.endsAt?.toISOString() ?? null,
    }));
  }

  // -------------------------------------------------------------------------
  // Public (unauthenticated, by studio slug)
  // -------------------------------------------------------------------------

  private async studioBySlug(slug: string) {
    const studio = await this.prisma.studio.findUnique({ where: { slug }, select: { id: true, isActive: true } });
    if (!studio || !studio.isActive) throw eventError('EVENT_NOT_FOUND');
    return studio;
  }

  private publicWhere(studioId: string, now: Date): Prisma.EventWhereInput {
    return { studioId, status: 'PUBLISHED', visibility: 'PUBLIC', OR: [{ endsAt: { gte: now } }, { endsAt: null }] };
  }

  private isOpen(event: Event, now: Date): boolean {
    return (
      registrationBlock({
        status: event.status as EventStatus,
        opensAt: event.registrationOpensAt,
        closesAt: event.registrationClosesAt,
        endsAt: event.endsAt,
        now,
      }) === null
    );
  }

  /** Only PUBLIC and PUBLISHED events that are not over; nothing about registrants. */
  async publicList(slug: string): Promise<PublicEventDTO[]> {
    const studio = await this.studioBySlug(slug);
    const now = new Date();
    const events = await this.prisma.event.findMany({
      where: this.publicWhere(studio.id, now),
      include: EVENT_INCLUDE,
      orderBy: [{ startsAt: { sort: 'asc', nulls: 'last' } }],
      take: 100,
    });
    return events.map((e) => toPublicEventDTO(e, this.isOpen(e, now), now));
  }

  async publicGet(slug: string, eventId: string): Promise<PublicEventDTO> {
    const studio = await this.studioBySlug(slug);
    const now = new Date();
    const event = await this.prisma.event.findFirst({ where: { id: eventId, ...this.publicWhere(studio.id, now) }, include: EVENT_INCLUDE });
    if (!event) throw eventError('EVENT_NOT_FOUND');
    return toPublicEventDTO(event, this.isOpen(event, now), now);
  }

  /**
   * A guest registers on the public page: the CRM contact is found or
   * created (phone, then email), the visitor's touchpoints are attached,
   * and a new lead records the existing `lead` conversion (idempotent per
   * contact). Paid tickets hold the seat as PENDING_PAYMENT until paid at
   * the desk or the hold expires.
   */
  async publicRegister(
    slug: string,
    eventId: string,
    dto: PublicEventRegisterInput,
    visitorId: string | null,
  ): Promise<{ received: true; status?: string; duplicate?: boolean }> {
    const studio = await this.studioBySlug(slug);
    // Honeypot filled: same shape as success, nothing stored.
    if (dto.website) return { received: true };
    const now = new Date();
    const event = await this.prisma.event.findFirst({ where: { id: eventId, ...this.publicWhere(studio.id, now) } });
    if (!event) throw eventError('EVENT_NOT_FOUND');
    const ticket = await this.loadTicket(studio.id, event.id, dto.ticketTypeId);
    if (ticket.membersOnly) throw eventError('EVENT_MEMBERS_ONLY');

    const { contact, created } = await this.contacts.resolveOrCreate(studio.id, {
      firstName: dto.firstName,
      lastName: dto.lastName,
      phone: dto.phone,
      email: dto.email || null,
      lifecycleStage: 'LEAD',
      sourceChannel: 'WEB_FORM',
      sourceDetail: event.title.slice(0, 200),
    });
    await this.attribution.identify(studio.id, visitorId, contact.id);
    if (created || contact.lifecycleStage === 'LEAD') {
      await this.conversions.recordSafely({ studioId: studio.id, type: 'lead', contactId: contact.id, source: { kind: 'lead_contact', id: contact.id } });
    }

    const result = await this.register({
      studioId: studio.id,
      event,
      ticket,
      person: { contactId: contact.id },
      source: 'PUBLIC',
      pay: { kind: 'LATER' },
      enforceWindow: true,
    });
    const reg = await this.prisma.eventRegistration.findUniqueOrThrow({ where: { id: result.registrationId } });
    return { received: true, status: reg.status, duplicate: result.duplicate };
  }
}
