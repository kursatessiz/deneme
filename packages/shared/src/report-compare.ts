/**
 * Previous-period comparison helpers shared by the /raporlar KPI strip and
 * the funnel report API (docs/HUNILER.md).
 */
export interface DateWindow {
  from: Date;
  to: Date;
}

/**
 * The same-length window immediately preceding `window` (used by the
 * "compare with previous period" toggle on /raporlar). The previous window
 * ends the instant the selected range starts and spans the same duration,
 * so a 7-day range and its previous-period range never overlap.
 */
export function previousPeriodWindow(window: DateWindow): DateWindow {
  const durationMs = Math.max(0, window.to.getTime() - window.from.getTime());
  const to = new Date(window.from.getTime() - 1);
  const from = new Date(to.getTime() - durationMs);
  return { from, to };
}

export type ComparisonDirection = 'up' | 'down' | 'neutral';

export interface KpiComparison {
  current: number;
  previous: number;
  /** (current - previous) / previous; null when the previous value is 0 (no meaningful percentage). */
  changeRatio: number | null;
  direction: ComparisonDirection;
}

/**
 * Percentage change between a KPI's current and previous-period value.
 * Neutral (with no ratio) whenever the previous value is 0, per spec --
 * there is nothing to compare a percentage change against.
 */
export function compareKpi(current: number, previous: number): KpiComparison {
  if (previous === 0) {
    return { current, previous, changeRatio: null, direction: 'neutral' };
  }
  const changeRatio = (current - previous) / previous;
  const direction: ComparisonDirection = changeRatio > 0 ? 'up' : changeRatio < 0 ? 'down' : 'neutral';
  return { current, previous, changeRatio, direction };
}
