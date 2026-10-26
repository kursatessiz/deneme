import { BASE_MESSAGES, BUNDLED_MESSAGES } from './i18n/messages';
import { createTranslator } from './i18n/translator';
import { translateApiErrorBody } from './api-errors';
import { describeUnitExpiry, describeUsagePeriods, describeUsageRule, formatUsageDate } from './usage-periods-labels';
import type { UsagePeriodStatusDTO, UsageRule } from './usage-periods';

const tr = createTranslator({ locale: 'tr', messages: BASE_MESSAGES, fallback: BASE_MESSAGES });
const en = createTranslator({ locale: 'en', messages: BUNDLED_MESSAGES.en, fallback: BASE_MESSAGES });

const monthBurnWeekCap: UsageRule = {
  version: 1,
  reminderDaysBefore: 3,
  tiers: [
    { unit: 'MONTH', length: 1, monthMode: 'CALENDAR', quota: 8, expireUnused: true },
    { unit: 'WEEK', length: 1, quota: 2, expireUnused: false },
  ],
};

describe('describeUsageRule', () => {
  it('reads a burning month tier and a weekly cap in Turkish', () => {
    expect(describeUsageRule(tr, monthBurnWeekCap, 'SESSION_COUNT')).toBe(
      'Ayda 8 seans; kullanılmayan haklar dönem sonunda yanar. Haftada en fazla 2 seans. Yanmadan 3 gün önce üyeye hatırlatma gider.',
    );
  });

  it('reads the same rule in English', () => {
    expect(describeUsageRule(en, monthBurnWeekCap, 'SESSION_COUNT')).toBe(
      '8 sessions per month; unused ones expire at the end of each period. At most 2 sessions per week. The member is reminded 3 days before unused ones expire.',
    );
  });

  it('uses the entitlement noun, multi-length phrases, the fixed month note and skips a zero reminder', () => {
    const rule: UsageRule = {
      version: 1,
      reminderDaysBefore: 0,
      tiers: [{ unit: 'MONTH', length: 2, monthMode: 'FIXED_DAYS', fixedMonthDays: 30, quota: 10, expireUnused: true }],
    };
    expect(describeUsageRule(tr, rule, 'CREDIT')).toBe('2 ayda 10 kredi; kullanılmayan haklar dönem sonunda yanar. Ay, 30 günlük sabit dönem sayılır.');
    expect(describeUsageRule(en, rule, 'CREDIT')).toContain('10 credits every 2 months');
  });

  it('describes an unlimited cap with visits and no reminder', () => {
    const rule: UsageRule = { version: 1, reminderDaysBefore: 3, tiers: [{ unit: 'WEEK', length: 1, quota: 3, expireUnused: false }] };
    expect(describeUsageRule(tr, rule, 'TIME_UNLIMITED')).toBe('Haftada en fazla 3 giriş.');
    expect(describeUsageRule(en, rule, 'TIME_UNLIMITED')).toBe('At most 3 visits per week.');
  });
});

describe('describeUsagePeriods', () => {
  const now = new Date('2026-11-05T10:00:00Z');
  const month: UsagePeriodStatusDTO = {
    unit: 'MONTH',
    length: 1,
    periodStart: '2026-10-12T09:00:00Z',
    periodEnd: '2026-11-12T09:00:00Z',
    quota: 8,
    used: 5,
    remaining: 3,
    expireUnused: true,
    timeZone: 'UTC',
  };
  const week: UsagePeriodStatusDTO = { ...month, unit: 'WEEK', periodEnd: '2026-11-09T09:00:00Z', quota: 2, used: 2, remaining: 0, expireUnused: false };

  it('formats the used count, renewal date and burn badge by locale, finest tier first', () => {
    const lines = describeUsagePeriods(tr, [month, week], { locale: 'tr', now, entitlementKind: 'SESSION_COUNT' });
    expect(lines.map((l) => l.unit)).toEqual(['WEEK', 'MONTH']);
    expect(lines[0].text).toBe('Bu hafta: 2/2 kullanıldı. Yenilenme: 9 Kasım');
    expect(lines[0].badge).toBe('Üst sınır');
    expect(lines[1].text).toBe('Bu ay: 5/8 kullanıldı. Yenilenme: 12 Kasım');
    expect(lines[1].badge).toBe('Yanar');
    const enLines = describeUsagePeriods(en, [month], { locale: 'en', now, entitlementKind: 'SESSION_COUNT' });
    expect(enLines[0].text).toBe('This month: 5/8 used. Renews: November 12');
  });

  it('hints when unused rights burn within a week, not before and not for caps', () => {
    const soon = describeUsagePeriods(tr, [month], { locale: 'tr', now, entitlementKind: 'SESSION_COUNT' });
    expect(soon[0].hint).toBe('3 seans hakkı 12 Kasım tarihinde yanacak.');
    const early = describeUsagePeriods(tr, [month], { locale: 'tr', now: new Date('2026-10-20T10:00:00Z'), entitlementKind: 'SESSION_COUNT' });
    expect(early[0].hint).toBeNull();
    const used = describeUsagePeriods(tr, [{ ...month, used: 8, remaining: 0 }], { locale: 'tr', now, entitlementKind: 'SESSION_COUNT' });
    expect(used[0].hint).toBeNull();
    const cap = describeUsagePeriods(tr, [{ ...month, expireUnused: false }], { locale: 'tr', now, entitlementKind: 'SESSION_COUNT' });
    expect(cap[0].hint).toBeNull();
  });

  it('labels a period clipped to the package end and adds the year for another year', () => {
    const clipped = describeUsagePeriods(tr, [month], { locale: 'tr', now, entitlementKind: 'SESSION_COUNT', packageEnd: '2026-11-12T09:00:00Z' });
    expect(clipped[0].text).toBe('Bu ay: 5/8 kullanıldı. Paket bitişi: 12 Kasım');
    expect(clipped[0].hint).toBeNull();
    expect(formatUsageDate('2027-01-03T12:00:00Z', 'tr', now)).toBe('3 Ocak 2027');
  });

  it('uses the generic period name for multi-unit tiers', () => {
    const lines = describeUsagePeriods(tr, [{ ...month, length: 2 }], { locale: 'tr', now, entitlementKind: 'SESSION_COUNT' });
    expect(lines[0].text.startsWith('Bu dönem: ')).toBe(true);
  });
});

describe('studio time zone', () => {
  const now = new Date('2026-11-05T10:00:00Z');
  const month: UsagePeriodStatusDTO = {
    unit: 'MONTH', length: 1, periodStart: '2026-10-12T21:30:00Z', periodEnd: '2026-11-12T21:30:00Z',
    quota: 8, used: 5, remaining: 3, expireUnused: true, timeZone: 'Europe/Istanbul',
  };
  it('formats the period end in the studio zone, not the device zone', () => {
    // 21:30Z is already 13 November in Istanbul (UTC+3) but still 12 November in UTC.
    const istanbul = describeUsagePeriods(tr, [month], { locale: 'tr', now, entitlementKind: 'SESSION_COUNT' });
    expect(istanbul[0].text).toBe('Bu ay: 5/8 kullanıldı. Yenilenme: 13 Kasım');
    const utc = describeUsagePeriods(tr, [{ ...month, timeZone: 'UTC' }], { locale: 'tr', now, entitlementKind: 'SESSION_COUNT' });
    expect(utc[0].text).toBe('Bu ay: 5/8 kullanıldı. Yenilenme: 12 Kasım');
  });
  it('formats burn history rows in the given zone', () => {
    const row = { tierUnit: 'MONTH' as const, periodStart: '2026-09-12T21:30:00Z', periodEnd: '2026-10-12T21:30:00Z', units: 3 };
    expect(describeUnitExpiry(tr, row, { locale: 'tr', now, entitlementKind: 'SESSION_COUNT', timeZone: 'Europe/Istanbul' })).toBe('Aylık, 13 Eylül - 13 Ekim: 3 seans yandı');
  });
});

describe('describeUnitExpiry', () => {
  it('names the tier, the range and the burned units', () => {
    const text = describeUnitExpiry(
      tr,
      { tierUnit: 'MONTH', periodStart: '2026-09-12T09:00:00Z', periodEnd: '2026-10-12T09:00:00Z', units: 3 },
      { locale: 'tr', now: new Date('2026-11-05T00:00:00Z'), entitlementKind: 'SESSION_COUNT' },
    );
    expect(text).toBe('Aylık, 12 Eylül - 12 Ekim: 3 seans yandı');
  });
});

describe('periodQuotaReached api error', () => {
  it('renders in both languages with its variables', () => {
    const body = { message: 'x', messageKey: 'apiErrors.schedules.periodQuotaReached', params: { period: 'ay', date: '12 Kasım' } };
    expect(translateApiErrorBody(body, tr)?.message).toBe('Bu paketin ay hakkı doldu; 12 Kasım tarihinde yenilenir.');
    expect(translateApiErrorBody(body, en)?.message).toBe('The ay allowance of this package is used up; it renews on 12 Kasım.');
  });
});
