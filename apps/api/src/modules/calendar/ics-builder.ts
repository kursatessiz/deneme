/**
 * Minimal RFC 5545 (iCalendar) writer for the personal booking feed. No
 * external dependency: only the small subset of the spec this feed needs
 * (VCALENDAR/VEVENT, UTC date-times, line folding, text escaping).
 */

export interface IcsEventInput {
  /** Stable per booking, e.g. `booking-<id>@platform`. Never reused. */
  uid: string;
  summary: string;
  /** UTC Date; rendered as a floating UTC "Z" date-time. */
  start: Date;
  end: Date;
  location?: string | null;
  description?: string | null;
  /** CONFIRMED (default), CANCELLED, or TENTATIVE. */
  status?: 'CONFIRMED' | 'CANCELLED' | 'TENTATIVE';
  /** Defaults to `start` when omitted. */
  createdAt?: Date;
}

const CRLF = '\r\n';
const FOLD_LIMIT = 75;

/** Escapes text per RFC 5545 section 3.3.11 (backslash, comma, semicolon, newline). */
export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/** Folds a single content line at 75 octets, continuation lines start with a space. */
function foldLine(line: string): string {
  if (line.length <= FOLD_LIMIT) return line;
  const parts: string[] = [];
  let rest = line;
  let first = true;
  while (rest.length > 0) {
    const limit = first ? FOLD_LIMIT : FOLD_LIMIT - 1;
    parts.push(rest.slice(0, limit));
    rest = rest.slice(limit);
    first = false;
  }
  return parts.join(CRLF + ' ');
}

function formatUtcDateTime(date: Date): string {
  const pad = (n: number, len = 2) => String(n).padStart(len, '0');
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  );
}

function buildEventLines(event: IcsEventInput): string[] {
  const lines = [
    'BEGIN:VEVENT',
    `UID:${escapeIcsText(event.uid)}`,
    `DTSTAMP:${formatUtcDateTime(event.createdAt ?? event.start)}`,
    `DTSTART:${formatUtcDateTime(event.start)}`,
    `DTEND:${formatUtcDateTime(event.end)}`,
    `SUMMARY:${escapeIcsText(event.summary)}`,
    `STATUS:${event.status ?? 'CONFIRMED'}`,
  ];
  if (event.location) lines.push(`LOCATION:${escapeIcsText(event.location)}`);
  if (event.description) lines.push(`DESCRIPTION:${escapeIcsText(event.description)}`);
  lines.push('END:VEVENT');
  return lines;
}

/** Builds a full VCALENDAR document with the given events. */
export function buildIcsCalendar(options: { calendarName: string; productId: string; events: IcsEventInput[] }): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${escapeIcsText(options.productId)}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcsText(options.calendarName)}`,
    ...options.events.flatMap(buildEventLines),
    'END:VCALENDAR',
  ];
  return lines.map(foldLine).join(CRLF) + CRLF;
}
