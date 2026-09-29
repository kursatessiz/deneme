// The comparison helpers live in @platform/shared so the funnel report API
// and the web report tabs share one implementation (docs/HUNILER.md).
export { compareKpi, previousPeriodWindow } from '@platform/shared';
export type { ComparisonDirection, DateWindow, KpiComparison } from '@platform/shared';
