import type { ChurnReasonDTO, ChurnRiskLevel, ChurnWeights } from '@platform/shared';
import { CHURN_REASON_LABELS } from '@platform/shared';

/**
 * Pure churn-risk scoring function (W12). No database or NestJS dependency;
 * ChurnService builds these inputs from Prisma rows (batched per studio, see
 * churn.service.ts) and feeds them in. See docs/CHURN.md for the formula in
 * prose and the reasoning behind each signal.
 *
 * Every signal contributes between 0 and its configured weight (points), so
 * a triggered signal never exceeds its own cap; the total is clamped to
 * [0, 100]. A member inside their first `onboardingDays` skips the
 * attendance-trend and inactivity signals -- there is not yet 28+28 days of
 * history to judge a trend from -- and gets an informational (0-point)
 * "onboarding" reason instead.
 */

export type ActivePackageStatus = 'ACTIVE' | 'FROZEN';
export type PackageEntitlementKind = 'SESSION_COUNT' | 'TIME_UNLIMITED' | 'CREDIT';

export interface ChurnActivePackageSignal {
  status: ActivePackageStatus;
  entitlementKind: PackageEntitlementKind;
  startDate: Date;
  endDate: Date;
  remainingUnits: number | null;
  totalUnits: number | null;
}

export interface ChurnMemberSignals {
  memberId: string;
  /** Membership.joinedAt; null members (never joined/no date) are treated as not onboarding. */
  joinedAt: Date | null;
  /** Attended sessions in [now-28d, now). */
  attendedLast28: number;
  /** Attended sessions in [now-56d, now-28d). */
  attendedPrev28: number;
  /** Days since the member's last attended session; null if they never attended. */
  daysSinceLastAttendance: number | null;
  /** The member's current active/frozen package, if any (the one with the latest end date). */
  activePackage: ChurnActivePackageSignal | null;
  /** True when a package (or auto-renewing subscription) already covers the time after activePackage ends. */
  hasRenewalPurchased: boolean;
  /** Late cancellations in the last 28 days. */
  lateCancelsLast28: number;
  /** No-shows in the last 28 days. */
  noShowsLast28: number;
  /** Failed dunning payment attempts in the last 28 days (0 when PaymentAttempt has no rows for this member). */
  failedPaymentAttemptsLast28: number;
}

export interface ChurnScoreResult {
  score: number;
  level: ChurnRiskLevel;
  onboarding: boolean;
  reasons: ChurnReasonDTO[];
}

/** Clamp `value` to [0, weight] and round to the nearest integer point. */
function scaled(weight: number, ratio: number): number {
  return Math.round(weight * Math.max(0, Math.min(1, ratio)));
}

function levelFor(score: number, weights: ChurnWeights): ChurnRiskLevel {
  if (score >= weights.highThreshold) return 'HIGH';
  if (score >= weights.mediumThreshold) return 'MEDIUM';
  return 'LOW';
}

export function scoreMemberChurnRisk(signals: ChurnMemberSignals, weights: ChurnWeights, now: Date): ChurnScoreResult {
  const reasons: ChurnReasonDTO[] = [];
  let score = 0;

  const daysSinceJoin = signals.joinedAt ? (now.getTime() - signals.joinedAt.getTime()) / DAY_MS : Infinity;
  const onboarding = daysSinceJoin < weights.onboardingDays;

  if (onboarding) {
    reasons.push({ key: 'onboarding', label: CHURN_REASON_LABELS.onboarding, points: 0, detail: { daysSinceJoin: Math.floor(daysSinceJoin) } });
  } else {
    // 1. Attendance trend: last 28 days vs the 28 days before that.
    if (signals.attendedPrev28 > 0 && signals.attendedLast28 < signals.attendedPrev28) {
      const drop = (signals.attendedPrev28 - signals.attendedLast28) / signals.attendedPrev28;
      const points = scaled(weights.attendanceDeclineWeight, drop / weights.attendanceDeclineRatio);
      if (points > 0) {
        score += points;
        reasons.push({
          key: 'attendance_declining',
          label: CHURN_REASON_LABELS.attendance_declining,
          points,
          detail: { attendedLast28: signals.attendedLast28, attendedPrev28: signals.attendedPrev28 },
        });
      }
    }

    // 2. Days since last attendance (never attended counts as fully inactive).
    const days = signals.daysSinceLastAttendance;
    if (days === null || days >= weights.inactivityThresholdDays) {
      const effectiveDays = days ?? weights.inactivityMaxDays;
      const points = scaled(weights.inactivityWeight, effectiveDays / weights.inactivityMaxDays);
      if (points > 0) {
        score += points;
        reasons.push({
          key: 'inactive',
          label: CHURN_REASON_LABELS.inactive,
          points,
          detail: { daysSinceLastAttendance: days },
        });
      }
    }
  }

  // 3. Active package ending soon, with no renewal purchased yet.
  const pkg = signals.activePackage;
  if (pkg) {
    const daysUntilEnd = (pkg.endDate.getTime() - now.getTime()) / DAY_MS;
    if (!signals.hasRenewalPurchased && daysUntilEnd >= 0 && daysUntilEnd <= weights.packageEndingWindowDays) {
      const points = scaled(weights.packageEndingWeight, 1 - daysUntilEnd / weights.packageEndingWindowDays);
      if (points > 0) {
        score += points;
        reasons.push({
          key: 'package_ending_soon',
          label: CHURN_REASON_LABELS.package_ending_soon,
          points,
          detail: { daysUntilEnd: Math.round(daysUntilEnd) },
        });
      }
    }

    // 4. Active package nearly out of units (session/credit packages only).
    if (
      !signals.hasRenewalPurchased &&
      pkg.entitlementKind !== 'TIME_UNLIMITED' &&
      pkg.remainingUnits !== null &&
      pkg.remainingUnits <= weights.packageLowUnitsThreshold
    ) {
      const ratio = weights.packageLowUnitsThreshold === 0 ? 1 : 1 - pkg.remainingUnits / (weights.packageLowUnitsThreshold + 1);
      const points = scaled(weights.packageLowUnitsWeight, ratio);
      if (points > 0) {
        score += points;
        reasons.push({
          key: 'package_low_units',
          label: CHURN_REASON_LABELS.package_low_units,
          points,
          detail: { remainingUnits: pkg.remainingUnits },
        });
      }
    }

    // 5. Package currently frozen.
    if (pkg.status === 'FROZEN' && weights.packageFrozenWeight > 0) {
      score += weights.packageFrozenWeight;
      reasons.push({ key: 'package_frozen', label: CHURN_REASON_LABELS.package_frozen, points: weights.packageFrozenWeight });
    }
  }

  // 6. Late cancels + no-shows in the last 28 days.
  const lateAndNoShow = signals.lateCancelsLast28 + signals.noShowsLast28;
  if (lateAndNoShow > 0) {
    const points = scaled(weights.lateCancelNoShowWeight, lateAndNoShow / weights.lateCancelNoShowMaxCount);
    if (points > 0) {
      score += points;
      reasons.push({
        key: 'late_cancels_no_shows',
        label: CHURN_REASON_LABELS.late_cancels_no_shows,
        points,
        detail: { lateCancels: signals.lateCancelsLast28, noShows: signals.noShowsLast28 },
      });
    }
  }

  // 7. Failed dunning payment attempts in the last 28 days.
  if (signals.failedPaymentAttemptsLast28 > 0) {
    const points = scaled(weights.failedPaymentWeight, signals.failedPaymentAttemptsLast28 / weights.failedPaymentMaxCount);
    if (points > 0) {
      score += points;
      reasons.push({
        key: 'failed_payments',
        label: CHURN_REASON_LABELS.failed_payments,
        points,
        detail: { count: signals.failedPaymentAttemptsLast28 },
      });
    }
  }

  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  return { score: clamped, level: levelFor(clamped, weights), onboarding, reasons };
}

const DAY_MS = 24 * 60 * 60 * 1000;
