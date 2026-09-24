/** Pure date-range helpers for the trainer/reception session lists. */

export function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export interface DateRange {
  start: Date;
  end: Date;
}

/** [00:00 today, 00:00 tomorrow). */
export function dayRange(reference: Date): DateRange {
  const start = startOfDay(reference);
  return { start, end: addDays(start, 1) };
}

/** [00:00 of reference's day, +7 days). Not calendar-week-aligned: it is a
 * rolling 7-day window starting from the given day, matching how
 * "Programım" pages forward/back. */
export function weekRange(reference: Date): DateRange {
  const start = startOfDay(reference);
  return { start, end: addDays(start, 7) };
}
