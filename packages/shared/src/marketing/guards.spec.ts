import {
  DailyCapTracker,
  EmailWarmupPlanSchema,
  adSpendAlertKey,
  adSpendCapStatuses,
  effectiveEmailCap,
  evaluateEmailFuse,
  fuseAlertKey,
  insightWeekFor,
  isFuseTarget,
  isoDateKey,
  isoWeekStart,
  nextCapWindowStart,
  parseWarmupPlan,
  pauseReasonFor,
  remainingCap,
  safeRate,
  splitByCap,
  utcMonthKey,
  warmupCapFor,
  warmupDayOf,
} from './guards';

const at = (iso: string) => new Date(iso);

describe('ISO week key (weekly summary idempotency)', () => {
  it('maps every instant of one week to the same Monday', () => {
    const monday = at('2026-10-05T00:00:00.000Z');
    for (const iso of ['2026-10-05T00:00:00.000Z', '2026-10-07T13:30:00.000Z', '2026-10-11T23:59:59.999Z']) {
      expect(isoWeekStart(at(iso)).getTime()).toBe(monday.getTime());
    }
    expect(isoWeekStart(at('2026-10-12T00:00:00.000Z')).toISOString()).toBe('2026-10-12T00:00:00.000Z');
  });

  it('summarises the last complete week against the week before, the same on every day of the current week', () => {
    const monday = insightWeekFor(at('2026-10-12T00:15:00.000Z'));
    const friday = insightWeekFor(at('2026-10-16T18:00:00.000Z'));
    expect(monday).toEqual(friday);
    expect(isoDateKey(monday.periodStart)).toBe('2026-10-05');
    expect(isoDateKey(monday.periodEnd)).toBe('2026-10-11');
    expect(monday.current.from.toISOString()).toBe('2026-10-05T00:00:00.000Z');
    expect(monday.current.to.toISOString()).toBe('2026-10-11T23:59:59.999Z');
    expect(monday.previous.from.toISOString()).toBe('2026-09-28T00:00:00.000Z');
    expect(monday.previous.to.toISOString()).toBe('2026-10-04T23:59:59.999Z');
    // The next week has its own key.
    expect(isoDateKey(insightWeekFor(at('2026-10-19T00:00:00.000Z')).periodStart)).toBe('2026-10-12');
  });

  it('handles the year boundary', () => {
    const week = insightWeekFor(at('2027-01-04T09:00:00.000Z'));
    expect(isoDateKey(week.periodStart)).toBe('2026-12-28');
    expect(isoDateKey(week.periodEnd)).toBe('2027-01-03');
  });
});

describe('deliverability fuse rates', () => {
  it('has no verdict without e-mail (zero denominators)', () => {
    expect(safeRate(0, 0)).toBeNull();
    const idle = evaluateEmailFuse({ sent: 0, bounced: 0, complained: 0, bouncePausePct: 2, complaintPausePct: 0.08 });
    expect(idle).toEqual({ bounceRate: null, complaintRate: null, tripped: [] });
    // Bounces recorded against nothing sent cannot trip the fuse either.
    expect(evaluateEmailFuse({ sent: 0, bounced: 5, complained: 1, bouncePausePct: 2, complaintPausePct: 0.08 }).tripped).toEqual([]);
  });

  it('trips only strictly above the threshold, per reason', () => {
    const base = { bouncePausePct: 2, complaintPausePct: 0.08 };
    expect(evaluateEmailFuse({ ...base, sent: 1000, bounced: 20, complained: 0 }).tripped).toEqual([]);
    expect(evaluateEmailFuse({ ...base, sent: 1000, bounced: 21, complained: 0 }).tripped).toEqual(['BOUNCE']);
    expect(evaluateEmailFuse({ ...base, sent: 10_000, bounced: 0, complained: 9 }).tripped).toEqual(['COMPLAINT']);
    expect(evaluateEmailFuse({ ...base, sent: 1000, bounced: 30, complained: 5 }).tripped).toEqual(['BOUNCE', 'COMPLAINT']);
  });

  it('stores a reason code (bounce first) and finds the campaigns it holds', () => {
    expect(pauseReasonFor([])).toBeNull();
    expect(pauseReasonFor(['BOUNCE', 'COMPLAINT'])).toBe('AUTO_BOUNCE');
    expect(pauseReasonFor(['COMPLAINT'])).toBe('AUTO_COMPLAINT');
    expect(isFuseTarget({ status: 'SENDING', channel: 'EMAIL' })).toBe(true);
    expect(isFuseTarget({ status: 'SCHEDULED', channel: null })).toBe(true);
    expect(isFuseTarget({ status: 'SENDING', channel: 'SMS' })).toBe(false);
    expect(isFuseTarget({ status: 'PAUSED', channel: 'EMAIL' })).toBe(false);
    expect(fuseAlertKey('BOUNCE')).toBe('fuse:BOUNCE');
  });
});

describe('daily cap arithmetic with deferral', () => {
  it('computes the room left under a cap', () => {
    expect(remainingCap(null, 500)).toBeNull();
    expect(remainingCap(100, 40)).toBe(60);
    expect(remainingCap(100, 100)).toBe(0);
    expect(remainingCap(100, 130)).toBe(0);
  });

  it('sends up to the cap and defers the rest', () => {
    expect(splitByCap(null, 10, 500)).toEqual({ send: 500, defer: 0 });
    expect(splitByCap(100, 40, 30)).toEqual({ send: 30, defer: 0 });
    expect(splitByCap(100, 40, 80)).toEqual({ send: 60, defer: 20 });
    expect(splitByCap(100, 100, 5)).toEqual({ send: 0, defer: 5 });
    expect(splitByCap(0, 0, 5)).toEqual({ send: 0, defer: 5 });
  });

  it('defers to the next UTC midnight', () => {
    expect(nextCapWindowStart(at('2026-10-05T23:59:59.000Z')).toISOString()).toBe('2026-10-06T00:00:00.000Z');
    expect(nextCapWindowStart(at('2026-10-05T00:00:00.000Z')).toISOString()).toBe('2026-10-06T00:00:00.000Z');
  });

  it('tracks a send loop: e-mail stops at the cap, SMS is independent, an unset channel needs both open', () => {
    const tracker = new DailyCapTracker(2, 1);
    expect(tracker.blockedBy('EMAIL')).toBeNull();
    tracker.consume('EMAIL');
    tracker.consume('EMAIL');
    expect(tracker.blockedBy('EMAIL')).toBe('EMAIL');
    expect(tracker.blockedBy('SMS')).toBeNull();
    expect(tracker.blockedBy(null)).toBe('EMAIL');
    expect(tracker.blockedBy('WHATSAPP')).toBeNull();
    tracker.consume('SMS');
    expect(tracker.blockedBy('SMS')).toBe('SMS');
    expect(tracker.remaining).toEqual({ email: 0, sms: 0 });
    // A channel without a cap never blocks.
    const uncapped = new DailyCapTracker(null, null);
    uncapped.consume('EMAIL');
    expect(uncapped.blockedBy('EMAIL')).toBeNull();
    expect(uncapped.remaining).toEqual({ email: null, sms: null });
  });
});

describe('warm-up plan lookup', () => {
  const plan = [50, 100, 200];
  const verified = at('2026-10-05T15:00:00.000Z');

  it('counts days from the UTC day the domain was verified (day 1)', () => {
    expect(warmupDayOf(verified, at('2026-10-05T23:00:00.000Z'))).toBe(1);
    expect(warmupDayOf(verified, at('2026-10-06T00:00:00.000Z'))).toBe(2);
    expect(warmupDayOf(verified, at('2026-10-07T12:00:00.000Z'))).toBe(3);
  });

  it('returns the cap of the day, and nothing before, after or without a plan', () => {
    expect(warmupCapFor(plan, verified, at('2026-10-05T10:00:00.000Z'))).toEqual({ day: 1, cap: 50 });
    expect(warmupCapFor(plan, verified, at('2026-10-07T10:00:00.000Z'))).toEqual({ day: 3, cap: 200 });
    expect(warmupCapFor(plan, verified, at('2026-10-08T10:00:00.000Z'))).toBeNull();
    expect(warmupCapFor(plan, verified, at('2026-10-04T10:00:00.000Z'))).toBeNull();
    expect(warmupCapFor(null, verified, at('2026-10-05T10:00:00.000Z'))).toBeNull();
    expect(warmupCapFor(plan, null, at('2026-10-05T10:00:00.000Z'))).toBeNull();
    expect(warmupCapFor([], verified, at('2026-10-05T10:00:00.000Z'))).toBeNull();
  });

  it('applies the lower of the configured cap and the plan; no plan means no warm-up', () => {
    const now = at('2026-10-06T10:00:00.000Z');
    expect(effectiveEmailCap({ dailyCap: 5000, warmupPlan: plan, warmupStartedAt: verified, now })).toEqual({ cap: 100, source: 'WARMUP', warmupDay: 2 });
    expect(effectiveEmailCap({ dailyCap: 80, warmupPlan: plan, warmupStartedAt: verified, now })).toEqual({ cap: 80, source: 'CONFIGURED', warmupDay: 2 });
    expect(effectiveEmailCap({ dailyCap: null, warmupPlan: plan, warmupStartedAt: verified, now })).toEqual({ cap: 100, source: 'WARMUP', warmupDay: 2 });
    // After the plan the configured cap is all that is left.
    expect(effectiveEmailCap({ dailyCap: 5000, warmupPlan: plan, warmupStartedAt: verified, now: at('2026-11-01T00:00:00.000Z') })).toEqual({ cap: 5000, source: 'CONFIGURED', warmupDay: null });
    expect(effectiveEmailCap({ dailyCap: null, warmupPlan: null, warmupStartedAt: verified, now })).toEqual({ cap: null, source: 'NONE', warmupDay: null });
  });

  it('validates a stored plan', () => {
    expect(parseWarmupPlan([50, 100])).toEqual([50, 100]);
    expect(parseWarmupPlan([])).toBeNull();
    expect(parseWarmupPlan([0, 5])).toBeNull();
    expect(parseWarmupPlan('50,100')).toBeNull();
    expect(parseWarmupPlan(null)).toBeNull();
    expect(EmailWarmupPlanSchema.safeParse(Array.from({ length: 91 }, () => 10)).success).toBe(false);
  });
});

describe('monthly ad spend cap per currency', () => {
  it('compares each currency on its own, strictly above the cap', () => {
    const list = adSpendCapStatuses({ USD: '1000.00', EUR: '500' }, { USD: '1000.0000', EUR: '500.0100', TRY: '999999' });
    expect(list.map((s) => s.currency)).toEqual(['EUR', 'USD']);
    expect(list.find((s) => s.currency === 'USD')).toMatchObject({ exceeded: false, spent: '1000.00', ratio: 1 });
    expect(list.find((s) => s.currency === 'EUR')).toMatchObject({ exceeded: true, spent: '500.01' });
  });

  it('lists a capped currency without spend at zero, and never lists a currency without a cap', () => {
    const list = adSpendCapStatuses({ GBP: '200.00' }, { USD: '50' });
    expect(list).toEqual([{ currency: 'GBP', cap: '200.00', spent: '0.00', exceeded: false, ratio: 0 }]);
    expect(adSpendCapStatuses({}, { USD: '50' })).toEqual([]);
  });

  it('compares exactly (no floating point drift) and handles a zero cap', () => {
    expect(adSpendCapStatuses({ USD: '0.30' }, { USD: '0.3000' })[0]?.exceeded).toBe(false);
    expect(adSpendCapStatuses({ USD: '0.30' }, { USD: '0.3001' })[0]?.exceeded).toBe(true);
    const zero = adSpendCapStatuses({ USD: '0' }, { USD: '1' })[0];
    expect(zero?.exceeded).toBe(true);
    expect(zero?.ratio).toBeNull();
  });

  it('keys the alert once per month and currency', () => {
    expect(utcMonthKey(at('2026-10-31T23:59:59.000Z'))).toBe('2026-10');
    expect(adSpendAlertKey('USD', at('2026-10-05T00:00:00.000Z'))).toBe('ad_cap:USD:2026-10');
    expect(adSpendAlertKey('USD', at('2026-11-01T00:00:00.000Z'))).not.toBe(adSpendAlertKey('USD', at('2026-10-05T00:00:00.000Z')));
    expect(adSpendAlertKey('EUR', at('2026-10-05T00:00:00.000Z'))).not.toBe(adSpendAlertKey('USD', at('2026-10-05T00:00:00.000Z')));
  });
});
