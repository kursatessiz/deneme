import type { CohortRowDTO } from '@platform/shared';

/** Rounds to three decimal places, matching the studio-wide ratio convention. */
export function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function ratio(part: number, whole: number): number {
  return whole === 0 ? 0 : round3(part / whole);
}

/** One package that ended inside the report range, and the member's next one (if any). */
export interface PackageEndInfo {
  memberId: string;
  endDate: Date;
  /** Start date of the member's next package after this one ended, if any. */
  nextPurchaseDate: Date | null;
}

const RENEWAL_WINDOW_DAYS = 14;

/** Days between a package ending and the member's next purchase; null when there is none. */
export function daysToNextPurchase(info: PackageEndInfo): number | null {
  if (!info.nextPurchaseDate) return null;
  const diffMs = info.nextPurchaseDate.getTime() - info.endDate.getTime();
  return diffMs / (24 * 60 * 60 * 1000);
}

/** Bought another package within RENEWAL_WINDOW_DAYS after this one ended. */
export function isRenewed(info: PackageEndInfo): boolean {
  const days = daysToNextPurchase(info);
  return days !== null && days >= 0 && days <= RENEWAL_WINDOW_DAYS;
}

/** No new package within RENEWAL_WINDOW_DAYS after this one ended. */
export function isChurned(info: PackageEndInfo): boolean {
  return !isRenewed(info);
}

export function computeRenewalRate(endings: PackageEndInfo[]): { expiredPackages: number; renewedPackages: number; renewalRate: number } {
  const expiredPackages = endings.length;
  const renewedPackages = endings.filter(isRenewed).length;
  return { expiredPackages, renewedPackages, renewalRate: ratio(renewedPackages, expiredPackages) };
}

export function countChurned(endings: PackageEndInfo[]): number {
  return endings.filter(isChurned).length;
}

// ---------------------------------------------------------------------------
// Cohorts
// ---------------------------------------------------------------------------

export interface CohortMemberActivity {
  memberId: string;
  /** yyyy-MM of the member's first package purchase. */
  firstPurchaseMonth: string;
  /** yyyy-MM months in which the member was active (package or attendance). */
  activeMonths: ReadonlySet<string>;
}

export function addMonthsToKey(yyyyMM: string, n: number): string {
  const [y, m] = yyyyMM.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Builds monthly retention cohorts, capped at maxMonths (including month 0). */
export function buildCohorts(members: CohortMemberActivity[], maxMonths = 12): CohortRowDTO[] {
  const byCohort = new Map<string, CohortMemberActivity[]>();
  for (const m of members) {
    const arr = byCohort.get(m.firstPurchaseMonth);
    if (arr) arr.push(m);
    else byCohort.set(m.firstPurchaseMonth, [m]);
  }

  const rows: CohortRowDTO[] = [];
  for (const cohortMonth of [...byCohort.keys()].sort()) {
    const cohortMembers = byCohort.get(cohortMonth) ?? [];
    const retention: number[] = [];
    for (let i = 0; i < maxMonths; i++) {
      const targetMonth = addMonthsToKey(cohortMonth, i);
      const activeCount = cohortMembers.filter((m) => m.activeMonths.has(targetMonth)).length;
      retention.push(ratio(activeCount, cohortMembers.length));
    }
    rows.push({ cohortMonth, cohortSize: cohortMembers.length, retention });
  }
  return rows;
}
