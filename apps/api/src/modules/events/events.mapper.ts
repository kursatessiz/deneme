import { Prisma } from '@platform/database';
import type { Contact, EventOccurrence, EventTicketType } from '@platform/database';
import { remainingSeats, ticketOnSale } from '@platform/shared';
import type {
  EventDTO,
  EventKind,
  EventOccurrenceDTO,
  EventRegistrationDTO,
  EventRegistrationSource,
  EventRegistrationStatus,
  EventStatus,
  EventTicketTypeDTO,
  EventVisibility,
  PublicEventDTO,
} from '@platform/shared';

/** Prisma include for everything an EventDTO shows. */
export const EVENT_INCLUDE = {
  occurrences: {
    orderBy: { startsAt: 'asc' },
    include: {
      resource: { select: { name: true } },
      trainer: { select: { membership: { select: { user: { select: { firstName: true, lastName: true } } } } } },
    },
  },
  ticketTypes: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
} satisfies Prisma.EventInclude;

export type EventWithDetails = Prisma.EventGetPayload<{ include: typeof EVENT_INCLUDE }>;

/** The public listing also needs the branch (where, which zone); the studio itself is the fallback. */
export const PUBLIC_EVENT_INCLUDE = {
  ...EVENT_INCLUDE,
  branch: { select: { name: true, address: true, timezone: true } },
} satisfies Prisma.EventInclude;

export type PublicEventWithDetails = Prisma.EventGetPayload<{ include: typeof PUBLIC_EVENT_INCLUDE }>;

export interface PublicEventStudio {
  name: string;
  address: string | null;
  timezone: string;
}

/** Prisma include for everything an EventRegistrationDTO shows. */
export const REGISTRATION_INCLUDE = {
  ticketType: { select: { name: true } },
  member: { select: { membership: { select: { user: { select: { firstName: true, lastName: true, phone: true } } } } } },
  contact: { select: { firstName: true, lastName: true, phone: true } },
} satisfies Prisma.EventRegistrationInclude;

export type RegistrationWithPerson = Prisma.EventRegistrationGetPayload<{ include: typeof REGISTRATION_INCLUDE }>;

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);
const money = (d: Prisma.Decimal | number | string): string => new Prisma.Decimal(d).toFixed(2);

function fullName(first: string, last: string): string {
  return `${first} ${last}`.trim();
}

export function toOccurrenceDTO(o: EventWithDetails['occurrences'][number]): EventOccurrenceDTO {
  const trainerUser = o.trainer?.membership.user;
  return {
    id: o.id,
    startsAt: o.startsAt.toISOString(),
    endsAt: o.endsAt.toISOString(),
    resourceId: o.resourceId,
    resourceName: o.resource?.name ?? null,
    trainerId: o.trainerId,
    trainerName: trainerUser ? fullName(trainerUser.firstName, trainerUser.lastName) : null,
  };
}

export function toTicketDTO(t: EventTicketType, now: Date): EventTicketTypeDTO {
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    priceAmount: money(t.priceAmount),
    currency: t.currency,
    quantityLimit: t.quantityLimit,
    soldCount: t.soldCount,
    salesStartAt: iso(t.salesStartAt),
    salesEndAt: iso(t.salesEndAt),
    membersOnly: t.membersOnly,
    allowMultiple: t.allowMultiple,
    creditServiceTypeId: t.creditServiceTypeId,
    creditUnits: t.creditUnits,
    isActive: t.isActive,
    sortOrder: t.sortOrder,
    onSale: ticketOnSale(t, now),
  };
}

export function toEventDTO(e: EventWithDetails, waitlistCount: number, now = new Date()): EventDTO {
  return {
    id: e.id,
    branchId: e.branchId,
    title: e.title,
    description: e.description,
    kind: e.kind as EventKind,
    status: e.status as EventStatus,
    capacity: e.capacity,
    seatsTaken: e.seatsTaken,
    remainingSeats: remainingSeats(e.capacity, e.seatsTaken),
    waitlistEnabled: e.waitlistEnabled,
    waitlistCount,
    visibility: e.visibility as EventVisibility,
    coverImageUrl: e.coverImageUrl,
    registrationOpensAt: iso(e.registrationOpensAt),
    registrationClosesAt: iso(e.registrationClosesAt),
    startsAt: iso(e.startsAt),
    endsAt: iso(e.endsAt),
    fullRefundHoursBefore: e.fullRefundHoursBefore,
    cancellationReason: e.cancellationReason,
    occurrences: e.occurrences.map(toOccurrenceDTO),
    ticketTypes: e.ticketTypes.map((t) => toTicketDTO(t, now)),
    createdAt: e.createdAt.toISOString(),
  };
}

export function toPublicEventDTO(e: PublicEventWithDetails, studio: PublicEventStudio, registrationOpen: boolean, now = new Date()): PublicEventDTO {
  return {
    id: e.id,
    title: e.title,
    description: e.description,
    kind: e.kind as EventKind,
    coverImageUrl: e.coverImageUrl,
    startsAt: iso(e.startsAt),
    endsAt: iso(e.endsAt),
    remainingSeats: remainingSeats(e.capacity, e.seatsTaken),
    waitlistEnabled: e.waitlistEnabled,
    registrationOpen,
    occurrences: e.occurrences.map((o: EventOccurrence) => ({ startsAt: o.startsAt.toISOString(), endsAt: o.endsAt.toISOString() })),
    ticketTypes: e.ticketTypes
      .filter((t) => t.isActive && !t.membersOnly)
      .map((t) => ({ id: t.id, name: t.name, description: t.description, priceAmount: money(t.priceAmount), currency: t.currency, onSale: ticketOnSale(t, now) })),
    timezone: e.branch?.timezone ?? studio.timezone,
    location: e.branch ? { name: e.branch.name, address: e.branch.address ?? studio.address } : { name: studio.name, address: studio.address },
  };
}

export function toRegistrationDTO(r: RegistrationWithPerson, canViewContact: boolean): EventRegistrationDTO {
  const user = r.member?.membership.user;
  const contact: Pick<Contact, 'firstName' | 'lastName' | 'phone'> | null = r.contact;
  const displayName = user ? fullName(user.firstName, user.lastName) : contact ? fullName(contact.firstName, contact.lastName) : '';
  const phone = user?.phone ?? contact?.phone ?? null;
  return {
    id: r.id,
    eventId: r.eventId,
    ticketTypeId: r.ticketTypeId,
    ticketTypeName: r.ticketType.name,
    memberId: r.memberId,
    contactId: r.contactId,
    displayName,
    phone: canViewContact ? phone : null,
    status: r.status as EventRegistrationStatus,
    source: r.source as EventRegistrationSource,
    waitlistPosition: r.waitlistPosition,
    amountDue: money(r.amountDue),
    amountPaid: money(r.amountPaid),
    refundedAmount: money(r.refundedAmount),
    currency: r.currency,
    paymentId: r.paymentId,
    paymentLink: r.paymentLink,
    paymentDueAt: iso(r.paymentDueAt),
    unitsCharged: r.unitsCharged,
    checkedInAt: iso(r.checkedInAt),
    cancelledAt: iso(r.cancelledAt),
    createdAt: r.createdAt.toISOString(),
  };
}
