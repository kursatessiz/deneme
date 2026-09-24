import { evaluateCancellation, evaluateNoShow, FALLBACK_POLICY } from './cancellation-policy';

const policy = { freeCancelHours: 12, lateCancelChargeUnits: 1, noShowChargeUnits: 3 };
const start = new Date('2026-10-01T10:00:00Z');
const hoursBefore = (h: number) => new Date(start.getTime() - h * 3600_000);

describe('evaluateCancellation', () => {
  it('is free outside the window', () => {
    const r = evaluateCancellation({
      policy,
      sessionStart: start,
      now: hoursBefore(13),
      unitsCharged: 2,
      entitlementKind: 'CREDIT',
      waivePenalty: false,
    });
    expect(r).toEqual({ isLate: false, refundUnits: 2, penaltyUnits: 0 });
  });

  it('exactly at the deadline is still free', () => {
    const r = evaluateCancellation({
      policy,
      sessionStart: start,
      now: hoursBefore(12),
      unitsCharged: 1,
      entitlementKind: 'SESSION_COUNT',
      waivePenalty: false,
    });
    expect(r.isLate).toBe(false);
  });

  it('charges the late-cancel units inside the window', () => {
    const r = evaluateCancellation({
      policy,
      sessionStart: start,
      now: hoursBefore(2),
      unitsCharged: 2,
      entitlementKind: 'CREDIT',
      waivePenalty: false,
    });
    expect(r).toEqual({ isLate: true, refundUnits: 1, penaltyUnits: 1 });
  });

  it('never charges more than was paid', () => {
    const r = evaluateCancellation({
      policy: { ...policy, lateCancelChargeUnits: 5 },
      sessionStart: start,
      now: hoursBefore(1),
      unitsCharged: 2,
      entitlementKind: 'CREDIT',
      waivePenalty: false,
    });
    expect(r).toEqual({ isLate: true, refundUnits: 0, penaltyUnits: 2 });
  });

  it('waiver refunds everything but still reports lateness', () => {
    const r = evaluateCancellation({
      policy,
      sessionStart: start,
      now: hoursBefore(1),
      unitsCharged: 2,
      entitlementKind: 'CREDIT',
      waivePenalty: true,
    });
    expect(r).toEqual({ isLate: true, refundUnits: 2, penaltyUnits: 0 });
  });

  it('unlimited plans and package-less bookings move no units', () => {
    for (const kind of ['TIME_UNLIMITED', null] as const) {
      const r = evaluateCancellation({
        policy,
        sessionStart: start,
        now: hoursBefore(1),
        unitsCharged: 0,
        entitlementKind: kind,
        waivePenalty: false,
      });
      expect(r).toEqual({ isLate: true, refundUnits: 0, penaltyUnits: 0 });
    }
  });

  it('fallback policy keeps everything once the session started', () => {
    const r = evaluateCancellation({
      policy: FALLBACK_POLICY,
      sessionStart: start,
      now: new Date(start.getTime() + 60_000),
      unitsCharged: 1,
      entitlementKind: 'SESSION_COUNT',
      waivePenalty: false,
    });
    expect(r).toEqual({ isLate: true, refundUnits: 0, penaltyUnits: 1 });
  });
});

describe('evaluateNoShow', () => {
  it('charges the no-show units, capped at the charge', () => {
    expect(evaluateNoShow({ policy, unitsCharged: 2, entitlementKind: 'CREDIT', waivePenalty: false })).toEqual({
      isLate: true,
      refundUnits: 0,
      penaltyUnits: 2,
    });
    expect(
      evaluateNoShow({
        policy: { ...policy, noShowChargeUnits: 1 },
        unitsCharged: 3,
        entitlementKind: 'CREDIT',
        waivePenalty: false,
      }),
    ).toEqual({ isLate: true, refundUnits: 2, penaltyUnits: 1 });
  });

  it('waiver refunds everything', () => {
    expect(evaluateNoShow({ policy, unitsCharged: 2, entitlementKind: 'CREDIT', waivePenalty: true })).toEqual({
      isLate: true,
      refundUnits: 2,
      penaltyUnits: 0,
    });
  });
});
