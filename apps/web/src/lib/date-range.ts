export interface DateRange {
  from: Date;
  to: Date;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

function endOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

function startOfWeek(d: Date): Date {
  // Monday-first week, matching the calendar screen (lib/calendar/range.ts).
  const day = (d.getDay() + 6) % 7;
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate() - day, 0, 0, 0, 0);
  return start;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
}

export type DateRangePresetKey = 'today' | 'this_week' | 'last_7_days' | 'this_month' | 'last_30_days' | 'this_year';

export interface DateRangePreset {
  key: DateRangePresetKey;
  label: string;
}

export const DATE_RANGE_PRESETS: readonly DateRangePreset[] = [
  { key: 'today', label: 'Bugün' },
  { key: 'this_week', label: 'Bu hafta' },
  { key: 'last_7_days', label: 'Son 7 gün' },
  { key: 'this_month', label: 'Bu ay' },
  { key: 'last_30_days', label: 'Son 30 gün' },
  { key: 'this_year', label: 'Bu yıl' },
];

/** Pure date-range presets for report and finance filters; `now` is injectable for tests. */
export function resolveDateRangePreset(key: DateRangePresetKey, now: Date = new Date()): DateRange {
  switch (key) {
    case 'today':
      return { from: startOfDay(now), to: endOfDay(now) };
    case 'this_week':
      return { from: startOfWeek(now), to: endOfDay(now) };
    case 'last_7_days':
      return { from: startOfDay(new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000)), to: endOfDay(now) };
    case 'this_month':
      return { from: startOfMonth(now), to: endOfDay(now) };
    case 'last_30_days':
      return { from: startOfDay(new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000)), to: endOfDay(now) };
    case 'this_year':
      return { from: new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0), to: endOfDay(now) };
  }
}

/** yyyy-MM-dd for a <input type="date"> field, in local time (never UTC, to avoid an off-by-one day). */
export function toDateInputValue(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Parses a <input type="date"> value as a local date; returns null for an empty/invalid string. */
export function fromDateInputValue(value: string): Date | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [, y, m, d] = match;
  const date = new Date(Number(y), Number(m) - 1, Number(d), 0, 0, 0, 0);
  return Number.isNaN(date.getTime()) ? null : date;
}
