import { DEFAULT_CHURN_WEIGHTS } from '@platform/shared';
import { scoreMemberChurnRisk, type ChurnMemberSignals } from './churn-scoring';

const NOW = new Date('2026-09-24T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

function baseSignals(overrides: Partial<ChurnMemberSignals> = {}): ChurnMemberSignals {
  return {
    memberId: 'member-1',
    joinedAt: new Date(NOW.getTime() - 400 * DAY), // well past onboarding
    attendedLast28: 4,
    attendedPrev28: 4,
    daysSinceLastAttendance: 2,
    activePackage: null,
    hasRenewalPurchased: false,
    lateCancelsLast28: 0,
    noShowsLast28: 0,
    failedPaymentAttemptsLast28: 0,
    ...overrides,
  };
}

describe('scoreMemberChurnRisk', () => {
  it('scores a healthy, engaged member as LOW with no reasons', () => {
    const result = scoreMemberChurnRisk(baseSignals(), DEFAULT_CHURN_WEIGHTS, NOW);
    expect(result.score).toBe(0);
    expect(result.level).toBe('LOW');
    expect(result.onboarding).toBe(false);
    expect(result.reasons).toEqual([]);
  });

  describe('onboarding flag', () => {
    it('flags a member inside the onboarding window and skips attendance/inactivity signals', () => {
      const signals = baseSignals({
        joinedAt: new Date(NOW.getTime() - 10 * DAY),
        attendedLast28: 0,
        attendedPrev28: 4,
        daysSinceLastAttendance: null,
      });
      const result = scoreMemberChurnRisk(signals, DEFAULT_CHURN_WEIGHTS, NOW);
      expect(result.onboarding).toBe(true);
      expect(result.reasons).toEqual([expect.objectContaining({ key: 'onboarding', points: 0 })]);
      expect(result.score).toBe(0);
    });

    it('a member joined exactly at the onboarding boundary is no longer onboarding', () => {
      const signals = baseSignals({ joinedAt: new Date(NOW.getTime() - DEFAULT_CHURN_WEIGHTS.onboardingDays * DAY) });
      const result = scoreMemberChurnRisk(signals, DEFAULT_CHURN_WEIGHTS, NOW);
      expect(result.onboarding).toBe(false);
    });

    it('a null joinedAt is treated as not onboarding', () => {
      const signals = baseSignals({ joinedAt: null });
      const result = scoreMemberChurnRisk(signals, DEFAULT_CHURN_WEIGHTS, NOW);
      expect(result.onboarding).toBe(false);
    });
  });

  describe('attendance decline signal', () => {
    it('adds points proportional to the drop, capped at the weight', () => {
      // 100% drop (4 -> 0) triggers the full weight since ratio threshold is 0.5.
      const signals = baseSignals({ attendedLast28: 0, attendedPrev28: 4 });
      const result = scoreMemberChurnRisk(signals, DEFAULT_CHURN_WEIGHTS, NOW);
      const reason = result.reasons.find((r) => r.key === 'attendance_declining');
      expect(reason?.points).toBe(DEFAULT_CHURN_WEIGHTS.attendanceDeclineWeight);
    });

    it('a partial drop below the ratio threshold gives partial points', () => {
      // 25% drop with a 50% trigger ratio -> half the weight.
      const signals = baseSignals({ attendedLast28: 3, attendedPrev28: 4 });
      const result = scoreMemberChurnRisk(signals, DEFAULT_CHURN_WEIGHTS, NOW);
      const reason = result.reasons.find((r) => r.key === 'attendance_declining');
      expect(reason?.points).toBe(Math.round(DEFAULT_CHURN_WEIGHTS.attendanceDeclineWeight * 0.5));
    });

    it('no signal when attendance improved or stayed flat', () => {
      const signals = baseSignals({ attendedLast28: 5, attendedPrev28: 4 });
      const result = scoreMemberChurnRisk(signals, DEFAULT_CHURN_WEIGHTS, NOW);
      expect(result.reasons.find((r) => r.key === 'attendance_declining')).toBeUndefined();
    });

    it('no signal when there was no prior-period attendance to compare against', () => {
      const signals = baseSignals({ attendedLast28: 0, attendedPrev28: 0 });
      const result = scoreMemberChurnRisk(signals, DEFAULT_CHURN_WEIGHTS, NOW);
      expect(result.reasons.find((r) => r.key === 'attendance_declining')).toBeUndefined();
    });
  });

  describe('inactivity signal', () => {
    it('never attended gets the full weight', () => {
      const signals = baseSignals({ daysSinceLastAttendance: null });
      const result = scoreMemberChurnRisk(signals, DEFAULT_CHURN_WEIGHTS, NOW);
      const reason = result.reasons.find((r) => r.key === 'inactive');
      expect(reason?.points).toBe(DEFAULT_CHURN_WEIGHTS.inactivityWeight);
    });

    it('below the threshold contributes nothing', () => {
      const signals = baseSignals({ daysSinceLastAttendance: DEFAULT_CHURN_WEIGHTS.inactivityThresholdDays - 1 });
      const result = scoreMemberChurnRisk(signals, DEFAULT_CHURN_WEIGHTS, NOW);
      expect(result.reasons.find((r) => r.key === 'inactive')).toBeUndefined();
    });

    it('at the max-days mark caps at the full weight', () => {
      const signals = baseSignals({ daysSinceLastAttendance: DEFAULT_CHURN_WEIGHTS.inactivityMaxDays * 3 });
      const result = scoreMemberChurnRisk(signals, DEFAULT_CHURN_WEIGHTS, NOW);
      const reason = result.reasons.find((r) => r.key === 'inactive');
      expect(reason?.points).toBe(DEFAULT_CHURN_WEIGHTS.inactivityWeight);
    });
  });

  describe('package ending soon signal', () => {
    const pkg = (overrides: Partial<ChurnMemberSignals['activePackage']> = {}) => ({
      status: 'ACTIVE' as const,
      entitlementKind: 'SESSION_COUNT' as const,
      startDate: new Date(NOW.getTime() - 20 * DAY),
      endDate: new Date(NOW.getTime() + 3 * DAY),
      remainingUnits: 8,
      totalUnits: 10,
      ...overrides,
    });

    it('triggers when ending within the window and no renewal purchased', () => {
      const signals = baseSignals({ activePackage: pkg(), hasRenewalPurchased: false });
      const result = scoreMemberChurnRisk(signals, DEFAULT_CHURN_WEIGHTS, NOW);
      expect(result.reasons.some((r) => r.key === 'package_ending_soon')).toBe(true);
    });

    it('does not trigger when a renewal is already purchased', () => {
      const signals = baseSignals({ activePackage: pkg(), hasRenewalPurchased: true });
      const result = scoreMemberChurnRisk(signals, DEFAULT_CHURN_WEIGHTS, NOW);
      expect(result.reasons.some((r) => r.key === 'package_ending_soon')).toBe(false);
    });

    it('does not trigger when ending is outside the window', () => {
      const signals = baseSignals({ activePackage: pkg({ endDate: new Date(NOW.getTime() + 30 * DAY) }) });
      const result = scoreMemberChurnRisk(signals, DEFAULT_CHURN_WEIGHTS, NOW);
      expect(result.reasons.some((r) => r.key === 'package_ending_soon')).toBe(false);
    });
  });

  describe('low units signal', () => {
    it('triggers for session/credit packages at or below the threshold', () => {
      const signals = baseSignals({
        activePackage: {
          status: 'ACTIVE',
          entitlementKind: 'CREDIT',
          startDate: new Date(NOW.getTime() - 5 * DAY),
          endDate: new Date(NOW.getTime() + 60 * DAY),
          remainingUnits: 1,
          totalUnits: 20,
        },
      });
      const result = scoreMemberChurnRisk(signals, DEFAULT_CHURN_WEIGHTS, NOW);
      expect(result.reasons.some((r) => r.key === 'package_low_units')).toBe(true);
    });

    it('never triggers for TIME_UNLIMITED packages', () => {
      const signals = baseSignals({
        activePackage: {
          status: 'ACTIVE',
          entitlementKind: 'TIME_UNLIMITED',
          startDate: new Date(NOW.getTime() - 5 * DAY),
          endDate: new Date(NOW.getTime() + 60 * DAY),
          remainingUnits: null,
          totalUnits: null,
        },
      });
      const result = scoreMemberChurnRisk(signals, DEFAULT_CHURN_WEIGHTS, NOW);
      expect(result.reasons.some((r) => r.key === 'package_low_units')).toBe(false);
    });
  });

  describe('frozen package signal', () => {
    it('adds the full frozen weight', () => {
      const signals = baseSignals({
        activePackage: {
          status: 'FROZEN',
          entitlementKind: 'SESSION_COUNT',
          startDate: new Date(NOW.getTime() - 5 * DAY),
          endDate: new Date(NOW.getTime() + 60 * DAY),
          remainingUnits: 8,
          totalUnits: 10,
        },
      });
      const result = scoreMemberChurnRisk(signals, DEFAULT_CHURN_WEIGHTS, NOW);
      const reason = result.reasons.find((r) => r.key === 'package_frozen');
      expect(reason?.points).toBe(DEFAULT_CHURN_WEIGHTS.packageFrozenWeight);
    });
  });

  describe('late cancels / no-shows signal', () => {
    it('scales with count up to the max, then caps', () => {
      const atMax = scoreMemberChurnRisk(
        baseSignals({ lateCancelsLast28: DEFAULT_CHURN_WEIGHTS.lateCancelNoShowMaxCount, noShowsLast28: 0 }),
        DEFAULT_CHURN_WEIGHTS,
        NOW,
      );
      expect(atMax.reasons.find((r) => r.key === 'late_cancels_no_shows')?.points).toBe(DEFAULT_CHURN_WEIGHTS.lateCancelNoShowWeight);

      const beyondMax = scoreMemberChurnRisk(
        baseSignals({ lateCancelsLast28: DEFAULT_CHURN_WEIGHTS.lateCancelNoShowMaxCount * 5, noShowsLast28: 0 }),
        DEFAULT_CHURN_WEIGHTS,
        NOW,
      );
      expect(beyondMax.reasons.find((r) => r.key === 'late_cancels_no_shows')?.points).toBe(DEFAULT_CHURN_WEIGHTS.lateCancelNoShowWeight);
    });
  });

  describe('failed payments signal', () => {
    it('only fires when PaymentAttempt data is present, scaling to the max count', () => {
      const none = scoreMemberChurnRisk(baseSignals({ failedPaymentAttemptsLast28: 0 }), DEFAULT_CHURN_WEIGHTS, NOW);
      expect(none.reasons.find((r) => r.key === 'failed_payments')).toBeUndefined();

      const capped = scoreMemberChurnRisk(
        baseSignals({ failedPaymentAttemptsLast28: DEFAULT_CHURN_WEIGHTS.failedPaymentMaxCount * 10 }),
        DEFAULT_CHURN_WEIGHTS,
        NOW,
      );
      expect(capped.reasons.find((r) => r.key === 'failed_payments')?.points).toBe(DEFAULT_CHURN_WEIGHTS.failedPaymentWeight);
    });
  });

  describe('overall score cap and level thresholds', () => {
    it('never exceeds 100 even when every signal is fully triggered', () => {
      const signals = baseSignals({
        attendedLast28: 0,
        attendedPrev28: 10,
        daysSinceLastAttendance: null,
        activePackage: {
          status: 'FROZEN',
          entitlementKind: 'CREDIT',
          startDate: new Date(NOW.getTime() - 5 * DAY),
          endDate: NOW,
          remainingUnits: 0,
          totalUnits: 10,
        },
        hasRenewalPurchased: false,
        lateCancelsLast28: 10,
        noShowsLast28: 10,
        failedPaymentAttemptsLast28: 10,
      });
      const result = scoreMemberChurnRisk(signals, DEFAULT_CHURN_WEIGHTS, NOW);
      expect(result.score).toBeLessThanOrEqual(100);
      expect(result.level).toBe('HIGH');
    });

    it('respects tenant-configured thresholds', () => {
      const weights = { ...DEFAULT_CHURN_WEIGHTS, mediumThreshold: 5, highThreshold: 10 };
      const signals = baseSignals({ daysSinceLastAttendance: null });
      const result = scoreMemberChurnRisk(signals, weights, NOW);
      expect(result.level).toBe('HIGH');
    });
  });
});
