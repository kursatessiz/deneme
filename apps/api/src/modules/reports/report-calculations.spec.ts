import {
  addMonthsToKey,
  buildCohorts,
  computeRenewalRate,
  countChurned,
  isChurned,
  isRenewed,
  ratio,
  type CohortMemberActivity,
  type PackageEndInfo,
} from './report-calculations';

const day = (n: number) => new Date(n * 24 * 60 * 60 * 1000);

describe('ratio', () => {
  it('returns 0 when the whole is 0', () => {
    expect(ratio(5, 0)).toBe(0);
  });
  it('rounds to three decimals', () => {
    expect(ratio(1, 3)).toBe(0.333);
  });
});

describe('renewal / churn', () => {
  const ending = (endDay: number, nextDay: number | null): PackageEndInfo => ({
    memberId: 'm',
    endDate: day(endDay),
    nextPurchaseDate: nextDay === null ? null : day(nextDay),
  });

  it('is renewed when the next purchase is within 14 days', () => {
    expect(isRenewed(ending(0, 14))).toBe(true);
    expect(isRenewed(ending(0, 0))).toBe(true);
  });

  it('is churned when there is no next purchase', () => {
    expect(isRenewed(ending(0, null))).toBe(false);
    expect(isChurned(ending(0, null))).toBe(true);
  });

  it('is churned when the next purchase is more than 14 days later', () => {
    expect(isRenewed(ending(0, 15))).toBe(false);
    expect(isChurned(ending(0, 15))).toBe(true);
  });

  it('a purchase before the package even ended does not count as a renewal', () => {
    // Guards against a stray earlier package being picked up as "next".
    expect(isRenewed(ending(10, 5))).toBe(false);
  });

  it('computeRenewalRate aggregates a batch', () => {
    const endings = [ending(0, 5), ending(0, 20), ending(0, null)];
    expect(computeRenewalRate(endings)).toEqual({ expiredPackages: 3, renewedPackages: 1, renewalRate: ratio(1, 3) });
  });

  it('computeRenewalRate is 0 when there are no endings', () => {
    expect(computeRenewalRate([])).toEqual({ expiredPackages: 0, renewedPackages: 0, renewalRate: 0 });
  });

  it('countChurned counts everyone not renewed', () => {
    expect(countChurned([ending(0, 5), ending(0, 20), ending(0, null)])).toBe(2);
  });
});

describe('addMonthsToKey', () => {
  it('advances across year boundaries', () => {
    expect(addMonthsToKey('2025-11', 2)).toBe('2026-01');
  });
  it('month 0 is a no-op', () => {
    expect(addMonthsToKey('2025-03', 0)).toBe('2025-03');
  });
});

describe('buildCohorts', () => {
  const member = (id: string, month: string, active: string[]): CohortMemberActivity => ({
    memberId: id,
    firstPurchaseMonth: month,
    activeMonths: new Set(active),
  });

  it('groups members by first-purchase month and computes retention per subsequent month', () => {
    const members = [
      member('a', '2025-03', ['2025-03', '2025-04']),
      member('b', '2025-03', ['2025-03']),
      member('c', '2025-04', ['2025-04', '2025-05']),
    ];
    const cohorts = buildCohorts(members, 3);
    expect(cohorts).toHaveLength(2);

    const march = cohorts.find((c) => c.cohortMonth === '2025-03')!;
    expect(march.cohortSize).toBe(2);
    expect(march.retention).toEqual([1, 0.5, 0]); // month0: both, month1: only a, month2: none

    const april = cohorts.find((c) => c.cohortMonth === '2025-04')!;
    expect(april.cohortSize).toBe(1);
    expect(april.retention).toEqual([1, 1, 0]);
  });

  it('caps retention at maxMonths', () => {
    const members = [member('a', '2025-01', ['2025-01', '2025-02', '2025-03', '2025-04', '2025-05'])];
    const cohorts = buildCohorts(members, 2);
    expect(cohorts[0].retention).toHaveLength(2);
  });

  it('an empty member list produces no cohorts', () => {
    expect(buildCohorts([])).toEqual([]);
  });
});
