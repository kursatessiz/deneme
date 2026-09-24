import type { CancellationPolicy, EntitlementKind } from '@platform/database';

export type PolicyTerms = Pick<CancellationPolicy, 'freeCancelHours' | 'lateCancelChargeUnits' | 'noShowChargeUnits'>;

export interface PolicyOutcome {
  /** True when the cancellation happened inside the free-cancel window. */
  isLate: boolean;
  /** Units returned to the member's package. */
  refundUnits: number;
  /** Units the business keeps. refundUnits + penaltyUnits === unitsCharged. */
  penaltyUnits: number;
}

const HOUR_MS = 60 * 60 * 1000;

/**
 * Without any configured policy the booking is refundable until the session
 * starts and a late cancel or no-show keeps everything that was charged.
 */
export const FALLBACK_POLICY: PolicyTerms = {
  freeCancelHours: 0,
  lateCancelChargeUnits: Number.MAX_SAFE_INTEGER,
  noShowChargeUnits: Number.MAX_SAFE_INTEGER,
};

function split(unitsCharged: number, entitlementKind: EntitlementKind | null, charge: number): PolicyOutcome {
  // Unlimited plans and bookings without a package have nothing to refund.
  if (!entitlementKind || entitlementKind === 'TIME_UNLIMITED' || unitsCharged <= 0) {
    return { isLate: false, refundUnits: 0, penaltyUnits: 0 };
  }
  const penaltyUnits = Math.min(unitsCharged, Math.max(0, charge));
  return { isLate: false, refundUnits: unitsCharged - penaltyUnits, penaltyUnits };
}

export function evaluateCancellation(params: {
  policy: PolicyTerms;
  sessionStart: Date;
  now: Date;
  unitsCharged: number;
  entitlementKind: EntitlementKind | null;
  waivePenalty: boolean;
}): PolicyOutcome {
  const deadline = params.sessionStart.getTime() - params.policy.freeCancelHours * HOUR_MS;
  const isLate = params.now.getTime() > deadline;
  const charge = isLate && !params.waivePenalty ? params.policy.lateCancelChargeUnits : 0;
  return { ...split(params.unitsCharged, params.entitlementKind, charge), isLate };
}

export function evaluateNoShow(params: {
  policy: PolicyTerms;
  unitsCharged: number;
  entitlementKind: EntitlementKind | null;
  waivePenalty: boolean;
}): PolicyOutcome {
  const charge = params.waivePenalty ? 0 : params.policy.noShowChargeUnits;
  return { ...split(params.unitsCharged, params.entitlementKind, charge), isLate: true };
}
