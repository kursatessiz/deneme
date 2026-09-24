import {
  AutomationRuleParamsSchema,
  CreateAutomationRuleSchema,
  deferForQuietHours,
  isTransactionalRuleType,
  isWithinQuietHours,
} from './automations';

describe('isTransactionalRuleType', () => {
  it('marks reminders and follow-ups as transactional', () => {
    expect(isTransactionalRuleType('BOOKING_REMINDER')).toBe(true);
    expect(isTransactionalRuleType('FIRST_CLASS_FOLLOW_UP')).toBe(true);
    expect(isTransactionalRuleType('NO_SHOW_FOLLOW_UP')).toBe(true);
    expect(isTransactionalRuleType('PACKAGE_EXPIRING')).toBe(true);
  });

  it('marks win-back and birthday as marketing', () => {
    expect(isTransactionalRuleType('WIN_BACK')).toBe(false);
    expect(isTransactionalRuleType('BIRTHDAY')).toBe(false);
  });
});

describe('AutomationRuleParamsSchema', () => {
  it('accepts a valid WIN_BACK payload', () => {
    const result = AutomationRuleParamsSchema.safeParse({ type: 'WIN_BACK', noAttendanceDays: 30 });
    expect(result.success).toBe(true);
  });

  it('rejects PACKAGE_EXPIRING with neither threshold set', () => {
    const result = CreateAutomationRuleSchema.safeParse({
      type: 'PACKAGE_EXPIRING',
      name: 'Paket bitiyor',
      templateKey: 'PACKAGE_EXPIRING',
      params: { type: 'PACKAGE_EXPIRING' },
    });
    expect(result.success).toBe(false);
  });

  it('accepts PACKAGE_EXPIRING with a days threshold', () => {
    const result = CreateAutomationRuleSchema.safeParse({
      type: 'PACKAGE_EXPIRING',
      name: 'Paket bitiyor',
      templateKey: 'PACKAGE_EXPIRING',
      params: { type: 'PACKAGE_EXPIRING', daysBefore: 5 },
    });
    expect(result.success).toBe(true);
  });

  it('rejects a mismatch between type and params.type', () => {
    const result = CreateAutomationRuleSchema.safeParse({
      type: 'BIRTHDAY',
      name: 'Dogum gunu',
      templateKey: 'BIRTHDAY',
      params: { type: 'WIN_BACK', noAttendanceDays: 10 },
    });
    expect(result.success).toBe(false);
  });
});

describe('quiet hours (Europe/Istanbul, UTC+3, no DST)', () => {
  const tz = 'Europe/Istanbul';

  it('flags 22:00 local as within quiet hours', () => {
    // 22:00 Istanbul = 19:00 UTC
    const date = new Date('2026-01-15T19:00:00.000Z');
    expect(isWithinQuietHours(date, tz)).toBe(true);
  });

  it('flags 10:00 local as outside quiet hours', () => {
    // 10:00 Istanbul = 07:00 UTC
    const date = new Date('2026-01-15T07:00:00.000Z');
    expect(isWithinQuietHours(date, tz)).toBe(false);
  });

  it('flags exactly 09:00 local as outside quiet hours', () => {
    const date = new Date('2026-01-15T06:00:00.000Z');
    expect(isWithinQuietHours(date, tz)).toBe(false);
  });

  it('flags exactly 21:00 local as within quiet hours', () => {
    const date = new Date('2026-01-15T18:00:00.000Z');
    expect(isWithinQuietHours(date, tz)).toBe(true);
  });

  it('defers a 23:30 local send to the next 09:00 local', () => {
    // 23:30 Istanbul on Jan 15 = 20:30 UTC
    const date = new Date('2026-01-15T20:30:00.000Z');
    const deferred = deferForQuietHours(date, tz);
    // 09:00 Istanbul on Jan 16 = 06:00 UTC
    expect(deferred.toISOString()).toBe('2026-01-16T06:00:00.000Z');
  });

  it('defers a 06:00 local send (before quiet hours end) to 09:00 the same day', () => {
    // 06:00 Istanbul = 03:00 UTC
    const date = new Date('2026-01-15T03:00:00.000Z');
    const deferred = deferForQuietHours(date, tz);
    expect(deferred.toISOString()).toBe('2026-01-15T06:00:00.000Z');
  });

  it('leaves a daytime send untouched', () => {
    const date = new Date('2026-01-15T10:00:00.000Z');
    expect(deferForQuietHours(date, tz).getTime()).toBe(date.getTime());
  });
});
