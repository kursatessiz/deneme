import { z } from 'zod';
import { PhoneSchema } from './validators';

/**
 * Events, workshops and multi-session courses (G3c-1, docs/ETKINLIKLER.md).
 * Sector-neutral: a retreat, a workshop series, a course of lessons, a
 * tournament or a language term are all one Event with one or more
 * occurrences and one or more ticket types. Titles, ticket names and prices
 * are tenant data (CLAUDE.md rule 7); the lists below only name what the
 * API knows how to handle.
 */

// ---------------------------------------------------------------------------
// Catalogues
// ---------------------------------------------------------------------------

/** SINGLE: exactly one occurrence. SERIES: one registration covers every occurrence. */
export const EVENT_KINDS = ['SINGLE', 'SERIES'] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export const EVENT_STATUSES = ['DRAFT', 'PUBLISHED', 'CANCELLED', 'COMPLETED'] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

/** PUBLIC events are also listed on the unauthenticated public endpoints (guests may register). */
export const EVENT_VISIBILITIES = ['PUBLIC', 'MEMBERS_ONLY'] as const;
export type EventVisibility = (typeof EVENT_VISIBILITIES)[number];

export const EVENT_REGISTRATION_STATUSES = ['PENDING_PAYMENT', 'CONFIRMED', 'WAITLIST', 'CANCELLED', 'ATTENDED', 'NO_SHOW'] as const;
export type EventRegistrationStatus = (typeof EVENT_REGISTRATION_STATUSES)[number];

/** Registrations that occupy a seat (counted in Event.seatsTaken and the ticket's soldCount). */
export const EVENT_SEAT_STATUSES = ['PENDING_PAYMENT', 'CONFIRMED', 'ATTENDED', 'NO_SHOW'] as const satisfies readonly EventRegistrationStatus[];

/** Registrations the person can still cancel. */
export const EVENT_CANCELLABLE_STATUSES = ['PENDING_PAYMENT', 'CONFIRMED', 'WAITLIST'] as const satisfies readonly EventRegistrationStatus[];

/** Who created a registration. */
export const EVENT_REGISTRATION_SOURCES = ['STAFF', 'MEMBER', 'PUBLIC'] as const;
export type EventRegistrationSource = (typeof EVENT_REGISTRATION_SOURCES)[number];

/** Money recorded at the desk by staff; online payments go through the provider adapter. */
export const EVENT_DESK_PAYMENT_METHODS = ['CASH', 'CREDIT_CARD_POS', 'BANK_TRANSFER'] as const;
export type EventDeskPaymentMethod = (typeof EVENT_DESK_PAYMENT_METHODS)[number];

/** Stable error codes the API sends in the body (`code`); clients translate `events.error.<code>`. */
export const EVENT_ERROR_CODES = [
  'EVENT_NOT_FOUND',
  'EVENT_NOT_PUBLISHED',
  'EVENT_NOT_EDITABLE',
  'EVENT_REGISTRATION_CLOSED',
  'EVENT_FULL',
  'EVENT_TICKET_UNAVAILABLE',
  'EVENT_TICKET_SOLD_OUT',
  'EVENT_MEMBERS_ONLY',
  'EVENT_CURRENCY_MISMATCH',
  'EVENT_CAPACITY_BELOW_TAKEN',
  'EVENT_PUBLISH_INCOMPLETE',
  'EVENT_SINGLE_OCCURRENCE',
  'EVENT_NO_CREDITS',
  'EVENT_CREDITS_NOT_ACCEPTED',
  'EVENT_PAYMENT_REQUIRED',
  'EVENT_PAYMENT_PENDING',
  'EVENT_REGISTRATION_NOT_CANCELLABLE',
  'EVENT_REGISTRATION_NOT_CHECKABLE',
  'EVENT_TICKET_IN_USE',
  'EVENT_OCCURRENCE_CONFLICT',
] as const;
export type EventErrorCode = (typeof EVENT_ERROR_CODES)[number];

/** Built-in message templates (tr/en defaults in msgTpl). All are TRANSACTIONAL: they concern the person's own registration. */
export const EVENT_TEMPLATE_KEYS = {
  confirmed: 'EVENT_REGISTRATION_CONFIRMED',
  reminder: 'EVENT_REMINDER',
  cancelled: 'EVENT_CANCELLED',
  waitlistPromoted: 'EVENT_WAITLIST_PROMOTED',
  paymentDue: 'EVENT_PAYMENT_DUE',
} as const;

/** Hours before an occurrence the reminder goes out. */
export const EVENT_REMINDER_HOURS = 24;
/** How long an online checkout holds a seat before the heartbeat releases it. */
export const EVENT_ONLINE_HOLD_MINUTES = 30;
/** How long a pay-at-desk or waitlist-promoted seat is held for payment. */
export const EVENT_DESK_HOLD_HOURS = 48;
export const EVENT_MAX_CAPACITY = 10_000;
export const EVENT_MAX_OCCURRENCES = 100;

// ---------------------------------------------------------------------------
// Pure helpers (unit tested in events.spec.ts)
// ---------------------------------------------------------------------------

const HOUR_MS = 60 * 60 * 1000;

/** Seats still free; never negative (capacity may be lowered only down to the seats taken). */
export function remainingSeats(capacity: number, seatsTaken: number): number {
  return Math.max(0, capacity - seatsTaken);
}

/**
 * What a new registration gets: a seat, a waitlist place, or nothing.
 * Mirrors the atomic database update (seats_taken < capacity); the helper
 * is what the listing endpoints and the UI use to explain the state.
 */
export function seatOutcome(input: { capacity: number; seatsTaken: number; waitlistEnabled: boolean }): 'SEAT' | 'WAITLIST' | 'FULL' {
  if (remainingSeats(input.capacity, input.seatsTaken) > 0) return 'SEAT';
  return input.waitlistEnabled ? 'WAITLIST' : 'FULL';
}

/**
 * Refund policy per event: a full refund (money or package units) until
 * `fullRefundHoursBefore` hours before the event starts, nothing after.
 * An event without a start (no occurrence yet) is always refundable.
 */
export function evaluateEventRefund(input: { startsAt: Date | null; now: Date; fullRefundHoursBefore: number }): { refundable: boolean; deadline: Date | null } {
  if (!input.startsAt) return { refundable: true, deadline: null };
  const deadline = new Date(input.startsAt.getTime() - Math.max(0, input.fullRefundHoursBefore) * HOUR_MS);
  return { refundable: input.now.getTime() <= deadline.getTime(), deadline };
}

/** Why a member or guest cannot register right now, or null. Staff are not bound by the window. */
export function registrationBlock(input: {
  status: EventStatus;
  opensAt: Date | null;
  closesAt: Date | null;
  endsAt: Date | null;
  now: Date;
}): 'EVENT_NOT_PUBLISHED' | 'EVENT_REGISTRATION_CLOSED' | null {
  if (input.status !== 'PUBLISHED') return 'EVENT_NOT_PUBLISHED';
  const t = input.now.getTime();
  if (input.opensAt && t < input.opensAt.getTime()) return 'EVENT_REGISTRATION_CLOSED';
  if (input.closesAt && t > input.closesAt.getTime()) return 'EVENT_REGISTRATION_CLOSED';
  if (input.endsAt && t > input.endsAt.getTime()) return 'EVENT_REGISTRATION_CLOSED';
  return null;
}

/** A ticket type is on sale when active, inside its sales window and not sold out. */
export function ticketOnSale(
  ticket: { isActive: boolean; salesStartAt: Date | null; salesEndAt: Date | null; quantityLimit: number | null; soldCount: number },
  now: Date,
): boolean {
  if (!ticket.isActive) return false;
  const t = now.getTime();
  if (ticket.salesStartAt && t < ticket.salesStartAt.getTime()) return false;
  if (ticket.salesEndAt && t > ticket.salesEndAt.getTime()) return false;
  return ticket.quantityLimit === null || ticket.soldCount < ticket.quantityLimit;
}

/** First start and last end of an event's occurrences (denormalised onto the event for listing and policy). */
export function occurrenceSpan(occurrences: readonly { startsAt: Date; endsAt: Date }[]): { startsAt: Date | null; endsAt: Date | null } {
  if (occurrences.length === 0) return { startsAt: null, endsAt: null };
  let start = occurrences[0].startsAt;
  let end = occurrences[0].endsAt;
  for (const o of occurrences) {
    if (o.startsAt < start) start = o.startsAt;
    if (o.endsAt > end) end = o.endsAt;
  }
  return { startsAt: start, endsAt: end };
}

/**
 * Idempotency key of a registration: one live registration per person and
 * event unless the ticket type allows several (then null, and the unique
 * index ignores the row). Cleared when the registration is cancelled.
 */
export function registrationDedupeKey(input: { allowMultiple: boolean; memberId?: string | null; contactId?: string | null }): string | null {
  if (input.allowMultiple) return null;
  if (input.memberId) return `m:${input.memberId}`;
  if (input.contactId) return `c:${input.contactId}`;
  return null;
}

/** Deadline for paying a held seat: the hold length, but never later than the event start. */
export function paymentDueAt(now: Date, holdMs: number, startsAt: Date | null): Date {
  const due = new Date(now.getTime() + holdMs);
  return startsAt && startsAt < due ? startsAt : due;
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const CurrencySchema = z.string().regex(/^[A-Z]{3}$/, 'Geçersiz para birimi');
const IsoDate = z.string().datetime({ offset: true });
const Money = z.number().min(0).max(10_000_000);

export const EventOccurrenceInputSchema = z
  .object({
    startsAt: IsoDate,
    endsAt: IsoDate,
    resourceId: z.string().uuid().nullable().optional(),
    trainerId: z.string().uuid().nullable().optional(),
  })
  .strict()
  .refine((o) => new Date(o.startsAt) < new Date(o.endsAt), { message: 'Bitiş başlangıçtan sonra olmalıdır', path: ['endsAt'] });
export type EventOccurrenceInput = z.infer<typeof EventOccurrenceInputSchema>;

const EventBase = {
  title: z.string().trim().min(1, 'Başlık giriniz').max(160),
  description: z.string().trim().max(5000).nullable().optional(),
  branchId: z.string().uuid().nullable().optional(),
  capacity: z.number().int().min(1).max(EVENT_MAX_CAPACITY),
  waitlistEnabled: z.boolean().default(false),
  visibility: z.enum(EVENT_VISIBILITIES).default('MEMBERS_ONLY'),
  coverImageUrl: z.string().trim().url().max(2000).refine((u) => u.startsWith('https://'), 'https bağlantısı giriniz').nullable().optional(),
  registrationOpensAt: IsoDate.nullable().optional(),
  registrationClosesAt: IsoDate.nullable().optional(),
  /** Full refund until this many hours before the first occurrence, none after. */
  fullRefundHoursBefore: z.number().int().min(0).max(24 * 90).default(24),
};

export const CreateEventSchema = z
  .object({
    kind: z.enum(EVENT_KINDS),
    ...EventBase,
    occurrences: z.array(EventOccurrenceInputSchema).max(EVENT_MAX_OCCURRENCES).default([]),
  })
  .strict()
  .refine((v) => v.kind !== 'SINGLE' || v.occurrences.length <= 1, { message: 'Tek seferlik etkinliğin tek oturumu olur', path: ['occurrences'] });
export type CreateEventInput = z.infer<typeof CreateEventSchema>;

export const UpdateEventSchema = z
  .object({
    title: EventBase.title.optional(),
    description: EventBase.description,
    branchId: EventBase.branchId,
    capacity: EventBase.capacity.optional(),
    waitlistEnabled: z.boolean().optional(),
    visibility: z.enum(EVENT_VISIBILITIES).optional(),
    coverImageUrl: EventBase.coverImageUrl,
    registrationOpensAt: EventBase.registrationOpensAt,
    registrationClosesAt: EventBase.registrationClosesAt,
    fullRefundHoursBefore: z.number().int().min(0).max(24 * 90).optional(),
  })
  .strict();
export type UpdateEventInput = z.infer<typeof UpdateEventSchema>;

/** Replaces every occurrence of a DRAFT or PUBLISHED event. */
export const ReplaceOccurrencesSchema = z.object({ occurrences: z.array(EventOccurrenceInputSchema).min(1).max(EVENT_MAX_OCCURRENCES) }).strict();
export type ReplaceOccurrencesInput = z.infer<typeof ReplaceOccurrencesSchema>;

const TicketBase = {
  name: z.string().trim().min(1, 'Ad giriniz').max(120),
  description: z.string().trim().max(1000).nullable().optional(),
  /** 0 means free. Always with a currency (the studio's). */
  priceAmount: Money,
  currency: CurrencySchema,
  quantityLimit: z.number().int().min(1).max(EVENT_MAX_CAPACITY).nullable().optional(),
  salesStartAt: IsoDate.nullable().optional(),
  salesEndAt: IsoDate.nullable().optional(),
  membersOnly: z.boolean().default(false),
  /** One person may hold several registrations of this ticket (e.g. a parent booking for two children). */
  allowMultiple: z.boolean().default(false),
  /** Members may pay with package units of a package covering this service type instead of money. */
  creditServiceTypeId: z.string().uuid().nullable().optional(),
  creditUnits: z.number().int().min(1).max(1000).nullable().optional(),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(1000).default(0),
};

export const CreateTicketTypeSchema = z
  .object(TicketBase)
  .strict()
  .refine((v) => (v.creditServiceTypeId == null) === (v.creditUnits == null), {
    message: 'Paket hakkıyla ödeme için hizmet türü ve hak sayısı birlikte girilir',
    path: ['creditUnits'],
  });
export type CreateTicketTypeInput = z.infer<typeof CreateTicketTypeSchema>;

export const UpdateTicketTypeSchema = z
  .object({
    name: TicketBase.name.optional(),
    description: TicketBase.description,
    priceAmount: Money.optional(),
    currency: CurrencySchema.optional(),
    quantityLimit: TicketBase.quantityLimit,
    salesStartAt: TicketBase.salesStartAt,
    salesEndAt: TicketBase.salesEndAt,
    membersOnly: z.boolean().optional(),
    allowMultiple: z.boolean().optional(),
    creditServiceTypeId: TicketBase.creditServiceTypeId,
    creditUnits: TicketBase.creditUnits,
    isActive: z.boolean().optional(),
    sortOrder: z.number().int().min(0).max(1000).optional(),
  })
  .strict();
export type UpdateTicketTypeInput = z.infer<typeof UpdateTicketTypeSchema>;

export const CancelEventSchema = z
  .object({
    reason: z.string().trim().max(500).nullable().optional(),
    notify: z.boolean().default(true),
  })
  .strict();
export type CancelEventInput = z.infer<typeof CancelEventSchema>;

/** Staff registering a member or an existing CRM contact. */
export const StaffRegisterSchema = z
  .object({
    ticketTypeId: z.string().uuid(),
    memberId: z.string().uuid().optional(),
    contactId: z.string().uuid().optional(),
    /** Money collected now at the desk; omitted leaves a paid ticket PENDING_PAYMENT. */
    paymentMethod: z.enum(EVENT_DESK_PAYMENT_METHODS).optional(),
    /** Pay with this member package's units (ticket must accept credits). */
    memberPackageId: z.string().uuid().optional(),
    notes: z.string().trim().max(500).optional(),
  })
  .strict()
  .refine((v) => Boolean(v.memberId) !== Boolean(v.contactId), { message: 'Üye veya kişi seçiniz', path: ['memberId'] });
export type StaffRegisterInput = z.infer<typeof StaffRegisterSchema>;

/** A member registering themselves. */
export const MemberRegisterSchema = z
  .object({
    ticketTypeId: z.string().uuid(),
    /** Pay with package units: this package, or with `useCredits` the member's package that ends first. */
    memberPackageId: z.string().uuid().optional(),
    useCredits: z.boolean().default(false),
    installmentCount: z.number().int().min(1).max(12).default(1),
  })
  .strict();
export type MemberRegisterInput = z.infer<typeof MemberRegisterSchema>;

/** A guest registering on the public page. */
export const PublicEventRegisterSchema = z.object({
  ticketTypeId: z.string().uuid(),
  firstName: z.string().trim().min(1, 'Ad giriniz').max(60),
  lastName: z.string().trim().max(60).default(''),
  phone: PhoneSchema,
  email: z.string().trim().email('Geçersiz e-posta formatı').max(120).optional().or(z.literal('')),
  /** Explicit agreement to be contacted about this registration. */
  consent: z.literal(true, { errorMap: () => ({ message: 'Onay gereklidir' }) }),
  /** Honeypot: real visitors never fill it in; a filled one is dropped silently. */
  website: z.string().max(500).optional().default(''),
});
export type PublicEventRegisterInput = z.infer<typeof PublicEventRegisterSchema>;

/** A member (re)starting the online checkout of a held seat. */
export const MemberPayRegistrationSchema = z.object({ installmentCount: z.number().int().min(1).max(12).default(1) }).strict();
export type MemberPayRegistrationInput = z.infer<typeof MemberPayRegistrationSchema>;

export const CancelRegistrationSchema = z
  .object({
    reason: z.string().trim().max(500).nullable().optional(),
    /** Staff only: refund in full even after the refund deadline. */
    fullRefund: z.boolean().optional(),
  })
  .strict();
export type CancelRegistrationInput = z.infer<typeof CancelRegistrationSchema>;

export const RecordEventPaymentSchema = z.object({ paymentMethod: z.enum(EVENT_DESK_PAYMENT_METHODS) }).strict();
export type RecordEventPaymentInput = z.infer<typeof RecordEventPaymentSchema>;

export const EventListQuerySchema = z
  .object({
    status: z.enum(EVENT_STATUSES).optional(),
    from: IsoDate.optional(),
    to: IsoDate.optional(),
  })
  .strict();
export type EventListQuery = z.infer<typeof EventListQuerySchema>;

export const RegistrationListQuerySchema = z
  .object({
    status: z.enum(EVENT_REGISTRATION_STATUSES).optional(),
  })
  .strict();
export type RegistrationListQuery = z.infer<typeof RegistrationListQuerySchema>;

export const EventExportQuerySchema = z
  .object({
    locale: z.string().trim().min(2).max(10).optional(),
  })
  .strict();
export type EventExportQuery = z.infer<typeof EventExportQuerySchema>;

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

export interface EventOccurrenceDTO {
  id: string;
  startsAt: string;
  endsAt: string;
  resourceId: string | null;
  resourceName: string | null;
  trainerId: string | null;
  trainerName: string | null;
}

export interface EventTicketTypeDTO {
  id: string;
  name: string;
  description: string | null;
  priceAmount: string;
  currency: string;
  quantityLimit: number | null;
  soldCount: number;
  salesStartAt: string | null;
  salesEndAt: string | null;
  membersOnly: boolean;
  allowMultiple: boolean;
  creditServiceTypeId: string | null;
  creditUnits: number | null;
  isActive: boolean;
  sortOrder: number;
  onSale: boolean;
}

export interface EventDTO {
  id: string;
  branchId: string | null;
  title: string;
  description: string | null;
  kind: EventKind;
  status: EventStatus;
  capacity: number;
  seatsTaken: number;
  remainingSeats: number;
  waitlistEnabled: boolean;
  waitlistCount: number;
  visibility: EventVisibility;
  coverImageUrl: string | null;
  registrationOpensAt: string | null;
  registrationClosesAt: string | null;
  startsAt: string | null;
  endsAt: string | null;
  fullRefundHoursBefore: number;
  cancellationReason: string | null;
  occurrences: EventOccurrenceDTO[];
  ticketTypes: EventTicketTypeDTO[];
  createdAt: string;
}

export interface EventRegistrationDTO {
  id: string;
  eventId: string;
  ticketTypeId: string;
  ticketTypeName: string;
  memberId: string | null;
  contactId: string | null;
  /** Person's display name; phone only with members.contact.view. */
  displayName: string;
  phone: string | null;
  status: EventRegistrationStatus;
  source: EventRegistrationSource;
  waitlistPosition: number | null;
  amountDue: string;
  amountPaid: string;
  refundedAmount: string;
  currency: string;
  paymentId: string | null;
  paymentLink: string | null;
  paymentDueAt: string | null;
  unitsCharged: number;
  checkedInAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
}

/** Result of a registration call; `duplicate` when the person already held a live registration. */
export interface EventRegisterResultDTO {
  registration: EventRegistrationDTO;
  duplicate: boolean;
}

export interface EventCancelResultDTO {
  eventId: string;
  cancelledRegistrations: number;
  refundedPayments: number;
  refundFailures: number;
  notified: number;
}

export interface RegistrationCancelResultDTO {
  registration: EventRegistrationDTO;
  refunded: boolean;
  refundedAmount: string;
  refundedUnits: number;
  promotedFromWaitlist: number;
}

/** A member's own registration with enough of the event to show it. */
export interface MyEventRegistrationDTO extends EventRegistrationDTO {
  eventTitle: string;
  eventStatus: EventStatus;
  eventStartsAt: string | null;
  eventEndsAt: string | null;
}

/** Public (unauthenticated) view: no counts beyond remaining seats, no member-only tickets' internals. */
export interface PublicEventDTO {
  id: string;
  title: string;
  description: string | null;
  kind: EventKind;
  coverImageUrl: string | null;
  startsAt: string | null;
  endsAt: string | null;
  remainingSeats: number;
  waitlistEnabled: boolean;
  registrationOpen: boolean;
  occurrences: { startsAt: string; endsAt: string }[];
  ticketTypes: { id: string; name: string; description: string | null; priceAmount: string; currency: string; onSale: boolean }[];
  /** IANA zone the event's dates are held in: the branch's own, else the studio's. */
  timezone: string;
  /** Where it takes place: the branch when the event has one, otherwise the studio itself. Tenant data, never translated. */
  location: { name: string; address: string | null };
}
