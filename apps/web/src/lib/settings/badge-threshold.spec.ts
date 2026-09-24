import { BadgeKind } from '@platform/shared';
import { defaultThresholdFor, describeThreshold } from './badge-threshold';

describe('defaultThresholdFor', () => {
  it('returns a threshold whose kind matches the requested badge kind', () => {
    for (const kind of Object.values(BadgeKind)) {
      expect(defaultThresholdFor(kind).kind).toBe(kind);
    }
  });
});

describe('describeThreshold', () => {
  it('summarises a milestone threshold', () => {
    expect(describeThreshold({ kind: BadgeKind.MILESTONE_SESSIONS, sessions: 25 })).toBe('25 seans');
  });

  it('summarises a streak threshold', () => {
    expect(describeThreshold({ kind: BadgeKind.STREAK_WEEKS, weeks: 6, minSessionsPerWeek: 2 })).toBe(
      '6 hafta üst üste (haftada en az 2 seans)',
    );
  });

  it('summarises an early bird threshold with a zero-padded hour', () => {
    expect(describeThreshold({ kind: BadgeKind.EARLY_BIRD, beforeHour: 7 })).toBe("Saat 07:00'dan önce başlayan seans");
  });

  it('summarises a variety threshold', () => {
    expect(describeThreshold({ kind: BadgeKind.VARIETY, distinctServiceTypes: 4 })).toBe('4 farklı hizmet türü');
  });
});
