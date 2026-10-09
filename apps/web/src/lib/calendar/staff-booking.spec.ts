import { bookableSessions, buildBookBody, isSessionFull, repeatIntervalConflict, usablePackages } from './staff-booking';
import type { MemberPackageRow } from '@/lib/members/types';

const ID = '11111111-1111-4111-8111-111111111111';

function pkg(over: Partial<MemberPackageRow>): MemberPackageRow {
  return {
    id: 'p1',
    packageDefinitionId: 'd1',
    entitlementKind: 'SESSION_COUNT',
    totalUnits: 10,
    usedUnits: 0,
    remainingUnits: 5,
    status: 'ACTIVE',
    startDate: '2026-01-01T00:00:00.000Z',
    endDate: '2027-01-01T00:00:00.000Z',
    frozenUntil: null,
    ...over,
  };
}

describe('repeatIntervalConflict', () => {
  it('reads count and date from the rule error', () => {
    expect(
      repeatIntervalConflict({
        status: 400,
        code: 'apiErrors.schedules.minRepeatIntervalNotElapsed',
        params: { count: 2, date: '2026-10-12T14:00:00.000Z' },
      }),
    ).toEqual({ count: 2, date: '2026-10-12T14:00:00.000Z' });
  });

  it('ignores other errors and incomplete params', () => {
    expect(repeatIntervalConflict({ status: 400, code: 'apiErrors.schedules.sessionFull' })).toBeNull();
    expect(repeatIntervalConflict({ status: 400, code: 'apiErrors.schedules.minRepeatIntervalNotElapsed', params: { count: 2 } })).toBeNull();
    expect(repeatIntervalConflict(null)).toBeNull();
  });
});

describe('isSessionFull', () => {
  it('matches the full-session code only', () => {
    expect(isSessionFull({ code: 'apiErrors.schedules.sessionFull' })).toBe(true);
    expect(isSessionFull({ code: 'apiErrors.schedules.sessionCancelled' })).toBe(false);
  });
});

describe('usablePackages', () => {
  const now = new Date('2026-10-09T00:00:00.000Z');
  const defs = [{ id: 'd1', services: [{ serviceTypeId: 's1' }] }];

  it('keeps active packages that cover the service and have units', () => {
    expect(usablePackages([pkg({})], defs, 's1', now)).toHaveLength(1);
    expect(usablePackages([pkg({})], defs, 's2', now)).toHaveLength(0);
  });

  it('drops frozen, expired and depleted packages', () => {
    expect(usablePackages([pkg({ status: 'FROZEN' })], defs, 's1', now)).toHaveLength(0);
    expect(usablePackages([pkg({ endDate: '2026-01-02T00:00:00.000Z' })], defs, 's1', now)).toHaveLength(0);
    expect(usablePackages([pkg({ remainingUnits: 0 })], defs, 's1', now)).toHaveLength(0);
  });

  it('keeps unlimited packages and offers all usable ones when definitions are unknown', () => {
    expect(usablePackages([pkg({ entitlementKind: 'TIME_UNLIMITED', remainingUnits: null })], defs, 's1', now)).toHaveLength(1);
    expect(usablePackages([pkg({})], null, 's9', now)).toHaveLength(1);
  });
});

describe('buildBookBody', () => {
  it('omits optional fields that are not set', () => {
    expect(buildBookBody({ studioId: ID, scheduleId: ID, memberId: ID, memberPackageId: '', resourceIds: [''], overrideRepeatInterval: false })).toEqual({
      studioId: ID,
      scheduleId: ID,
      memberId: ID,
      resourceIds: [],
    });
  });

  it('adds the package, spots and the override flag', () => {
    expect(
      buildBookBody({ studioId: ID, scheduleId: ID, memberId: ID, memberPackageId: 'pk', resourceIds: ['r1', ''], overrideRepeatInterval: true }),
    ).toEqual({ studioId: ID, scheduleId: ID, memberId: ID, resourceIds: ['r1'], memberPackageId: 'pk', overrideRepeatInterval: true });
  });
});

describe('bookableSessions', () => {
  const now = new Date('2026-10-09T10:00:00.000Z');
  const base = { serviceTypeId: 's1', isCancelled: false, capacity: 2, bookedCount: 1, endTime: '2026-10-10T10:00:00.000Z' };

  it('keeps upcoming sessions with a free place', () => {
    expect(bookableSessions([base], null, now)).toHaveLength(1);
  });

  it('drops cancelled, full and finished sessions', () => {
    expect(bookableSessions([{ ...base, isCancelled: true }], null, now)).toHaveLength(0);
    expect(bookableSessions([{ ...base, bookedCount: 2 }], null, now)).toHaveLength(0);
    expect(bookableSessions([{ ...base, endTime: '2026-10-09T09:00:00.000Z' }], null, now)).toHaveLength(0);
  });

  it('limits to covered service types when given', () => {
    expect(bookableSessions([base], new Set(['s2']), now)).toHaveLength(0);
    expect(bookableSessions([base], new Set(['s1']), now)).toHaveLength(1);
  });
});
