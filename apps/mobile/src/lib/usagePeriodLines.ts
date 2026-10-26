import { describeUsagePeriods } from '@platform/shared';
import type { MemberPackageDTO, Translate, UsagePeriodLine } from '@platform/shared';

/**
 * The usage-period lines of a member package for the package card (docs/KULLANIM_DONEMLERI.md): one line per
 * tier ("This month: 5/8 used. Renews: November 12"), the burn or cap badge and a hint when unused rights
 * expire soon. Empty when the studio switch is off or the package has no rule (the API sends null then).
 */
export function packageUsageLines(pkg: Pick<MemberPackageDTO, 'usagePeriods' | 'entitlementKind' | 'endDate'>, t: Translate, locale: string, now: Date = new Date()): UsagePeriodLine[] {
  if (!pkg.usagePeriods || pkg.usagePeriods.length === 0) return [];
  return describeUsagePeriods(t, pkg.usagePeriods, { locale, now, entitlementKind: pkg.entitlementKind, packageEnd: pkg.endDate });
}
