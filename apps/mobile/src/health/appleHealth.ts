import { Platform } from 'react-native';
import { HealthActivityType, HealthPlatform } from '@platform/shared';

import type { DailyAggregates, HealthPlatformModule } from './types';
import { isExpoGo } from './environment';

/**
 * HealthKit backend, built on @kingstinct/react-native-healthkit. Every
 * native call is wrapped: the library requires a development build (it is
 * not available in Expo Go), and a member may deny permission at any time,
 * so every path here degrades to "did nothing" rather than throwing.
 */
function healthActivityToWorkoutType(activityType: string): number {
  // Values mirror HKWorkoutActivityType (see @kingstinct/react-native-healthkit's
  // generated WorkoutActivityType enum). Kept as raw numbers so this file has
  // no hard dependency on the generated enum shape.
  const map: Record<string, number> = {
    [HealthActivityType.STRENGTH]: 20, // functionalStrengthTraining
    [HealthActivityType.FLEXIBILITY]: 62, // flexibility
    [HealthActivityType.YOGA]: 57,
    [HealthActivityType.PILATES]: 66,
    [HealthActivityType.DANCE]: 14,
    [HealthActivityType.MARTIAL_ARTS]: 28,
    [HealthActivityType.SWIMMING]: 46,
    [HealthActivityType.CYCLING]: 13,
    [HealthActivityType.RUNNING]: 37,
    [HealthActivityType.WALKING]: 52,
    [HealthActivityType.TENNIS]: 48,
    [HealthActivityType.OTHER]: 3000, // other
  };
  return map[activityType] ?? map[HealthActivityType.OTHER];
}

async function loadNativeModule() {
  if (Platform.OS !== 'ios' || isExpoGo()) return null;
  try {
    // Required lazily: importing this at module scope would try to reach the
    // native module even on Android or in Expo Go.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('@kingstinct/react-native-healthkit') as typeof import('@kingstinct/react-native-healthkit');
  } catch {
    return null;
  }
}

export const appleHealth: HealthPlatformModule = {
  platform: HealthPlatform.APPLE_HEALTH,

  async isAvailable(): Promise<boolean> {
    const hk = await loadNativeModule();
    if (!hk) return false;
    try {
      return await hk.isHealthDataAvailableAsync();
    } catch {
      return false;
    }
  },

  async requestWritePermission(): Promise<boolean> {
    const hk = await loadNativeModule();
    if (!hk) return false;
    try {
      return await hk.requestAuthorization({ toShare: ['HKWorkoutTypeIdentifier'] as unknown as never });
    } catch {
      return false;
    }
  },

  async requestReadPermission(): Promise<boolean> {
    const hk = await loadNativeModule();
    if (!hk) return false;
    try {
      return await hk.requestAuthorization({
        toRead: [
          'HKQuantityTypeIdentifierStepCount',
          'HKQuantityTypeIdentifierActiveEnergyBurned',
          'HKQuantityTypeIdentifierRestingHeartRate',
        ] as unknown as never,
      });
    } catch {
      return false;
    }
  },

  async writeWorkout({ activityType, start, end, calories }): Promise<{ success: boolean }> {
    const hk = await loadNativeModule();
    if (!hk) return { success: false };
    try {
      const workoutActivityType = healthActivityToWorkoutType(activityType) as unknown as never;
      const totals =
        calories != null
          ? ({ activeEnergyBurned: { unit: 'kcal', quantity: calories } } as unknown as never)
          : undefined;
      await hk.saveWorkoutSample(workoutActivityType, [], start, end, totals);
      return { success: true };
    } catch {
      return { success: false };
    }
  },

  async readDailyAggregates(date: Date): Promise<DailyAggregates> {
    const hk = await loadNativeModule();
    const empty: DailyAggregates = { steps: null, activeEnergyKcal: null, restingHeartRate: null };
    if (!hk) return empty;
    try {
      const start = new Date(date);
      start.setHours(0, 0, 0, 0);
      const end = new Date(date);
      end.setHours(23, 59, 59, 999);

      const [steps, activeEnergy, restingHr] = await Promise.all([
        hk
          .queryStatisticsForQuantity(
            'HKQuantityTypeIdentifierStepCount' as unknown as never,
            ['cumulativeSum' as unknown as never],
            { unit: 'count' as unknown as never, filter: { startDate: start, endDate: end } as unknown as never },
          )
          .catch(() => null),
        hk
          .queryStatisticsForQuantity(
            'HKQuantityTypeIdentifierActiveEnergyBurned' as unknown as never,
            ['cumulativeSum' as unknown as never],
            { unit: 'kcal' as unknown as never, filter: { startDate: start, endDate: end } as unknown as never },
          )
          .catch(() => null),
        hk.getMostRecentQuantitySample('HKQuantityTypeIdentifierRestingHeartRate' as unknown as never).catch(() => null),
      ]);

      return {
        steps: (steps as { sumQuantity?: { quantity?: number } } | null)?.sumQuantity?.quantity ?? null,
        activeEnergyKcal: (activeEnergy as { sumQuantity?: { quantity?: number } } | null)?.sumQuantity?.quantity ?? null,
        restingHeartRate: (restingHr as { quantity?: number } | null)?.quantity ?? null,
      };
    } catch {
      return empty;
    }
  },
};
