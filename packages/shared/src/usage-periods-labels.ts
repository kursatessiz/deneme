import type { Translate } from './i18n/translator';
import type { UsagePeriodStatusDTO, UsageRule, UsageTier } from './usage-periods';
import { ruleHasBurningTier, sortTiersFinerFirst } from './usage-periods';

/**
 * Human-readable text for usage periods (docs/KULLANIM_DONEMLERI.md), shared by the web panel and the
 * mobile app. Pure: the caller passes the active translator and locale, nothing is hard coded here.
 */

/** A burning period that ends within this many days gets the "will expire soon" hint. */
export const USAGE_BURN_SOON_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

/** "8 sessions" / "8 credits" / "8 visits", by entitlement kind (neutral nouns, never a vertical's vocabulary). */
export function usageQuotaNoun(t: Translate, entitlementKind: string, count: number): string {
  const kind = entitlementKind === 'CREDIT' || entitlementKind === 'TIME_UNLIMITED' ? entitlementKind : 'SESSION_COUNT';
  return t(`usagePeriods.noun.${kind}`, { count });
}

function periodPhrase(t: Translate, tier: Pick<UsageTier, 'unit' | 'length'>): string {
  return t(`usagePeriods.per.${tier.unit}`, { count: tier.length });
}

/** One sentence per tier, e.g. "Monthly 8 sessions; unused rights expire at the end of each period." */
export function describeUsageTier(t: Translate, tier: UsageTier, entitlementKind: string): string {
  const params = { period: periodPhrase(t, tier), quota: usageQuotaNoun(t, entitlementKind, tier.quota) };
  return t(tier.expireUnused ? 'usagePeriods.sentence.burn' : 'usagePeriods.sentence.cap', params);
}

/**
 * The whole rule as one readable text: the burning tiers first, then the caps, then the month mode and
 * the reminder when they matter.
 */
export function describeUsageRule(t: Translate, rule: UsageRule, entitlementKind: string): string {
  const ordered = [...sortTiersFinerFirst(rule.tiers)].sort((a, b) => Number(b.expireUnused) - Number(a.expireUnused));
  const parts = ordered.map((tier) => describeUsageTier(t, tier, entitlementKind));
  const fixed = rule.tiers.find((tier) => tier.unit === 'MONTH' && tier.monthMode === 'FIXED_DAYS');
  if (fixed?.fixedMonthDays) parts.push(t('usagePeriods.sentence.fixedMonth', { days: fixed.fixedMonthDays }));
  if (ruleHasBurningTier(rule) && rule.reminderDaysBefore > 0) {
    parts.push(t('usagePeriods.sentence.reminder', { count: rule.reminderDaysBefore }));
  }
  return parts.join(' ');
}

/** Month and day by locale; the year is added when the date is not in the year of `now`. */
export function formatUsageDate(iso: string | Date, locale: string, now: Date, timeZone?: string): string {
  const date = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(date.getTime())) return '';
  const yearOf = (d: Date): number => Number(new Intl.DateTimeFormat('en-US', { year: 'numeric', timeZone }).format(d));
  const sameYear = yearOf(date) === yearOf(now);
  try {
    return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', ...(sameYear ? {} : { year: 'numeric' }), timeZone }).format(date);
  } catch {
    return new Intl.DateTimeFormat('en', { day: 'numeric', month: 'long', ...(sameYear ? {} : { year: 'numeric' }), timeZone }).format(date);
  }
}

export interface UsagePeriodLine {
  unit: UsagePeriodStatusDTO['unit'];
  /** "This month: 5/8 used. Renews: 12 November" */
  text: string;
  /** True when the unused part of this period burns, false when the tier only caps usage. */
  burns: boolean;
  badge: string;
  used: number;
  quota: number;
  /** Set when a burning period ends soon with unused rights left: "3 sessions will expire on 12 November." */
  hint: string | null;
}

export interface UsageLineOptions {
  locale: string;
  now: Date;
  entitlementKind: string;
  /** Package end date (ISO): a period clipped to it is labelled "Package ends" instead of "Renews". */
  packageEnd?: string | null;
  timeZone?: string;
}

/** The tier lines of one member package, finest period first. */
export function describeUsagePeriods(t: Translate, periods: readonly UsagePeriodStatusDTO[], options: UsageLineOptions): UsagePeriodLine[] {
  return sortTiersFinerFirst(periods).map((p) => {
    const periodName = p.length === 1 ? t(`usagePeriods.status.current.${p.unit}`) : t('usagePeriods.status.current.MULTI');
    const endsWithPackage = options.packageEnd ? new Date(p.periodEnd).getTime() >= new Date(options.packageEnd).getTime() : false;
    const date = formatUsageDate(p.periodEnd, options.locale, options.now, options.timeZone);
    const text = t(endsWithPackage ? 'usagePeriods.status.lineEnd' : 'usagePeriods.status.line', {
      period: periodName,
      used: p.used,
      quota: p.quota,
      date,
    });
    const unused = Math.max(0, p.remaining);
    const msLeft = new Date(p.periodEnd).getTime() - options.now.getTime();
    const burnsSoon = p.expireUnused && !endsWithPackage && unused > 0 && msLeft > 0 && msLeft <= USAGE_BURN_SOON_DAYS * DAY_MS;
    return {
      unit: p.unit,
      text,
      burns: p.expireUnused,
      badge: t(p.expireUnused ? 'usagePeriods.badge.burn' : 'usagePeriods.badge.cap'),
      used: p.used,
      quota: p.quota,
      hint: burnsSoon ? t('usagePeriods.status.burnSoon', { units: usageQuotaNoun(t, options.entitlementKind, unused), date }) : null,
    };
  });
}

/** Label of one burn-history row: "Monthly, 1 October - 1 November: 3 sessions expired". */
export function describeUnitExpiry(
  t: Translate,
  row: { tierUnit: UsagePeriodStatusDTO['unit']; periodStart: string; periodEnd: string; units: number },
  options: { locale: string; now: Date; entitlementKind: string; timeZone?: string },
): string {
  return t('usagePeriods.history.row', {
    tier: t(`usagePeriods.tierName.${row.tierUnit}`),
    start: formatUsageDate(row.periodStart, options.locale, options.now, options.timeZone),
    end: formatUsageDate(row.periodEnd, options.locale, options.now, options.timeZone),
    units: usageQuotaNoun(t, options.entitlementKind, row.units),
  });
}
