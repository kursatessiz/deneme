import {
  UsageRuleSchema,
  UsageTierSchema,
  addMonthsClamped,
  burnUnits,
  endsInside,
  firstBlockingTier,
  netEventUnitsConsumed,
  netUnitsConsumed,
  parseUsageRule,
  periodAt,
  periodsEnded,
  ruleHasBurningTier,
  sortTiersFinerFirst,
  tierNominalDays,
  usageRuleKindIssue,
  type UsageTier,
} from './usage-periods';

const DAY = 86_400_000;
const iso = (d: Date | null) => (d ? d.toISOString() : null);
const d = (s: string) => new Date(s);

const month = (over: Partial<UsageTier> = {}): UsageTier => ({ unit: 'MONTH', length: 1, monthMode: 'CALENDAR', quota: 8, expireUnused: true, ...over });
const week = (over: Partial<UsageTier> = {}): UsageTier => ({ unit: 'WEEK', length: 1, quota: 2, expireUnused: false, ...over });
const days = (n: number, over: Partial<UsageTier> = {}): UsageTier => ({ unit: 'DAYS', length: n, quota: 2, expireUnused: false, ...over });

describe('UsageTierSchema', () => {
  it('accepts valid tiers of every unit', () => {
    expect(UsageTierSchema.safeParse(month()).success).toBe(true);
    expect(UsageTierSchema.safeParse(month({ monthMode: 'FIXED_DAYS', fixedMonthDays: 30 })).success).toBe(true);
    expect(UsageTierSchema.safeParse(month({ monthMode: 'FIXED_DAYS', fixedMonthDays: 31 })).success).toBe(true);
    expect(UsageTierSchema.safeParse(week()).success).toBe(true);
    expect(UsageTierSchema.safeParse(days(10)).success).toBe(true);
  });

  it.each([
    ['month length 0', month({ length: 0 })],
    ['month length 13', month({ length: 13 })],
    ['week length 9', week({ length: 9 })],
    ['week length 0', week({ length: 0 })],
    ['days length 367', days(367)],
    ['days length 0', days(0)],
    ['quota 0', week({ quota: 0 })],
    ['fractional quota', week({ quota: 1.5 })],
  ])('rejects %s', (_label, tier) => {
    expect(UsageTierSchema.safeParse(tier).success).toBe(false);
  });

  it('requires monthMode for MONTH', () => {
    expect(UsageTierSchema.safeParse({ unit: 'MONTH', length: 1, quota: 4, expireUnused: true }).success).toBe(false);
  });

  it('requires fixedMonthDays exactly when the mode is FIXED_DAYS', () => {
    expect(UsageTierSchema.safeParse(month({ monthMode: 'FIXED_DAYS' })).success).toBe(false);
    expect(UsageTierSchema.safeParse(month({ monthMode: 'CALENDAR', fixedMonthDays: 30 })).success).toBe(false);
    expect(UsageTierSchema.safeParse(month({ monthMode: 'FIXED_DAYS', fixedMonthDays: 29 as 30 })).success).toBe(false);
  });

  it('forbids monthMode and fixedMonthDays on WEEK and DAYS', () => {
    expect(UsageTierSchema.safeParse({ ...week(), monthMode: 'CALENDAR' }).success).toBe(false);
    expect(UsageTierSchema.safeParse({ ...days(5), fixedMonthDays: 30 }).success).toBe(false);
  });
});

describe('UsageRuleSchema', () => {
  const rule = (tiers: UsageTier[], extra: Record<string, unknown> = {}) => ({ version: 1, tiers, ...extra });

  it('defaults the reminder lead time to 3 days', () => {
    const parsed = UsageRuleSchema.parse(rule([month()]));
    expect(parsed.reminderDaysBefore).toBe(3);
  });

  it('accepts reminder lead times from 0 to 14 and rejects others', () => {
    expect(UsageRuleSchema.safeParse(rule([month()], { reminderDaysBefore: 0 })).success).toBe(true);
    expect(UsageRuleSchema.safeParse(rule([month()], { reminderDaysBefore: 14 })).success).toBe(true);
    expect(UsageRuleSchema.safeParse(rule([month()], { reminderDaysBefore: 15 })).success).toBe(false);
    expect(UsageRuleSchema.safeParse(rule([month()], { reminderDaysBefore: -1 })).success).toBe(false);
    expect(UsageRuleSchema.safeParse(rule([month()], { reminderDaysBefore: 2.5 })).success).toBe(false);
  });

  it('needs version 1 and one or two tiers', () => {
    expect(UsageRuleSchema.safeParse({ version: 2, tiers: [month()] }).success).toBe(false);
    expect(UsageRuleSchema.safeParse(rule([])).success).toBe(false);
    expect(UsageRuleSchema.safeParse(rule([month(), week(), days(3)])).success).toBe(false);
  });

  it('accepts the layered example: 8 per month burning, 2 per week capping', () => {
    expect(UsageRuleSchema.safeParse(rule([month(), week()])).success).toBe(true);
    expect(UsageRuleSchema.safeParse(rule([week(), month()])).success).toBe(true);
  });

  it('rejects two tiers with the same unit', () => {
    expect(UsageRuleSchema.safeParse(rule([week(), week({ length: 2, quota: 3 })])).success).toBe(false);
  });

  it('rejects a finer quota above the coarser quota', () => {
    expect(UsageRuleSchema.safeParse(rule([month({ quota: 4 }), week({ quota: 5 })])).success).toBe(false);
    expect(UsageRuleSchema.safeParse(rule([month({ quota: 4 }), week({ quota: 4 })])).success).toBe(true);
  });

  it('rejects a finer tier that is not shorter than the coarser one', () => {
    // 8 weeks (56 days) is longer than 1 month, so the month is the finer tier and its quota must not be higher.
    expect(UsageRuleSchema.safeParse(rule([month({ quota: 4 }), week({ length: 8, quota: 8 })])).success).toBe(true);
    expect(UsageRuleSchema.safeParse(rule([month({ quota: 8 }), week({ length: 8, quota: 4 })])).success).toBe(false);
    // 7 days equals 1 week.
    expect(UsageRuleSchema.safeParse(rule([days(7, { quota: 1 }), week({ quota: 2 })])).success).toBe(false);
  });
});

describe('usageRuleKindIssue', () => {
  const burning = UsageRuleSchema.parse({ version: 1, tiers: [month()] });
  const capOnly = UsageRuleSchema.parse({ version: 1, tiers: [week()] });

  it('rejects burning tiers on an unlimited package', () => {
    expect(usageRuleKindIssue(burning, 'TIME_UNLIMITED')).toBe('validation.usageUnlimitedCannotExpire');
  });

  it('accepts cap-only tiers on an unlimited package and anything on unit packages', () => {
    expect(usageRuleKindIssue(capOnly, 'TIME_UNLIMITED')).toBeNull();
    expect(usageRuleKindIssue(burning, 'SESSION_COUNT')).toBeNull();
    expect(usageRuleKindIssue(burning, 'CREDIT')).toBeNull();
  });
});

describe('parseUsageRule and helpers', () => {
  it('returns null for null, undefined and invalid stored values', () => {
    expect(parseUsageRule(null)).toBeNull();
    expect(parseUsageRule(undefined)).toBeNull();
    expect(parseUsageRule({ version: 9 })).toBeNull();
    expect(parseUsageRule({ version: 1, tiers: [month()] })?.reminderDaysBefore).toBe(3);
  });

  it('detects burning tiers', () => {
    expect(ruleHasBurningTier(UsageRuleSchema.parse({ version: 1, tiers: [month(), week()] }))).toBe(true);
    expect(ruleHasBurningTier(UsageRuleSchema.parse({ version: 1, tiers: [week()] }))).toBe(false);
  });

  it('orders tiers finer first and computes nominal days', () => {
    expect(sortTiersFinerFirst([month(), week()]).map((t) => t.unit)).toEqual(['WEEK', 'MONTH']);
    expect(tierNominalDays(month())).toBe(30);
    expect(tierNominalDays(month({ monthMode: 'FIXED_DAYS', fixedMonthDays: 31, length: 2 }))).toBe(62);
    expect(tierNominalDays(week({ length: 2 }))).toBe(14);
    expect(tierNominalDays(days(10))).toBe(10);
  });
});

describe('addMonthsClamped', () => {
  it('clamps to the end of a short month and returns to the anchor day', () => {
    const jan31 = d('2027-01-31T10:00:00Z');
    expect(iso(addMonthsClamped(jan31, 1))).toBe('2027-02-28T10:00:00.000Z');
    expect(iso(addMonthsClamped(jan31, 2))).toBe('2027-03-31T10:00:00.000Z');
    expect(iso(addMonthsClamped(jan31, 3))).toBe('2027-04-30T10:00:00.000Z');
  });

  it('uses 29 February in a leap year', () => {
    expect(iso(addMonthsClamped(d('2028-01-31T10:00:00Z'), 1))).toBe('2028-02-29T10:00:00.000Z');
    expect(iso(addMonthsClamped(d('2028-01-30T10:00:00Z'), 1))).toBe('2028-02-29T10:00:00.000Z');
  });

  it('crosses the year boundary', () => {
    expect(iso(addMonthsClamped(d('2026-11-15T08:30:00Z'), 3))).toBe('2027-02-15T08:30:00.000Z');
    expect(iso(addMonthsClamped(d('2026-12-31T08:30:00Z'), 12))).toBe('2027-12-31T08:30:00.000Z');
  });

  it('works on the studio wall clock: 01:00 Istanbul on the 1st is the previous day in UTC', () => {
    // 2027-03-01T01:00 in Istanbul (UTC+3) is 2027-02-28T22:00Z; the day of month stays the 1st.
    const start = d('2027-02-28T22:00:00Z');
    expect(iso(addMonthsClamped(start, 1, 'Europe/Istanbul'))).toBe('2027-03-31T22:00:00.000Z');
    // In UTC the same instant is the 28th, which would drift.
    expect(iso(addMonthsClamped(start, 1, 'UTC'))).toBe('2027-03-28T22:00:00.000Z');
  });

  it('keeps the local time of day across a daylight saving change', () => {
    // 09:00 in New York: EST (UTC-5) in February, EDT (UTC-4) from 14 March 2027.
    const start = d('2027-02-20T14:00:00Z');
    expect(iso(addMonthsClamped(start, 1, 'America/New_York'))).toBe('2027-03-20T13:00:00.000Z');
  });

  it('falls back to UTC for an unknown zone', () => {
    expect(iso(addMonthsClamped(d('2027-01-10T10:00:00Z'), 1, 'Not/AZone'))).toBe('2027-02-10T10:00:00.000Z');
  });
});

describe('periodAt', () => {
  it('returns null before the start', () => {
    expect(periodAt(d('2027-01-10T10:00:00Z'), week(), [], d('2027-01-10T09:59:59Z'))).toBeNull();
  });

  describe('WEEK', () => {
    const start = d('2027-01-06T10:00:00Z'); // a Wednesday: weeks are anchored at the start, not on Monday
    it('anchors at the start date', () => {
      const p = periodAt(start, week(), [], d('2027-01-09T00:00:00Z'))!;
      expect(p.index).toBe(0);
      expect(iso(p.start)).toBe('2027-01-06T10:00:00.000Z');
      expect(iso(p.end)).toBe('2027-01-13T10:00:00.000Z');
    });

    it('puts an instant exactly on a boundary into the new period', () => {
      const p = periodAt(start, week(), [], d('2027-01-13T10:00:00Z'))!;
      expect(p.index).toBe(1);
      expect(iso(p.start)).toBe('2027-01-13T10:00:00.000Z');
      const before = periodAt(start, week(), [], d('2027-01-13T09:59:59.999Z'))!;
      expect(before.index).toBe(0);
    });

    it('supports multi-week tiers', () => {
      const p = periodAt(start, week({ length: 2 }), [], d('2027-02-01T00:00:00Z'))!;
      expect(p.index).toBe(1);
      expect(iso(p.start)).toBe('2027-01-20T10:00:00.000Z');
      expect(iso(p.end)).toBe('2027-02-03T10:00:00.000Z');
    });
  });

  describe('DAYS', () => {
    it('counts fixed 24 hour periods', () => {
      const start = d('2027-03-01T00:00:00Z');
      const p = periodAt(start, days(10), [], d('2027-03-25T12:00:00Z'))!;
      expect(p.index).toBe(2);
      expect(iso(p.start)).toBe('2027-03-21T00:00:00.000Z');
      expect(iso(p.end)).toBe('2027-03-31T00:00:00.000Z');
    });
  });

  describe('MONTH FIXED_DAYS', () => {
    const start = d('2027-01-31T10:00:00Z');
    it('uses 30 day months', () => {
      const tier = month({ monthMode: 'FIXED_DAYS', fixedMonthDays: 30 });
      const p = periodAt(start, tier, [], d('2027-03-05T00:00:00Z'))!;
      expect(p.index).toBe(1);
      expect(iso(p.start)).toBe('2027-03-02T10:00:00.000Z');
      expect(iso(p.end)).toBe('2027-04-01T10:00:00.000Z');
    });

    it('uses 31 day months', () => {
      const tier = month({ monthMode: 'FIXED_DAYS', fixedMonthDays: 31 });
      const p = periodAt(start, tier, [], d('2027-03-05T00:00:00Z'))!;
      expect(p.index).toBe(1);
      expect(iso(p.start)).toBe('2027-03-03T10:00:00.000Z');
      expect(iso(p.end)).toBe('2027-04-03T10:00:00.000Z');
    });

    it('scales with the length', () => {
      const tier = month({ monthMode: 'FIXED_DAYS', fixedMonthDays: 30, length: 3 });
      const p = periodAt(start, tier, [], d('2027-04-15T00:00:00Z'))!;
      expect(p.index).toBe(0);
      expect(iso(p.end)).toBe('2027-05-01T10:00:00.000Z');
    });
  });

  describe('MONTH CALENDAR', () => {
    const tier = month();
    it('keeps the anchor day across a non leap February: Jan 31 -> Feb 28 -> Mar 31', () => {
      const start = d('2027-01-31T10:00:00Z');
      const feb = periodAt(start, tier, [], d('2027-02-10T00:00:00Z'))!;
      expect(feb.index).toBe(0);
      expect(iso(feb.end)).toBe('2027-02-28T10:00:00.000Z');
      const mar = periodAt(start, tier, [], d('2027-03-01T00:00:00Z'))!;
      expect(mar.index).toBe(1);
      expect(iso(mar.start)).toBe('2027-02-28T10:00:00.000Z');
      expect(iso(mar.end)).toBe('2027-03-31T10:00:00.000Z');
      const apr = periodAt(start, tier, [], d('2027-03-31T10:00:00Z'))!;
      expect(apr.index).toBe(2);
      expect(iso(apr.end)).toBe('2027-04-30T10:00:00.000Z');
    });

    it('uses 29 February in a leap year', () => {
      const start = d('2028-01-31T10:00:00Z');
      const p = periodAt(start, tier, [], d('2028-02-15T00:00:00Z'))!;
      expect(iso(p.end)).toBe('2028-02-29T10:00:00.000Z');
      const next = periodAt(start, tier, [], d('2028-02-29T10:00:00Z'))!;
      expect(next.index).toBe(1);
      expect(iso(next.end)).toBe('2028-03-31T10:00:00.000Z');
    });

    it('supports multi month lengths', () => {
      const start = d('2027-01-15T10:00:00Z');
      const p = periodAt(start, month({ length: 3 }), [], d('2027-08-01T00:00:00Z'))!;
      expect(p.index).toBe(2);
      expect(iso(p.start)).toBe('2027-07-15T10:00:00.000Z');
      expect(iso(p.end)).toBe('2027-10-15T10:00:00.000Z');
    });

    it('works in the studio zone', () => {
      const start = d('2027-02-28T22:00:00Z'); // 1 March 01:00 in Istanbul
      const p = periodAt(start, tier, [], d('2027-03-15T00:00:00Z'), 'Europe/Istanbul')!;
      expect(p.index).toBe(0);
      expect(iso(p.end)).toBe('2027-03-31T22:00:00.000Z'); // 1 April 01:00 local
    });
  });

  describe('freezes', () => {
    const start = d('2027-01-01T00:00:00Z');
    const freeze = { start: d('2027-01-04T00:00:00Z'), end: d('2027-01-09T00:00:00Z') }; // 5 days

    it('pushes the boundaries after a freeze by its length', () => {
      const p = periodAt(start, week(), [freeze], d('2027-01-10T00:00:00Z'))!;
      expect(p.index).toBe(0);
      expect(iso(p.start)).toBe('2027-01-01T00:00:00.000Z');
      expect(iso(p.end)).toBe('2027-01-13T00:00:00.000Z');
    });

    it('does not advance the period while frozen', () => {
      const during = periodAt(start, week(), [freeze], d('2027-01-06T00:00:00Z'))!;
      expect(during.index).toBe(0);
      const afterWithoutFreeze = periodAt(start, week(), [], d('2027-01-10T00:00:00Z'))!;
      expect(afterWithoutFreeze.index).toBe(1);
    });

    it('moves the next boundary: the second period starts 5 days later', () => {
      const p = periodAt(start, week(), [freeze], d('2027-01-13T00:00:00Z'))!;
      expect(p.index).toBe(1);
      expect(iso(p.start)).toBe('2027-01-13T00:00:00.000Z');
      expect(iso(p.end)).toBe('2027-01-20T00:00:00.000Z');
    });

    it('keeps a boundary that lands exactly on the freeze start before the freeze', () => {
      const exact = { start: d('2027-01-08T00:00:00Z'), end: d('2027-01-11T00:00:00Z') };
      const first = periodAt(start, week(), [exact], d('2027-01-07T00:00:00Z'))!;
      expect(first.index).toBe(0);
      expect(iso(first.end)).toBe('2027-01-08T00:00:00.000Z');
      const second = periodAt(start, week(), [exact], d('2027-01-09T00:00:00Z'))!;
      expect(second.index).toBe(1);
      expect(iso(second.start)).toBe('2027-01-08T00:00:00.000Z');
      expect(iso(second.end)).toBe('2027-01-18T00:00:00.000Z');
    });

    it('handles several freezes and merges overlapping ones', () => {
      const second = { start: d('2027-01-20T00:00:00Z'), end: d('2027-01-22T00:00:00Z') };
      const overlap = { start: d('2027-01-06T00:00:00Z'), end: d('2027-01-12T00:00:00Z') }; // merges with the first into 01-04 .. 01-12 (8 days)
      const p = periodAt(start, week(), [second, overlap, freeze], d('2027-01-25T00:00:00Z'))!;
      // 8 days frozen early plus 2 more: 24 wall days minus 10 frozen = 14 active days, which is exactly the start of period 2.
      expect(p.index).toBe(2);
      expect(iso(p.start)).toBe('2027-01-25T00:00:00.000Z');
      expect(iso(p.end)).toBe('2027-02-01T00:00:00.000Z');
    });

    it('works for calendar months and clips a freeze that began before the package start', () => {
      const tier = month();
      const early = { start: d('2026-12-01T00:00:00Z'), end: d('2027-01-03T00:00:00Z') }; // only 2 days after the start count
      const p = periodAt(start, tier, [early], d('2027-02-01T12:00:00Z'))!;
      expect(p.index).toBe(0);
      expect(iso(p.end)).toBe('2027-02-03T00:00:00.000Z');
    });

    it('treats an ongoing freeze (end in the future) as frozen up to now', () => {
      const ongoing = { start: d('2027-01-04T00:00:00Z'), end: d('2027-01-20T00:00:00Z') };
      const p = periodAt(start, week(), [ongoing], d('2027-01-10T00:00:00Z'))!;
      expect(p.index).toBe(0);
      expect(iso(p.end)).toBe('2027-01-24T00:00:00.000Z'); // the 16 day freeze pushes the 8 January boundary
    });

    it('ignores empty and inverted intervals', () => {
      const p = periodAt(start, week(), [{ start: d('2027-01-05T00:00:00Z'), end: d('2027-01-05T00:00:00Z') }, { start: d('2027-01-06T00:00:00Z'), end: d('2027-01-02T00:00:00Z') }], d('2027-01-08T00:00:00Z'))!;
      expect(p.index).toBe(1);
    });
  });
});

describe('periodsEnded', () => {
  const start = d('2027-01-01T00:00:00Z');

  it('lists periods whose end is not after now, oldest first', () => {
    const ended = periodsEnded(start, week(), [], d('2027-01-16T00:00:00Z'));
    expect(ended.map((p) => p.index)).toEqual([0, 1]);
    expect(iso(ended[1].end)).toBe('2027-01-15T00:00:00.000Z');
  });

  it('includes a period that ends exactly at now', () => {
    expect(periodsEnded(start, week(), [], d('2027-01-08T00:00:00Z')).map((p) => p.index)).toEqual([0]);
    expect(periodsEnded(start, week(), [], d('2027-01-07T23:59:59Z'))).toEqual([]);
  });

  it('drops periods that end after the package end date (the clipped final period)', () => {
    const end = d('2027-01-20T00:00:00Z');
    const ended = periodsEnded(start, week(), [], d('2027-03-01T00:00:00Z'), { notAfter: end });
    expect(ended.map((p) => p.index)).toEqual([0, 1]);
  });

  it('follows freezes', () => {
    const freeze = { start: d('2027-01-04T00:00:00Z'), end: d('2027-01-09T00:00:00Z') };
    expect(periodsEnded(start, week(), [freeze], d('2027-01-10T00:00:00Z'))).toEqual([]);
    expect(periodsEnded(start, week(), [freeze], d('2027-01-13T00:00:00Z')).map((p) => p.index)).toEqual([0]);
  });

  it('walks calendar months from the anchor', () => {
    const jan31 = d('2027-01-31T10:00:00Z');
    const ended = periodsEnded(jan31, month(), [], d('2027-04-01T00:00:00Z'));
    expect(ended.map((p) => iso(p.end))).toEqual(['2027-02-28T10:00:00.000Z', '2027-03-31T10:00:00.000Z']);
  });

  it('caps the number of periods', () => {
    expect(periodsEnded(start, days(1), [], d('2028-01-01T00:00:00Z'), { limit: 10 })).toHaveLength(10);
  });
});

describe('periodAt and periodsEnded agree', () => {
  it('the period containing an instant just after an ended period end is the next one', () => {
    const start = d('2027-01-31T10:00:00Z');
    const tier = month();
    for (const p of periodsEnded(start, tier, [], d('2028-06-01T00:00:00Z'))) {
      const next = periodAt(start, tier, [], p.end)!;
      expect(next.index).toBe(p.index + 1);
      expect(iso(next.start)).toBe(iso(p.end));
      const inside = periodAt(start, tier, [], new Date(p.end.getTime() - DAY / 2))!;
      expect(inside.index).toBe(p.index);
    }
  });
});

describe('netUnitsConsumed', () => {
  const b = (status: string, unitsCharged = 2, penaltyUnits = 0) => ({ status, unitsCharged, penaltyUnits });

  it('counts the full charge of confirmed and attended bookings', () => {
    expect(netUnitsConsumed(b('CONFIRMED'), 'SESSION_COUNT')).toBe(2);
    expect(netUnitsConsumed(b('ATTENDED'), 'CREDIT')).toBe(2);
  });

  it('counts only the penalty of cancellations and no-shows', () => {
    expect(netUnitsConsumed(b('CANCELLED_EARLY', 2, 0), 'SESSION_COUNT')).toBe(0);
    expect(netUnitsConsumed(b('CANCELLED_LATE', 2, 1), 'SESSION_COUNT')).toBe(1);
    expect(netUnitsConsumed(b('NO_SHOW', 2, 2), 'CREDIT')).toBe(2);
    expect(netUnitsConsumed(b('NO_SHOW', 2, 0), 'CREDIT')).toBe(0);
  });

  it('does not count a waitlist entry', () => {
    expect(netUnitsConsumed(b('WAITLIST', 0, 0), 'SESSION_COUNT')).toBe(0);
  });

  it('counts one visit per live, attended or no-show booking of an unlimited package', () => {
    expect(netUnitsConsumed(b('CONFIRMED', 1), 'TIME_UNLIMITED')).toBe(1);
    expect(netUnitsConsumed(b('ATTENDED', 3), 'TIME_UNLIMITED')).toBe(1);
    expect(netUnitsConsumed(b('NO_SHOW', 1), 'TIME_UNLIMITED')).toBe(1);
    expect(netUnitsConsumed(b('CANCELLED_EARLY', 1), 'TIME_UNLIMITED')).toBe(0);
    expect(netUnitsConsumed(b('CANCELLED_LATE', 1, 0), 'TIME_UNLIMITED')).toBe(0);
    expect(netUnitsConsumed(b('WAITLIST', 0), 'TIME_UNLIMITED')).toBe(0);
  });

  it('counts the net credits of an event registration', () => {
    expect(netEventUnitsConsumed({ unitsCharged: 3, refundedUnits: 0 })).toBe(3);
    expect(netEventUnitsConsumed({ unitsCharged: 3, refundedUnits: 3 })).toBe(0);
    expect(netEventUnitsConsumed({ unitsCharged: 1, refundedUnits: 5 })).toBe(0);
  });
});

describe('burnUnits', () => {
  it('burns the unused part of the quota', () => {
    expect(burnUnits({ quota: 8, consumed: 5, finerBurned: 0, remainingUnits: 20 })).toBe(3);
  });

  it('counts burns of finer tiers as consumed', () => {
    expect(burnUnits({ quota: 8, consumed: 4, finerBurned: 3, remainingUnits: 20 })).toBe(1);
  });

  it('never burns a negative amount when more was consumed than the quota', () => {
    expect(burnUnits({ quota: 8, consumed: 10, finerBurned: 0, remainingUnits: 20 })).toBe(0);
    expect(burnUnits({ quota: 8, consumed: 6, finerBurned: 5, remainingUnits: 20 })).toBe(0);
  });

  it('clamps to what the package still holds', () => {
    expect(burnUnits({ quota: 8, consumed: 0, finerBurned: 0, remainingUnits: 3 })).toBe(3);
    expect(burnUnits({ quota: 8, consumed: 0, finerBurned: 0, remainingUnits: 0 })).toBe(0);
    expect(burnUnits({ quota: 8, consumed: 0, finerBurned: 0, remainingUnits: -2 })).toBe(0);
  });
});

describe('endsInside and firstBlockingTier', () => {
  const coarser = { start: d('2027-01-01T00:00:00Z'), end: d('2027-02-01T00:00:00Z') };

  it('treats the coarser period as (start, end]', () => {
    expect(endsInside(d('2027-01-01T00:00:00Z'), coarser)).toBe(false);
    expect(endsInside(d('2027-01-08T00:00:00Z'), coarser)).toBe(true);
    expect(endsInside(d('2027-02-01T00:00:00Z'), coarser)).toBe(true);
    expect(endsInside(d('2027-02-01T00:00:01Z'), coarser)).toBe(false);
  });

  it('returns the first tier that cannot take the cost', () => {
    const period = { index: 0, start: coarser.start, end: coarser.end };
    const checks = [
      { tier: week({ quota: 1 }), period, consumed: 1 },
      { tier: month({ quota: 8 }), period, consumed: 8 },
    ];
    expect(firstBlockingTier(checks, 1)?.tier.unit).toBe('WEEK');
    expect(firstBlockingTier([{ tier: month({ quota: 8 }), period, consumed: 7 }], 1)).toBeNull();
    expect(firstBlockingTier([{ tier: month({ quota: 8 }), period, consumed: 7 }], 2)?.tier.unit).toBe('MONTH');
  });
});
