import { BASE_MESSAGES, BUNDLED_MESSAGES, EntitlementKind, createTranslator } from '@platform/shared';
import type { UsagePeriodStatusDTO } from '@platform/shared';

import { packageUsageLines } from './usagePeriodLines';

const tr = createTranslator({ locale: 'tr', messages: BASE_MESSAGES, fallback: BASE_MESSAGES });
const en = createTranslator({ locale: 'en', messages: BUNDLED_MESSAGES.en, fallback: BASE_MESSAGES });

const now = new Date('2026-11-08T10:00:00Z');
const month: UsagePeriodStatusDTO = {
  unit: 'MONTH',
  length: 1,
  periodStart: '2026-10-12T09:00:00Z',
  periodEnd: '2026-11-12T09:00:00Z',
  quota: 8,
  used: 5,
  remaining: 3,
  expireUnused: true,
};
const week: UsagePeriodStatusDTO = { ...month, unit: 'WEEK', periodEnd: '2026-11-09T09:00:00Z', quota: 2, used: 1, remaining: 1, expireUnused: false };
const pkg = { entitlementKind: EntitlementKind.SESSION_COUNT, endDate: '2027-01-12T09:00:00Z' };

describe('packageUsageLines', () => {
  it('returns nothing without usage periods', () => {
    expect(packageUsageLines({ ...pkg, usagePeriods: null }, tr, 'tr', now)).toEqual([]);
    expect(packageUsageLines({ ...pkg, usagePeriods: [] }, tr, 'tr', now)).toEqual([]);
    expect(packageUsageLines({ ...pkg }, tr, 'tr', now)).toEqual([]);
  });

  it('writes the used count, renewal date, badge and burn hint in Turkish', () => {
    const lines = packageUsageLines({ ...pkg, usagePeriods: [month, week] }, tr, 'tr', now);
    expect(lines.map((l) => l.text)).toEqual(['Bu hafta: 1/2 kullanıldı. Yenilenme: 9 Kasım', 'Bu ay: 5/8 kullanıldı. Yenilenme: 12 Kasım']);
    expect(lines.map((l) => l.badge)).toEqual(['Üst sınır', 'Yanar']);
    expect(lines[0].hint).toBeNull();
    expect(lines[1].hint).toBe('3 seans hakkı 12 Kasım tarihinde yanacak.');
  });

  it('follows the active locale', () => {
    const lines = packageUsageLines({ ...pkg, usagePeriods: [month] }, en, 'en', now);
    expect(lines[0].text).toBe('This month: 5/8 used. Renews: November 12');
    expect(lines[0].badge).toBe('Expires');
    expect(lines[0].hint).toBe('3 sessions will expire on November 12.');
  });

  it('does not hint for a period that ends with the package', () => {
    const lines = packageUsageLines({ ...pkg, endDate: month.periodEnd, usagePeriods: [month] }, tr, 'tr', now);
    expect(lines[0].text).toBe('Bu ay: 5/8 kullanıldı. Paket bitişi: 12 Kasım');
    expect(lines[0].hint).toBeNull();
  });
});
