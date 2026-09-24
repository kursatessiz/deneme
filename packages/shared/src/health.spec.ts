import { HealthActivityType, HealthPlatform } from './enums';
import {
  HealthDailySummaryEntrySchema,
  UpsertHealthSummariesSchema,
  healthSyncIdempotencyKey,
  resolveHealthActivityType,
} from './health';

describe('resolveHealthActivityType (ServiceType -> generic workout mapping)', () => {
  it('passes through every known generic activity type', () => {
    for (const value of Object.values(HealthActivityType)) {
      expect(resolveHealthActivityType(value)).toBe(value);
    }
  });

  it('defaults to OTHER for null, undefined or an unrecognized value', () => {
    expect(resolveHealthActivityType(null)).toBe(HealthActivityType.OTHER);
    expect(resolveHealthActivityType(undefined)).toBe(HealthActivityType.OTHER);
    expect(resolveHealthActivityType('NOT_A_REAL_TYPE')).toBe(HealthActivityType.OTHER);
  });

  it('never hardcodes a sector-specific label as a fallback', () => {
    // The mapping only ever produces one of the twelve generic types.
    const result = resolveHealthActivityType('reformer-birebir');
    expect(Object.values(HealthActivityType)).toContain(result);
  });
});

describe('healthSyncIdempotencyKey', () => {
  it('is stable for the same member, booking and platform', () => {
    const a = healthSyncIdempotencyKey('member-1', 'booking-1', HealthPlatform.APPLE_HEALTH);
    const b = healthSyncIdempotencyKey('member-1', 'booking-1', HealthPlatform.APPLE_HEALTH);
    expect(a).toBe(b);
  });

  it('differs when the platform differs, since a booking may sync to both stores', () => {
    const apple = healthSyncIdempotencyKey('member-1', 'booking-1', HealthPlatform.APPLE_HEALTH);
    const connect = healthSyncIdempotencyKey('member-1', 'booking-1', HealthPlatform.HEALTH_CONNECT);
    expect(apple).not.toBe(connect);
  });

  it('differs when the booking differs', () => {
    const a = healthSyncIdempotencyKey('member-1', 'booking-1', HealthPlatform.APPLE_HEALTH);
    const b = healthSyncIdempotencyKey('member-1', 'booking-2', HealthPlatform.APPLE_HEALTH);
    expect(a).not.toBe(b);
  });
});

describe('HealthDailySummaryEntrySchema (range validation)', () => {
  it('accepts a valid entry with every optional field', () => {
    const result = HealthDailySummaryEntrySchema.safeParse({
      date: '2026-09-24',
      steps: 8000,
      activeEnergyKcal: 350.5,
      restingHeartRate: 58,
    });
    expect(result.success).toBe(true);
  });

  it('accepts an entry with no optional fields at all', () => {
    const result = HealthDailySummaryEntrySchema.safeParse({ date: '2026-09-24' });
    expect(result.success).toBe(true);
  });

  it.each([
    ['negative steps', { date: '2026-09-24', steps: -1 }],
    ['steps above 100000', { date: '2026-09-24', steps: 100_001 }],
    ['negative kcal', { date: '2026-09-24', activeEnergyKcal: -1 }],
    ['kcal above 10000', { date: '2026-09-24', activeEnergyKcal: 10_001 }],
    ['resting HR below 25', { date: '2026-09-24', restingHeartRate: 24 }],
    ['resting HR above 220', { date: '2026-09-24', restingHeartRate: 221 }],
    ['malformed date', { date: '24-09-2026', steps: 100 }],
  ])('rejects %s', (_label, input) => {
    expect(HealthDailySummaryEntrySchema.safeParse(input).success).toBe(false);
  });

  it('accepts the boundary values 0, 100000, 25 and 220', () => {
    const result = HealthDailySummaryEntrySchema.safeParse({
      date: '2026-09-24',
      steps: 100_000,
      activeEnergyKcal: 10_000,
      restingHeartRate: 25,
    });
    expect(result.success).toBe(true);
    expect(HealthDailySummaryEntrySchema.safeParse({ date: '2026-09-24', steps: 0, restingHeartRate: 220 }).success).toBe(true);
  });
});

describe('UpsertHealthSummariesSchema (batch limits)', () => {
  const day = (n: number) => `2026-08-${String(n).padStart(2, '0')}`;

  it('accepts up to 31 distinct days', () => {
    const summaries = Array.from({ length: 31 }, (_, i) => ({ date: day(i + 1), steps: 1000 }));
    expect(UpsertHealthSummariesSchema.safeParse({ summaries }).success).toBe(true);
  });

  it('rejects an empty batch', () => {
    expect(UpsertHealthSummariesSchema.safeParse({ summaries: [] }).success).toBe(false);
  });

  it('rejects more than 31 days', () => {
    const summaries = Array.from({ length: 32 }, (_, i) => ({ date: day((i % 28) + 1), steps: 1000 }));
    expect(UpsertHealthSummariesSchema.safeParse({ summaries }).success).toBe(false);
  });

  it('rejects duplicate dates within the same batch', () => {
    const summaries = [
      { date: '2026-08-01', steps: 1000 },
      { date: '2026-08-01', steps: 2000 },
    ];
    expect(UpsertHealthSummariesSchema.safeParse({ summaries }).success).toBe(false);
  });
});
