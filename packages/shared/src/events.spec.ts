import {
  CreateEventSchema,
  CreateTicketTypeSchema,
  StaffRegisterSchema,
  evaluateEventRefund,
  occurrenceSpan,
  paymentDueAt,
  registrationBlock,
  registrationDedupeKey,
  remainingSeats,
  seatOutcome,
  ticketOnSale,
} from './events';

const d = (iso: string) => new Date(iso);

describe('capacity', () => {
  it('counts remaining seats and never goes negative', () => {
    expect(remainingSeats(10, 3)).toBe(7);
    expect(remainingSeats(3, 3)).toBe(0);
    expect(remainingSeats(3, 5)).toBe(0);
  });

  it('gives a seat while one is free, then the waitlist or nothing', () => {
    expect(seatOutcome({ capacity: 2, seatsTaken: 1, waitlistEnabled: false })).toBe('SEAT');
    expect(seatOutcome({ capacity: 2, seatsTaken: 2, waitlistEnabled: true })).toBe('WAITLIST');
    expect(seatOutcome({ capacity: 2, seatsTaken: 2, waitlistEnabled: false })).toBe('FULL');
  });
});

describe('refund policy window', () => {
  const startsAt = d('2026-10-10T10:00:00Z');

  it('refunds in full until N hours before the start, inclusive', () => {
    expect(evaluateEventRefund({ startsAt, now: d('2026-10-09T09:00:00Z'), fullRefundHoursBefore: 24 }).refundable).toBe(true);
    expect(evaluateEventRefund({ startsAt, now: d('2026-10-09T10:00:00Z'), fullRefundHoursBefore: 24 })).toEqual({
      refundable: true,
      deadline: d('2026-10-09T10:00:00Z'),
    });
  });

  it('refunds nothing after the deadline', () => {
    expect(evaluateEventRefund({ startsAt, now: d('2026-10-09T10:00:01Z'), fullRefundHoursBefore: 24 }).refundable).toBe(false);
    expect(evaluateEventRefund({ startsAt, now: d('2026-10-10T11:00:00Z'), fullRefundHoursBefore: 0 }).refundable).toBe(false);
  });

  it('0 hours means refundable until the start; no start means always refundable', () => {
    expect(evaluateEventRefund({ startsAt, now: d('2026-10-10T09:59:00Z'), fullRefundHoursBefore: 0 }).refundable).toBe(true);
    expect(evaluateEventRefund({ startsAt: null, now: d('2030-01-01T00:00:00Z'), fullRefundHoursBefore: 48 })).toEqual({ refundable: true, deadline: null });
  });
});

describe('registration window', () => {
  const base = { status: 'PUBLISHED' as const, opensAt: d('2026-10-01T00:00:00Z'), closesAt: d('2026-10-05T00:00:00Z'), endsAt: d('2026-10-06T00:00:00Z') };

  it('is open between opensAt and closesAt of a published event', () => {
    expect(registrationBlock({ ...base, now: d('2026-10-02T00:00:00Z') })).toBeNull();
    expect(registrationBlock({ ...base, now: d('2026-09-30T00:00:00Z') })).toBe('EVENT_REGISTRATION_CLOSED');
    expect(registrationBlock({ ...base, now: d('2026-10-05T00:00:01Z') })).toBe('EVENT_REGISTRATION_CLOSED');
  });

  it('refuses drafts, cancelled and finished events', () => {
    expect(registrationBlock({ ...base, status: 'DRAFT', now: d('2026-10-02T00:00:00Z') })).toBe('EVENT_NOT_PUBLISHED');
    expect(registrationBlock({ ...base, status: 'CANCELLED', now: d('2026-10-02T00:00:00Z') })).toBe('EVENT_NOT_PUBLISHED');
    expect(registrationBlock({ ...base, closesAt: null, now: d('2026-10-07T00:00:00Z') })).toBe('EVENT_REGISTRATION_CLOSED');
  });
});

describe('ticketOnSale', () => {
  const ticket = { isActive: true, salesStartAt: null, salesEndAt: d('2026-10-05T00:00:00Z'), quantityLimit: 2, soldCount: 1 };

  it('respects activity, the sales window and the quantity limit', () => {
    expect(ticketOnSale(ticket, d('2026-10-01T00:00:00Z'))).toBe(true);
    expect(ticketOnSale({ ...ticket, soldCount: 2 }, d('2026-10-01T00:00:00Z'))).toBe(false);
    expect(ticketOnSale({ ...ticket, quantityLimit: null, soldCount: 500 }, d('2026-10-01T00:00:00Z'))).toBe(true);
    expect(ticketOnSale(ticket, d('2026-10-06T00:00:00Z'))).toBe(false);
    expect(ticketOnSale({ ...ticket, isActive: false }, d('2026-10-01T00:00:00Z'))).toBe(false);
  });
});

describe('occurrenceSpan and holds', () => {
  it('spans the earliest start to the latest end', () => {
    expect(occurrenceSpan([])).toEqual({ startsAt: null, endsAt: null });
    expect(
      occurrenceSpan([
        { startsAt: d('2026-10-08T10:00:00Z'), endsAt: d('2026-10-08T11:00:00Z') },
        { startsAt: d('2026-10-01T10:00:00Z'), endsAt: d('2026-10-01T11:00:00Z') },
        { startsAt: d('2026-10-15T10:00:00Z'), endsAt: d('2026-10-15T12:00:00Z') },
      ]),
    ).toEqual({ startsAt: d('2026-10-01T10:00:00Z'), endsAt: d('2026-10-15T12:00:00Z') });
  });

  it('holds a seat for the hold length but never past the start', () => {
    const now = d('2026-10-01T10:00:00Z');
    expect(paymentDueAt(now, 3_600_000, null)).toEqual(d('2026-10-01T11:00:00Z'));
    expect(paymentDueAt(now, 3_600_000, d('2026-10-01T10:30:00Z'))).toEqual(d('2026-10-01T10:30:00Z'));
  });
});

describe('registrationDedupeKey', () => {
  it('keys a live registration per member or contact unless the ticket allows several', () => {
    expect(registrationDedupeKey({ allowMultiple: false, memberId: 'a' })).toBe('m:a');
    expect(registrationDedupeKey({ allowMultiple: false, contactId: 'b' })).toBe('c:b');
    expect(registrationDedupeKey({ allowMultiple: true, memberId: 'a' })).toBeNull();
  });
});

describe('schemas', () => {
  const occurrence = { startsAt: '2026-10-10T10:00:00Z', endsAt: '2026-10-10T12:00:00Z' };

  it('a SINGLE event has at most one occurrence and occurrences end after they start', () => {
    expect(CreateEventSchema.safeParse({ kind: 'SINGLE', title: 'A', capacity: 5, occurrences: [occurrence] }).success).toBe(true);
    expect(CreateEventSchema.safeParse({ kind: 'SINGLE', title: 'A', capacity: 5, occurrences: [occurrence, occurrence] }).success).toBe(false);
    expect(CreateEventSchema.safeParse({ kind: 'SERIES', title: 'A', capacity: 5, occurrences: [occurrence, occurrence] }).success).toBe(true);
    expect(
      CreateEventSchema.safeParse({ kind: 'SERIES', title: 'A', capacity: 5, occurrences: [{ startsAt: occurrence.endsAt, endsAt: occurrence.startsAt }] }).success,
    ).toBe(false);
  });

  it('a ticket carries a currency, and credit payment needs both the service type and the units', () => {
    expect(CreateTicketTypeSchema.safeParse({ name: 'Standart', priceAmount: 100, currency: 'EUR' }).success).toBe(true);
    expect(CreateTicketTypeSchema.safeParse({ name: 'Standart', priceAmount: 100 }).success).toBe(false);
    expect(CreateTicketTypeSchema.safeParse({ name: 'Standart', priceAmount: 0, currency: 'EUR', creditUnits: 2 }).success).toBe(false);
  });

  it('staff register exactly one of a member or a contact', () => {
    const ticketTypeId = '00000000-0000-4000-8000-000000000001';
    const id = '00000000-0000-4000-8000-000000000002';
    expect(StaffRegisterSchema.safeParse({ ticketTypeId, memberId: id }).success).toBe(true);
    expect(StaffRegisterSchema.safeParse({ ticketTypeId }).success).toBe(false);
    expect(StaffRegisterSchema.safeParse({ ticketTypeId, memberId: id, contactId: id }).success).toBe(false);
  });
});
