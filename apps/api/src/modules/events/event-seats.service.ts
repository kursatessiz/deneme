import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@platform/database';
import type { EventRegistration, EventTicketType, MemberPackage } from '@platform/database';
import { EVENT_DESK_HOLD_HOURS, EVENT_TEMPLATE_KEYS, paymentDueAt } from '@platform/shared';
import { PrismaService } from '../prisma/prisma.service';
import { MessagingService } from '../messaging/engine/messaging.service';

type Tx = Prisma.TransactionClient;
type Db = Tx | PrismaService;

const HOUR_MS = 60 * 60 * 1000;
/** Upper bound on waitlist entries tried per call, so a long list of unusable entries cannot stall a request. */
const MAX_PROMOTION_ATTEMPTS = 20;

export type EventTemplateKey = (typeof EVENT_TEMPLATE_KEYS)[keyof typeof EVENT_TEMPLATE_KEYS];

/**
 * Seat accounting, package credits, waitlist promotion and registration
 * notices for events (docs/ETKINLIKLER.md). No controllers and no module
 * dependencies beyond the global Prisma and messaging modules, so the
 * payments module can call it from the provider webhook without an import
 * cycle through EventsModule.
 *
 * Seats and ticket quantities only move through conditional UPDATEs
 * (`seats_taken < capacity`, `sold_count < quantity_limit`) inside the
 * caller's transaction: the row lock on the event serialises concurrent
 * registrations, so an event is never oversold. CHECK constraints in the
 * migration back this up.
 */
@Injectable()
export class EventSeatsService {
  private readonly logger = new Logger(EventSeatsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly messaging: MessagingService,
  ) {}

  // -------------------------------------------------------------------------
  // Seats and ticket quantities
  // -------------------------------------------------------------------------

  async claimSeat(tx: Tx, studioId: string, eventId: string): Promise<boolean> {
    const updated = await tx.$executeRaw`
      UPDATE "events" SET "seats_taken" = "seats_taken" + 1, "updated_at" = NOW()
      WHERE "id" = ${eventId}::uuid AND "studio_id" = ${studioId}::uuid
        AND "status" = 'PUBLISHED' AND "seats_taken" < "capacity"`;
    return updated === 1;
  }

  async releaseSeat(tx: Tx, studioId: string, eventId: string): Promise<void> {
    await tx.$executeRaw`
      UPDATE "events" SET "seats_taken" = "seats_taken" - 1, "updated_at" = NOW()
      WHERE "id" = ${eventId}::uuid AND "studio_id" = ${studioId}::uuid AND "seats_taken" > 0`;
  }

  async claimTicket(tx: Tx, studioId: string, ticketTypeId: string): Promise<boolean> {
    const updated = await tx.$executeRaw`
      UPDATE "event_ticket_types" SET "sold_count" = "sold_count" + 1, "updated_at" = NOW()
      WHERE "id" = ${ticketTypeId}::uuid AND "studio_id" = ${studioId}::uuid
        AND ("quantity_limit" IS NULL OR "sold_count" < "quantity_limit")`;
    return updated === 1;
  }

  async releaseTicket(tx: Tx, studioId: string, ticketTypeId: string): Promise<void> {
    await tx.$executeRaw`
      UPDATE "event_ticket_types" SET "sold_count" = "sold_count" - 1, "updated_at" = NOW()
      WHERE "id" = ${ticketTypeId}::uuid AND "studio_id" = ${studioId}::uuid AND "sold_count" > 0`;
  }

  // -------------------------------------------------------------------------
  // Package credits (same conditional decrement as a session booking)
  // -------------------------------------------------------------------------

  /**
   * The member package that pays for a credit ticket: the given one, or the
   * member's active package covering the ticket's service type that ends
   * first. Null when none can pay. TIME_UNLIMITED packages pay 0 units,
   * like a session booking.
   */
  async resolveCreditPackage(
    db: Db,
    studioId: string,
    memberId: string,
    ticket: Pick<EventTicketType, 'creditServiceTypeId' | 'creditUnits'>,
    memberPackageId?: string | null,
  ): Promise<{ memberPackage: MemberPackage; units: number } | null> {
    if (!ticket.creditServiceTypeId || !ticket.creditUnits) return null;
    const now = new Date();
    const candidates = await db.memberPackage.findMany({
      where: {
        studioId,
        memberId,
        status: 'ACTIVE',
        endDate: { gt: now },
        ...(memberPackageId ? { id: memberPackageId } : {}),
        packageDefinition: { services: { some: { serviceTypeId: ticket.creditServiceTypeId } } },
      },
      orderBy: { endDate: 'asc' },
    });
    for (const pkg of candidates) {
      const units = pkg.entitlementKind === 'TIME_UNLIMITED' ? 0 : ticket.creditUnits;
      if (units === 0 || (pkg.remainingUnits ?? 0) >= units) return { memberPackage: pkg, units };
    }
    return null;
  }

  async chargeCredits(tx: Tx, studioId: string, memberPackageId: string, units: number): Promise<boolean> {
    if (units <= 0) return true;
    const charged = await tx.memberPackage.updateMany({
      where: { id: memberPackageId, studioId, status: 'ACTIVE', remainingUnits: { gte: units } },
      data: { usedUnits: { increment: units }, remainingUnits: { decrement: units } },
    });
    if (charged.count === 0) return false;
    await tx.memberPackage.updateMany({ where: { id: memberPackageId, studioId, remainingUnits: 0 }, data: { status: 'DEPLETED' } });
    return true;
  }

  async refundCredits(tx: Tx, studioId: string, memberPackageId: string | null, units: number): Promise<void> {
    if (!memberPackageId || units <= 0) return;
    await tx.memberPackage.updateMany({
      where: { id: memberPackageId, studioId },
      data: { usedUnits: { decrement: units }, remainingUnits: { increment: units } },
    });
    // Only a package emptied by spending comes back; frozen or expired ones keep their status.
    await tx.memberPackage.updateMany({
      where: { id: memberPackageId, studioId, status: 'DEPLETED', remainingUnits: { gt: 0 } },
      data: { status: 'ACTIVE' },
    });
  }

  // -------------------------------------------------------------------------
  // Releasing a registration's seat
  // -------------------------------------------------------------------------

  /**
   * Moves a live registration to CANCELLED (conditional on its current
   * status, so two concurrent cancels cannot both release a seat), frees
   * its seat and ticket, and returns package units when `refundUnits`.
   * Returns false when the registration was no longer in `fromStatuses`.
   */
  async cancelTx(
    tx: Tx,
    registration: Pick<EventRegistration, 'id' | 'studioId' | 'eventId' | 'ticketTypeId' | 'status' | 'memberPackageId' | 'unitsCharged'>,
    opts: { reason: string | null; refundUnits: boolean; now: Date },
  ): Promise<boolean> {
    const holdsSeat = registration.status !== 'WAITLIST';
    const moved = await tx.eventRegistration.updateMany({
      where: { id: registration.id, studioId: registration.studioId, status: registration.status },
      data: {
        status: 'CANCELLED',
        dedupeKey: null,
        waitlistPosition: null,
        cancelledAt: opts.now,
        cancellationReason: opts.reason,
        paymentDueAt: null,
        paymentLink: null,
        ...(opts.refundUnits && registration.unitsCharged > 0 ? { refundedUnits: registration.unitsCharged } : {}),
      },
    });
    if (moved.count === 0) return false;
    if (holdsSeat) {
      await this.releaseSeat(tx, registration.studioId, registration.eventId);
      await this.releaseTicket(tx, registration.studioId, registration.ticketTypeId);
    }
    if (opts.refundUnits) await this.refundCredits(tx, registration.studioId, registration.memberPackageId, registration.unitsCharged);
    return true;
  }

  // -------------------------------------------------------------------------
  // Waitlist
  // -------------------------------------------------------------------------

  /** Never lets a promotion problem fail the change that freed the seat. */
  async promoteWaitlistSafe(studioId: string, eventId: string): Promise<number> {
    try {
      return await this.promoteWaitlist(studioId, eventId);
    } catch (err) {
      this.logger.error(`Event waitlist promotion failed for ${eventId}: ${err instanceof Error ? err.message : String(err)}`);
      return 0;
    }
  }

  /**
   * Fills free seats from the head of the waitlist, first come first
   * served, like the session waitlist. Each entry moves out of WAITLIST
   * with a conditional update inside the seat transaction, so concurrent
   * cancellations never promote the same person twice. A free ticket is
   * confirmed at once; a credit ticket is charged to the package chosen at
   * join time (an entry whose package can no longer pay is cancelled and
   * the next one tried); a paid ticket holds the seat as PENDING_PAYMENT
   * until the payment deadline.
   */
  async promoteWaitlist(studioId: string, eventId: string): Promise<number> {
    let promoted = 0;
    for (let attempt = 0; attempt < MAX_PROMOTION_ATTEMPTS; attempt++) {
      const now = new Date();
      const event = await this.prisma.event.findFirst({ where: { id: eventId, studioId } });
      if (!event || event.status !== 'PUBLISHED' || !event.waitlistEnabled) break;
      if (event.startsAt && event.startsAt <= now) break;
      if (event.seatsTaken >= event.capacity) break;

      const next = await this.prisma.eventRegistration.findFirst({
        where: { studioId, eventId, status: 'WAITLIST' },
        orderBy: [{ waitlistPosition: 'asc' }, { createdAt: 'asc' }],
        include: { ticketType: true },
      });
      if (!next) break;

      const outcome = await this.prisma.$transaction(async (tx): Promise<'FULL' | 'SKIPPED' | 'CONFIRMED' | 'PENDING_PAYMENT' | 'RACE'> => {
        if (!(await this.claimSeat(tx, studioId, eventId))) return 'FULL';
        const fail = async (reason: string) => {
          await this.releaseSeat(tx, studioId, eventId);
          await tx.eventRegistration.updateMany({
            where: { id: next.id, status: 'WAITLIST' },
            data: { status: 'CANCELLED', dedupeKey: null, waitlistPosition: null, cancelledAt: now, cancellationReason: reason },
          });
          return 'SKIPPED' as const;
        };
        if (!next.ticketType.isActive || !(await this.claimTicket(tx, studioId, next.ticketTypeId))) return fail('EVENT_TICKET_SOLD_OUT');

        let status: 'CONFIRMED' | 'PENDING_PAYMENT' = 'CONFIRMED';
        let unitsCharged = 0;
        let memberPackageId: string | null = null;
        if (next.memberId && next.memberPackageId) {
          const resolved = await this.resolveCreditPackage(tx, studioId, next.memberId, next.ticketType, next.memberPackageId);
          if (!resolved || !(await this.chargeCredits(tx, studioId, resolved.memberPackage.id, resolved.units))) {
            await this.releaseTicket(tx, studioId, next.ticketTypeId);
            return fail('EVENT_NO_CREDITS');
          }
          unitsCharged = resolved.units;
          memberPackageId = resolved.memberPackage.id;
        } else if (new Prisma.Decimal(next.amountDue).gt(0)) {
          status = 'PENDING_PAYMENT';
        }
        const moved = await tx.eventRegistration.updateMany({
          where: { id: next.id, status: 'WAITLIST' },
          data: {
            status,
            waitlistPosition: null,
            unitsCharged,
            memberPackageId,
            paymentDueAt: status === 'PENDING_PAYMENT' ? paymentDueAt(now, EVENT_DESK_HOLD_HOURS * HOUR_MS, event.startsAt) : null,
          },
        });
        if (moved.count === 0) throw new PromotionRace();
        return status;
      }).catch((err: unknown) => {
        if (err instanceof PromotionRace) return 'RACE' as const;
        throw err;
      });

      if (outcome === 'FULL') break;
      if (outcome === 'RACE' || outcome === 'SKIPPED') continue;
      promoted++;
      if (outcome === 'CONFIRMED') {
        await this.notify(next.id, EVENT_TEMPLATE_KEYS.waitlistPromoted, `event-promoted:${next.id}`);
      } else {
        await this.notify(next.id, EVENT_TEMPLATE_KEYS.paymentDue, `event-payment-due:${next.id}`);
      }
    }
    return promoted;
  }

  // -------------------------------------------------------------------------
  // Online payment outcome (payments webhook)
  // -------------------------------------------------------------------------

  /**
   * A provider confirmed the checkout of an event registration: the held
   * seat becomes CONFIRMED. A registration that was released meanwhile
   * (hold expired, cancelled) keeps its state; the payment stays COMPLETED
   * for staff to refund (docs/ETKINLIKLER.md, "Kalan").
   */
  async onPaymentCompleted(paymentId: string): Promise<void> {
    const registration = await this.prisma.eventRegistration.findUnique({ where: { paymentId } });
    if (!registration) return;
    const payment = await this.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    const moved = await this.prisma.eventRegistration.updateMany({
      where: { id: registration.id, studioId: registration.studioId, status: 'PENDING_PAYMENT' },
      data: { status: 'CONFIRMED', amountPaid: payment.amount, paymentLink: null, paymentDueAt: null },
    });
    if (moved.count === 1) {
      await this.notify(registration.id, EVENT_TEMPLATE_KEYS.confirmed, `event-confirmed:${registration.id}`);
    } else {
      this.logger.warn(`Payment ${paymentId} completed for event registration ${registration.id} in status ${registration.status}`);
    }
  }

  /** A provider reported the checkout failed: the seat stays held until its deadline so the person can retry. */
  async onPaymentFailed(paymentId: string): Promise<void> {
    await this.prisma.eventRegistration.updateMany({
      where: { paymentId, status: 'PENDING_PAYMENT' },
      data: { paymentLink: null },
    });
  }

  // -------------------------------------------------------------------------
  // Notices
  // -------------------------------------------------------------------------

  /**
   * Sends one of the event templates to the registrant (member through the
   * membership, guest through the CRM contact). TRANSACTIONAL: it concerns
   * the person's own registration. Best effort: never throws.
   */
  async notify(registrationId: string, templateKey: EventTemplateKey, idempotencyKey: string, when?: Date | null): Promise<boolean> {
    try {
      const registration = await this.prisma.eventRegistration.findUnique({
        where: { id: registrationId },
        include: {
          event: { select: { title: true, startsAt: true, studio: { select: { timezone: true, defaultLocale: true } } } },
          member: { select: { membershipId: true } },
        },
      });
      if (!registration) return false;
      const recipient = registration.member
        ? { membershipId: registration.member.membershipId }
        : registration.contactId
          ? { contactId: registration.contactId }
          : null;
      if (!recipient) return false;
      const { timezone, defaultLocale } = registration.event.studio;
      const start = when ?? registration.event.startsAt;
      const result = await this.messaging.send({
        studioId: registration.studioId,
        recipient,
        purpose: 'TRANSACTIONAL',
        templateKey,
        variables: {
          eventTitle: registration.event.title,
          startTime: start ? formatDateTime(start, defaultLocale, timezone) : '',
          paymentDueAt: registration.paymentDueAt ? formatDateTime(registration.paymentDueAt, defaultLocale, timezone) : '',
        },
        idempotencyKey,
      });
      return result.success && !result.duplicate;
    } catch (err) {
      this.logger.warn(`Event notice ${templateKey} for ${registrationId} failed: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }
}

class PromotionRace extends Error {}

export function formatDateTime(date: Date, locale: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(date);
  } catch {
    return date.toISOString().slice(0, 16).replace('T', ' ');
  }
}
