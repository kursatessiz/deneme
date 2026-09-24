import { Platform } from 'react-native';
import {
  HealthPlatform,
  resolveHealthActivityType,
  type HealthSettingsDTO,
  type HealthSyncRecordDTO,
  type PendingHealthWorkoutDTO,
} from '@platform/shared';

import { apiRequest } from '../lib/api';
import { appleHealth } from './appleHealth';
import { healthConnect } from './healthConnect';
import { hasSyncedLocally, markSyncedLocally } from './localSyncCache';
import type { HealthPlatformModule } from './types';

export type { DailyAggregates, HealthPlatformModule } from './types';
export { isExpoGo } from './environment';
export * from './localSyncCache';

/** The health platform module for the current device, or null on web/unsupported OSes. */
export function currentHealthModule(): HealthPlatformModule | null {
  if (Platform.OS === 'ios') return appleHealth;
  if (Platform.OS === 'android') return healthConnect;
  return null;
}

export interface AttendedBookingForSync {
  bookingId: string;
  memberId: string;
  /** The tenant's ServiceType.healthActivityType, already resolved server-side; never sector-specific here. */
  healthActivityType: string;
  startTime: string; // ISO
  endTime: string; // ISO
  /** Only present when the member entered it themselves; never estimated. */
  calories?: number | null;
}

/**
 * Write direction (W21 item 1): call this once a booking's status becomes
 * ATTENDED. Idempotent both locally (localSyncCache) and on the server
 * (HealthSyncRecord's unique constraint) -- calling it twice for the same
 * booking is always safe and never writes to the health store twice.
 */
export async function syncAttendedBookingToHealth(
  studioId: string,
  booking: AttendedBookingForSync,
): Promise<{ synced: boolean; reason?: string }> {
  const module = currentHealthModule();
  if (!module) return { synced: false, reason: 'unsupported-platform' };

  const settings = await apiRequest<HealthSettingsDTO>('/me/health/settings', { studioId }).catch(() => null);
  if (!settings?.writeWorkouts || !settings.hasActiveConsent) {
    return { synced: false, reason: 'not-opted-in' };
  }

  if (await hasSyncedLocally(booking.memberId, booking.bookingId, module.platform)) {
    return { synced: false, reason: 'already-synced-locally' };
  }

  const available = await module.isAvailable();
  if (!available) return { synced: false, reason: 'health-store-unavailable' };

  const granted = await module.requestWritePermission();
  if (!granted) return { synced: false, reason: 'permission-denied' };

  const activityType = resolveHealthActivityType(booking.healthActivityType);
  const result = await module.writeWorkout({
    activityType,
    start: new Date(booking.startTime),
    end: new Date(booking.endTime),
    calories: booking.calories ?? null,
  });
  if (!result.success) return { synced: false, reason: 'native-write-failed' };

  // Record with the server first (its unique constraint is the source of
  // truth for idempotency); only then remember it locally, so a crash
  // between the two never hides a booking that still needs syncing.
  await apiRequest<HealthSyncRecordDTO>('/me/health/sync-records', {
    method: 'POST',
    studioId,
    body: { bookingId: booking.bookingId, platform: module.platform === HealthPlatform.APPLE_HEALTH ? 'APPLE_HEALTH' : 'HEALTH_CONNECT' },
  }).catch(() => null);
  await markSyncedLocally(booking.memberId, booking.bookingId, module.platform);

  return { synced: true };
}

/**
 * Called opportunistically (app foreground, home screen mount) alongside
 * the existing widget/rating-prompt refresh. Fetches attended bookings the
 * server still considers eligible and writes each one that has not already
 * been synced on this device, one at a time, never failing loudly: a member
 * without a linked development build simply gets no-ops throughout.
 */
export async function syncAllPendingWorkouts(studioId: string, memberId: string): Promise<number> {
  const module = currentHealthModule();
  if (!module) return 0;

  const pending = await apiRequest<PendingHealthWorkoutDTO[]>('/me/health/pending-workouts', { studioId }).catch(() => []);
  let synced = 0;
  for (const booking of pending) {
    if (await hasSyncedLocally(memberId, booking.bookingId, module.platform)) continue;
    const result = await syncAttendedBookingToHealth(studioId, {
      bookingId: booking.bookingId,
      memberId,
      healthActivityType: booking.healthActivityType,
      startTime: booking.startTime,
      endTime: booking.endTime,
    });
    if (result.synced) synced += 1;
  }
  return synced;
}

/**
 * Read direction (W21 item 2): reads today's on-device aggregates and, only
 * when the member has separately opted into shareWithStudio, uploads them.
 * Never uploads raw samples, only the one daily aggregate row.
 */
export async function syncTodayAggregatesIfOptedIn(studioId: string): Promise<{ uploaded: boolean }> {
  const module = currentHealthModule();
  if (!module) return { uploaded: false };

  const settings = await apiRequest<HealthSettingsDTO>('/me/health/settings', { studioId }).catch(() => null);
  if (!settings?.readAggregates || !settings.shareWithStudio || !settings.hasActiveConsent) {
    return { uploaded: false };
  }

  const available = await module.isAvailable();
  if (!available) return { uploaded: false };
  const granted = await module.requestReadPermission();
  if (!granted) return { uploaded: false };

  const today = new Date();
  const aggregates = await module.readDailyAggregates(today);
  if (aggregates.steps == null && aggregates.activeEnergyKcal == null && aggregates.restingHeartRate == null) {
    return { uploaded: false };
  }

  const date = today.toISOString().slice(0, 10);
  await apiRequest('/me/health/summaries', {
    method: 'POST',
    studioId,
    body: {
      summaries: [
        {
          date,
          steps: aggregates.steps ?? undefined,
          activeEnergyKcal: aggregates.activeEnergyKcal ?? undefined,
          restingHeartRate: aggregates.restingHeartRate ?? undefined,
        },
      ],
    },
  });
  return { uploaded: true };
}
