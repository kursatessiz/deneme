import { ApiError } from './api';

/** apiErrors key the API answers with when a booking breaks the service's minimum repeat interval. */
export const REPEAT_INTERVAL_ERROR_CODE = 'apiErrors.schedules.minRepeatIntervalNotElapsed';

export interface RepeatIntervalConflict {
  count: number;
  /** ISO instant of the conflicting session. */
  date: string;
}

/**
 * Reads the minimum-repeat-interval rejection of a staff booking, so the UI can offer the
 * override. Returns null for any other error.
 */
export function repeatIntervalConflict(error: unknown): RepeatIntervalConflict | null {
  if (!(error instanceof ApiError) || error.status !== 400 || error.code !== REPEAT_INTERVAL_ERROR_CODE) return null;
  const count = Number(error.params?.count);
  const date = error.params?.date;
  if (!Number.isFinite(count) || typeof date !== 'string') return null;
  return { count, date };
}
