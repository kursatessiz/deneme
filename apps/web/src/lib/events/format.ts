import type { ZonedFormatters } from '@/lib/zoned-time';

/**
 * One line for a time span on the clock of the zone the formatters were built for: the second end drops the
 * date when both fall on the same day. The zone name is not part of the line; callers show it once per block.
 */
export function formatSpan(f: ZonedFormatters, startsAt: string, endsAt: string | null): string {
  if (!endsAt) return f.dateTime(startsAt);
  if (f.dayKey(startsAt) === f.dayKey(endsAt)) return `${f.dateTime(startsAt)} - ${f.time(endsAt)}`;
  return `${f.dateTime(startsAt)} - ${f.dateTime(endsAt)}`;
}

/** Collapses whitespace and clips to `max` characters (ellipsis included) for a meta description. */
export function summarize(text: string | null | undefined, max = 160): string {
  const flat = (text ?? '').replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max - 1).trimEnd()}…`;
}
