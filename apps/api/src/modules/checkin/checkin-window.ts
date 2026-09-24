/**
 * Pure time-window math for QR/kiosk check-in (W17), kept separate from
 * CheckInService so it can be unit tested without a database.
 */
export function computeCheckInWindow(
  now: Date,
  beforeMinutes: number,
  afterMinutes: number,
): { windowStart: Date; windowEnd: Date } {
  return {
    windowStart: new Date(now.getTime() - beforeMinutes * 60_000),
    windowEnd: new Date(now.getTime() + afterMinutes * 60_000),
  };
}

/** Sorts candidate session start times by closeness to `now`, nearest first. */
export function sortByClosestStart<T>(items: T[], startOf: (item: T) => Date, now: Date): T[] {
  return [...items].sort((a, b) => Math.abs(startOf(a).getTime() - now.getTime()) - Math.abs(startOf(b).getTime() - now.getTime()));
}
