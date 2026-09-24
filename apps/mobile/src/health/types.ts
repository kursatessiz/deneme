import type { HealthPlatform } from '@platform/shared';

/**
 * The thin, platform-neutral contract every backend (Apple HealthKit,
 * Android Health Connect, and the Expo Go no-op fallback) implements. Kept
 * intentionally small: only what the write and read directions of W21 need.
 */
export interface DailyAggregates {
  steps: number | null;
  activeEnergyKcal: number | null;
  restingHeartRate: number | null;
}

export interface HealthPlatformModule {
  readonly platform: HealthPlatform;
  /** True only on a real device build where the native module is linked and the OS supports it. */
  isAvailable(): Promise<boolean>;
  requestWritePermission(): Promise<boolean>;
  requestReadPermission(): Promise<boolean>;
  /**
   * Writes one attended-session workout. Calories are only included when
   * the member entered them; nothing else is ever sent along.
   */
  writeWorkout(input: {
    activityType: string; // a HealthActivityType value, mapped internally per platform
    start: Date;
    end: Date;
    calories?: number | null;
  }): Promise<{ success: boolean }>;
  /** Aggregates for a single calendar day, in the device's local timezone. */
  readDailyAggregates(date: Date): Promise<DailyAggregates>;
}
