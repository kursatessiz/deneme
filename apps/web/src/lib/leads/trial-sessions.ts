import type { ScheduleRow } from '@/lib/calendar/types';

/** Trial-picker candidate: enough of a schedule row to label and pick a session. */
export type TrialSessionRow = Pick<ScheduleRow, 'id' | 'branchId' | 'startTime' | 'endTime' | 'isCancelled' | 'bookedCount' | 'capacity'> & {
  title: string;
  serviceType?: { name?: string } | null;
};

/**
 * Upcoming, non-cancelled, not-full sessions in the next `days` days
 * (default 14), optionally restricted to one branch. Used by the lead
 * trial-booking picker instead of a free-text schedule id. `now` is
 * injectable for tests.
 */
export function upcomingTrialSessions<T extends TrialSessionRow>(
  schedules: T[],
  options: { branchId?: string | null; days?: number; now?: Date } = {},
): T[] {
  const now = options.now ?? new Date();
  const horizon = new Date(now.getTime() + (options.days ?? 14) * 24 * 60 * 60 * 1000);
  return schedules
    .filter((s) => !s.isCancelled)
    .filter((s) => {
      const start = new Date(s.startTime);
      return start >= now && start <= horizon;
    })
    .filter((s) => s.bookedCount < s.capacity)
    .filter((s) => !options.branchId || s.branchId === options.branchId)
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
}
