import { bookingMemberName, rosterOf, trainerName, type BookingRow, type ScheduleRow } from './scheduleTypes';

describe('trainerName', () => {
  it('returns null when no trainer is assigned', () => {
    expect(trainerName(null)).toBeNull();
    expect(trainerName(undefined)).toBeNull();
  });

  it('formats the trainer full name', () => {
    const trainer = { id: 't1', membership: { user: { firstName: 'Ayşe', lastName: 'Yılmaz' } } };
    expect(trainerName(trainer)).toBe('Ayşe Yılmaz');
  });
});

describe('bookingMemberName', () => {
  const base: BookingRow = { id: 'b1', memberId: 'm1', status: 'CONFIRMED', unitsCharged: 1 };

  it('prefers the member name', () => {
    const booking: BookingRow = {
      ...base,
      member: { membership: { user: { firstName: 'Ali', lastName: 'Kaya' } } },
    };
    expect(bookingMemberName(booking)).toBe('Ali Kaya');
  });

  it('falls back to the partner label when there is no member profile', () => {
    const booking: BookingRow = { ...base, partnerConnection: { provider: 'classpass', label: 'ClassPass' } };
    expect(bookingMemberName(booking)).toBe('ClassPass');
  });

  it('falls back to a generic label otherwise', () => {
    expect(bookingMemberName(base)).toBe('Üye');
  });
});

describe('rosterOf', () => {
  it('excludes waitlist entries', () => {
    const schedule: ScheduleRow = {
      id: 's1',
      studioId: 'st1',
      branchId: null,
      serviceTypeId: 'svc1',
      resourceId: null,
      trainerId: null,
      title: 'Reformer',
      startTime: '2026-03-15T09:00:00.000Z',
      endTime: '2026-03-15T10:00:00.000Z',
      capacity: 8,
      bookedCount: 2,
      isCancelled: false,
      bookings: [
        { id: 'b1', memberId: 'm1', status: 'CONFIRMED', unitsCharged: 1 },
        { id: 'b2', memberId: 'm2', status: 'WAITLIST', unitsCharged: 1 },
      ],
    };
    expect(rosterOf(schedule).map((b) => b.id)).toEqual(['b1']);
  });
});
