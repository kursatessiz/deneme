/**
 * Date and time formatting in an explicit IANA time zone, for the public
 * booking page, the embeddable widget and the public event pages: a
 * session is held at a branch, so its time is shown on that branch's clock
 * and never on the visitor's (docs/PUBLIC_API.md). Pure and locale driven:
 * no zone or locale is hard-coded.
 */

/** True when `value` is an IANA zone name this runtime's Intl accepts. */
export function isValidTimeZone(value: string | null | undefined): value is string {
  if (!value) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** First valid zone of the candidates (branch zone, then studio zone); undefined means the viewer's own zone. */
export function resolveTimeZone(...candidates: Array<string | null | undefined>): string | undefined {
  return candidates.find(isValidTimeZone);
}

export interface ZonedFormatters {
  /** Weekday, day and month, e.g. "Wed, Oct 1". */
  day(iso: string): string;
  /** Hour and minute. */
  time(iso: string): string;
  /** Weekday, day, month and time. */
  dateTime(iso: string): string;
  /** Short zone name at that instant (e.g. "GMT+3", "EST"); empty when unavailable. */
  zoneName(iso: string): string;
  /** Calendar day in the zone as `YYYY-MM-DD`, to group sessions by their local day. */
  dayKey(iso: string): string;
}

export function createZonedFormatters(locale: string, timeZone?: string): ZonedFormatters {
  const zone = isValidTimeZone(timeZone) ? timeZone : undefined;
  const day = new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short', timeZone: zone });
  const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', timeZone: zone });
  const dateTime = new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: zone });
  const name = new Intl.DateTimeFormat(locale, { timeZoneName: 'short', timeZone: zone });
  const parts = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: zone });
  return {
    day: (iso) => day.format(new Date(iso)),
    time: (iso) => time.format(new Date(iso)),
    dateTime: (iso) => dateTime.format(new Date(iso)),
    zoneName: (iso) => name.formatToParts(new Date(iso)).find((p) => p.type === 'timeZoneName')?.value ?? '',
    dayKey: (iso) => {
      const p = Object.fromEntries(parts.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
      return `${p.year}-${p.month}-${p.day}`;
    },
  };
}

/**
 * ISO 8601 timestamp carrying the zone's UTC offset at that instant, e.g. `2026-10-01T18:00:00+03:00`
 * (schema.org wants an offset on Event dates). Falls back to a plain UTC instant for a missing or invalid zone.
 */
export function zonedIsoString(iso: string, timeZone: string | null | undefined): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  if (!isValidTimeZone(timeZone)) return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  const wall = `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
  const asUtc = Date.parse(`${wall}Z`);
  const instant = Math.floor(date.getTime() / 1000) * 1000;
  const offsetMinutes = Math.round((asUtc - instant) / 60000);
  const sign = offsetMinutes < 0 ? '-' : '+';
  const abs = Math.abs(offsetMinutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `${wall}${sign}${hh}:${mm}`;
}
