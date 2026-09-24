import { Platform } from 'react-native';
import { HealthActivityType, HealthPlatform } from '@platform/shared';

import type { DailyAggregates, HealthPlatformModule } from './types';
import { isExpoGo } from './environment';

/**
 * Health Connect backend, built on react-native-health-connect. Same
 * defensive shape as appleHealth.ts: no native module in Expo Go, and every
 * call can be refused by the user at any time.
 */
const EXERCISE_TYPE: Record<string, number> = {
  [HealthActivityType.STRENGTH]: 70, // STRENGTH_TRAINING
  [HealthActivityType.FLEXIBILITY]: 71, // STRETCHING
  [HealthActivityType.YOGA]: 83,
  [HealthActivityType.PILATES]: 48,
  [HealthActivityType.DANCE]: 16, // DANCING
  [HealthActivityType.MARTIAL_ARTS]: 44,
  [HealthActivityType.SWIMMING]: 74, // SWIMMING_POOL
  [HealthActivityType.CYCLING]: 8, // BIKING
  [HealthActivityType.RUNNING]: 56,
  [HealthActivityType.WALKING]: 79,
  [HealthActivityType.TENNIS]: 76,
  [HealthActivityType.OTHER]: 0, // OTHER_WORKOUT
};

async function loadNativeModule() {
  if (Platform.OS !== 'android' || isExpoGo()) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('react-native-health-connect') as typeof import('react-native-health-connect');
  } catch {
    return null;
  }
}

const WRITE_PERMISSIONS = [{ accessType: 'write', recordType: 'ExerciseSession' }] as const;
const READ_PERMISSIONS = [
  { accessType: 'read', recordType: 'Steps' },
  { accessType: 'read', recordType: 'ActiveCaloriesBurned' },
  { accessType: 'read', recordType: 'RestingHeartRate' },
] as const;

export const healthConnect: HealthPlatformModule = {
  platform: HealthPlatform.HEALTH_CONNECT,

  async isAvailable(): Promise<boolean> {
    const hc = await loadNativeModule();
    if (!hc) return false;
    try {
      const status = await hc.getSdkStatus();
      // SdkAvailabilityStatus.SDK_AVAILABLE === 3 in react-native-health-connect.
      return status === 3;
    } catch {
      return false;
    }
  },

  async requestWritePermission(): Promise<boolean> {
    const hc = await loadNativeModule();
    if (!hc) return false;
    try {
      await hc.initialize();
      const granted = await hc.requestPermission(WRITE_PERMISSIONS as unknown as never);
      return granted.length > 0;
    } catch {
      return false;
    }
  },

  async requestReadPermission(): Promise<boolean> {
    const hc = await loadNativeModule();
    if (!hc) return false;
    try {
      await hc.initialize();
      const granted = await hc.requestPermission(READ_PERMISSIONS as unknown as never);
      return granted.length > 0;
    } catch {
      return false;
    }
  },

  async writeWorkout({ activityType, start, end }): Promise<{ success: boolean }> {
    const hc = await loadNativeModule();
    if (!hc) return { success: false };
    try {
      await hc.insertRecords([
        {
          recordType: 'ExerciseSession',
          exerciseType: EXERCISE_TYPE[activityType] ?? EXERCISE_TYPE[HealthActivityType.OTHER],
          startTime: start.toISOString(),
          endTime: end.toISOString(),
        },
      ] as unknown as never);
      return { success: true };
    } catch {
      return { success: false };
    }
  },

  async readDailyAggregates(date: Date): Promise<DailyAggregates> {
    const hc = await loadNativeModule();
    const empty: DailyAggregates = { steps: null, activeEnergyKcal: null, restingHeartRate: null };
    if (!hc) return empty;
    try {
      const start = new Date(date);
      start.setHours(0, 0, 0, 0);
      const end = new Date(date);
      end.setHours(23, 59, 59, 999);
      const timeRangeFilter = { operator: 'between', startTime: start.toISOString(), endTime: end.toISOString() };

      const [stepsResult, energyResult, restingResult] = await Promise.all([
        hc
          .aggregateRecord({ recordType: 'Steps', timeRangeFilter } as unknown as never)
          .catch(() => null),
        hc
          .aggregateRecord({ recordType: 'ActiveCaloriesBurned', timeRangeFilter } as unknown as never)
          .catch(() => null),
        hc
          .readRecords('RestingHeartRate' as unknown as never, { timeRangeFilter } as unknown as never)
          .catch(() => null),
      ]);

      const steps = (stepsResult as { COUNT_TOTAL?: number } | null)?.COUNT_TOTAL ?? null;
      const energy = (energyResult as { ACTIVE_CALORIES_TOTAL?: { inKilocalories?: number } } | null)
        ?.ACTIVE_CALORIES_TOTAL?.inKilocalories ?? null;
      const restingRecords = (restingResult as { records?: { beatsPerMinute?: number }[] } | null)?.records ?? [];
      const restingHeartRate = restingRecords.length
        ? Math.round(restingRecords.reduce((sum, r) => sum + (r.beatsPerMinute ?? 0), 0) / restingRecords.length)
        : null;

      return { steps, activeEnergyKcal: energy, restingHeartRate };
    } catch {
      return empty;
    }
  },
};
