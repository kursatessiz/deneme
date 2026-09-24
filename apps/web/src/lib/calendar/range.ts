export type CalendarView = 'day' | 'week' | 'month';

/** Monday-first start of the ISO week containing `date`, at local midnight. */
export function startOfWeek(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = d.getDay(); // 0 = Sunday
  const diffToMonday = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diffToMonday);
  return d;
}

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

/**
 * The [start, end) range to query the schedules endpoint for, for one
 * calendar view anchored on `anchor`. Month view widens to full weeks so
 * the grid has no partial row.
 */
export function rangeForView(view: CalendarView, anchor: Date): { start: Date; end: Date } {
  if (view === 'day') {
    const start = startOfDay(anchor);
    return { start, end: addDays(start, 1) };
  }
  if (view === 'week') {
    const start = startOfWeek(anchor);
    return { start, end: addDays(start, 7) };
  }
  const monthStart = startOfMonth(anchor);
  const gridStart = startOfWeek(monthStart);
  const nextMonthStart = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1);
  const gridEnd = addDays(startOfWeek(addDays(nextMonthStart, -1)), 7);
  return { start: gridStart, end: gridEnd };
}

/** Moves the anchor date one step forward/back for the given view. */
export function stepAnchor(view: CalendarView, anchor: Date, direction: 1 | -1): Date {
  if (view === 'day') return addDays(anchor, direction);
  if (view === 'week') return addDays(anchor, direction * 7);
  return new Date(anchor.getFullYear(), anchor.getMonth() + direction, 1);
}

/**
 * Rounds a Date's minutes to the nearest `slotMinutes` boundary. Used by
 * calendar drag-drop so a session dropped mid-pixel still lands on a clean
 * time (default: 5 minutes).
 */
export function snapToSlot(date: Date, slotMinutes = 5): Date {
  const ms = slotMinutes * 60 * 1000;
  return new Date(Math.round(date.getTime() / ms) * ms);
}

/**
 * Given a session's original start/end and how far (in minutes) it was
 * dragged within a day/week grid, returns the new start/end preserving the
 * original duration, snapped to `slotMinutes`.
 */
export function moveByMinutes(
  start: Date,
  end: Date,
  deltaMinutes: number,
  slotMinutes = 5,
): { start: Date; end: Date } {
  const durationMs = end.getTime() - start.getTime();
  const rawStart = new Date(start.getTime() + deltaMinutes * 60 * 1000);
  const newStart = snapToSlot(rawStart, slotMinutes);
  return { start: newStart, end: new Date(newStart.getTime() + durationMs) };
}

/** Pixel offset (from a grid's top) to minutes since local midnight, for translating a drop's Y position into a time. */
export function pixelsToMinutes(offsetPx: number, pxPerHour: number): number {
  return (offsetPx / pxPerHour) * 60;
}

export function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

const WEEKDAY_LABELS = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar'];

export function weekdayLabel(date: Date): string {
  const day = date.getDay();
  return WEEKDAY_LABELS[day === 0 ? 6 : day - 1];
}
