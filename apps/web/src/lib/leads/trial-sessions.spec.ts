import { upcomingTrialSessions, type TrialSessionRow } from './trial-sessions';

const NOW = new Date(2026, 2, 1, 9, 0, 0, 0);

function session(overrides: Partial<TrialSessionRow>): TrialSessionRow {
  return {
    id: 's1',
    branchId: null,
    startTime: new Date(2026, 2, 2, 10, 0, 0, 0).toISOString(),
    endTime: new Date(2026, 2, 2, 11, 0, 0, 0).toISOString(),
    isCancelled: false,
    bookedCount: 0,
    capacity: 10,
    title: 'Mat Pilates',
    ...overrides,
  };
}

describe('upcomingTrialSessions', () => {
  it('keeps sessions starting within the next 14 days and drops the rest', () => {
    const withinRange = session({ id: 'in', startTime: new Date(2026, 2, 10).toISOString() });
    const tooFar = session({ id: 'far', startTime: new Date(2026, 2, 20).toISOString() });
    const past = session({ id: 'past', startTime: new Date(2026, 1, 20).toISOString() });
    const result = upcomingTrialSessions([withinRange, tooFar, past], { now: NOW });
    expect(result.map((s) => s.id)).toEqual(['in']);
  });

  it('drops cancelled and fully booked sessions', () => {
    const cancelled = session({ id: 'cancelled', isCancelled: true });
    const full = session({ id: 'full', bookedCount: 10, capacity: 10 });
    const open = session({ id: 'open' });
    const result = upcomingTrialSessions([cancelled, full, open], { now: NOW });
    expect(result.map((s) => s.id)).toEqual(['open']);
  });

  it('filters by branch when a branchId is given', () => {
    const branchA = session({ id: 'a', branchId: 'branch-a' });
    const branchB = session({ id: 'b', branchId: 'branch-b' });
    const result = upcomingTrialSessions([branchA, branchB], { now: NOW, branchId: 'branch-a' });
    expect(result.map((s) => s.id)).toEqual(['a']);
  });

  it('sorts by start time ascending', () => {
    const later = session({ id: 'later', startTime: new Date(2026, 2, 5).toISOString() });
    const earlier = session({ id: 'earlier', startTime: new Date(2026, 2, 3).toISOString() });
    const result = upcomingTrialSessions([later, earlier], { now: NOW });
    expect(result.map((s) => s.id)).toEqual(['earlier', 'later']);
  });
});
