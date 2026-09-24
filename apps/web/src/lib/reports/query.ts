export interface ReportQueryFilters {
  from?: Date | null;
  to?: Date | null;
  branchId?: string | null;
  granularity?: 'day' | 'week' | 'month';
  format?: 'json' | 'csv';
}

/**
 * Builds the query string for `GET /reports/studio/:id/<report>` (and the
 * equivalent churn/payroll/payment list endpoints), matching
 * `ReportRangeSchema`/`ReportFiltersSchema`/`RevenueGranularitySchema` in
 * packages/shared: only the fields that are actually set are included, `to`
 * carries a full day by moving to that day's end, and dates go out as ISO
 * strings.
 */
export function buildReportQuery(filters: ReportQueryFilters): string {
  const params = new URLSearchParams();
  if (filters.from) params.set('from', filters.from.toISOString());
  if (filters.to) params.set('to', filters.to.toISOString());
  if (filters.branchId) params.set('branchId', filters.branchId);
  if (filters.granularity) params.set('granularity', filters.granularity);
  if (filters.format) params.set('format', filters.format);
  const qs = params.toString();
  return qs;
}

/** Appends `buildReportQuery(filters)` onto a BFF path, handling the `?` correctly when there are no filters. */
export function withReportQuery(path: string, filters: ReportQueryFilters): string {
  const qs = buildReportQuery(filters);
  return qs ? `${path}?${qs}` : path;
}
