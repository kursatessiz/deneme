import { z } from 'zod';
import { HealthActivityType, HealthPlatform } from './enums';

/**
 * Apple Health / Android Health Connect integration (W21). Health data is
 * special-category personal data under KVKK: every setting defaults to off,
 * writing and reading are separate opt-ins, and sharing daily aggregates
 * with the studio is a third, separate opt-in on top of reading them. This
 * file only holds the shared schemas and DTOs; native platform code lives in
 * apps/mobile, the persistence and consent checks in apps/api.
 */

export { HealthActivityType, HealthPlatform };

// ---------------------------------------------------------------------------
// Member self-service settings
// ---------------------------------------------------------------------------

export const UpdateHealthSettingsSchema = z
  .object({
    /** Write attended-session workouts to the device's health store. */
    writeWorkouts: z.boolean(),
    /** Read daily step / active energy / resting heart rate aggregates on-device. */
    readAggregates: z.boolean(),
    /** Upload those daily aggregates to the server for staff to see trends. */
    shareWithStudio: z.boolean(),
  })
  .strict();
export type UpdateHealthSettingsInput = z.infer<typeof UpdateHealthSettingsSchema>;

export interface HealthSettingsDTO {
  writeWorkouts: boolean;
  readAggregates: boolean;
  shareWithStudio: boolean;
  /** Whether the member has an active HEALTH_DATA consent on file. */
  hasActiveConsent: boolean;
}

// ---------------------------------------------------------------------------
// Consent
// ---------------------------------------------------------------------------

export const AcceptHealthConsentSchema = z
  .object({
    device: z.string().trim().max(200).optional(),
  })
  .strict();
export type AcceptHealthConsentInput = z.infer<typeof AcceptHealthConsentSchema>;

export interface HealthConsentStatusDTO {
  hasActiveConsent: boolean;
  documentVersionId: string | null;
  version: number | null;
  acceptedAt: string | null;
}

// ---------------------------------------------------------------------------
// Daily aggregate upload (steps / active energy / resting heart rate only)
// ---------------------------------------------------------------------------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const HealthDailySummaryEntrySchema = z
  .object({
    date: z.string().regex(DATE_RE, 'Tarih YYYY-AA-GG biçiminde olmalıdır'),
    steps: z.number().int().min(0, 'Adım sayısı negatif olamaz').max(100_000, 'Adım sayısı çok yüksek').optional(),
    activeEnergyKcal: z
      .number()
      .min(0, 'Kalori negatif olamaz')
      .max(10_000, 'Kalori çok yüksek')
      .optional(),
    restingHeartRate: z
      .number()
      .int()
      .min(25, 'Dinlenme nabzı çok düşük')
      .max(220, 'Dinlenme nabzı çok yüksek')
      .optional(),
  })
  .strict();
export type HealthDailySummaryEntry = z.infer<typeof HealthDailySummaryEntrySchema>;

/** Batch upsert, capped at 31 days (roughly one month) per call. */
export const UpsertHealthSummariesSchema = z
  .object({
    summaries: z
      .array(HealthDailySummaryEntrySchema)
      .min(1, 'En az bir gün gönderilmelidir')
      .max(31, 'Tek seferde en fazla 31 gün gönderilebilir'),
  })
  .strict()
  .refine((v) => new Set(v.summaries.map((s) => s.date)).size === v.summaries.length, {
    message: 'Aynı tarih birden fazla kez gönderilemez',
    path: ['summaries'],
  });
export type UpsertHealthSummariesInput = z.infer<typeof UpsertHealthSummariesSchema>;

export interface HealthDailySummaryDTO {
  date: string;
  steps: number | null;
  activeEnergyKcal: number | null;
  restingHeartRate: number | null;
}

// ---------------------------------------------------------------------------
// Sync records (idempotent workout write tracking)
// ---------------------------------------------------------------------------

export const CreateHealthSyncRecordSchema = z
  .object({
    bookingId: z.string().uuid(),
    platform: z.nativeEnum(HealthPlatform),
  })
  .strict();
export type CreateHealthSyncRecordInput = z.infer<typeof CreateHealthSyncRecordSchema>;

export interface HealthSyncRecordDTO {
  id: string;
  bookingId: string;
  platform: HealthPlatform;
  syncedAt: string;
}

// ---------------------------------------------------------------------------
// Staff view of a member's health trend (permission members.health.view,
// only when the member's shareWithStudio toggle is on)
// ---------------------------------------------------------------------------

export interface MemberHealthTrendDTO {
  memberId: string;
  shareWithStudio: boolean;
  summaries: HealthDailySummaryDTO[];
}

/**
 * An attended booking the app may still need to write to the device health
 * store (write direction, item 1). Server-side eligibility only checks
 * writeWorkouts + consent; the client is the one that knows whether it has
 * already written this particular (member, booking, platform) locally.
 */
export interface PendingHealthWorkoutDTO {
  bookingId: string;
  healthActivityType: HealthActivityType;
  startTime: string;
  endTime: string;
}

// ---------------------------------------------------------------------------
// Mapping ServiceType -> HealthActivityType label (Turkish, for UI pickers)
// ---------------------------------------------------------------------------

/**
 * Maps a tenant's ServiceType.healthActivityType (already a generic type,
 * never sector-specific) to itself, falling back to OTHER for anything
 * unrecognized -- e.g. a value from a Prisma enum extended after this shared
 * package was built. Pure and side-effect free so both the API and the
 * mobile write-path can share it.
 */
export function resolveHealthActivityType(value: string | null | undefined): HealthActivityType {
  if (value && (Object.values(HealthActivityType) as string[]).includes(value)) {
    return value as HealthActivityType;
  }
  return HealthActivityType.OTHER;
}

/**
 * The idempotency key for a health workout write: one write per
 * (member, booking, platform), matching the HealthSyncRecord unique
 * constraint. Used identically by the mobile app's local dedupe cache and by
 * the server so both halves of the idempotency guarantee agree.
 */
export function healthSyncIdempotencyKey(memberId: string, bookingId: string, platform: HealthPlatform): string {
  return `${memberId}:${bookingId}:${platform}`;
}

export const HEALTH_ACTIVITY_TYPE_LABELS: Record<HealthActivityType, string> = {
  [HealthActivityType.STRENGTH]: 'Kuvvet antrenmanı',
  [HealthActivityType.FLEXIBILITY]: 'Esneklik',
  [HealthActivityType.YOGA]: 'Yoga',
  [HealthActivityType.PILATES]: 'Pilates',
  [HealthActivityType.DANCE]: 'Dans',
  [HealthActivityType.MARTIAL_ARTS]: 'Dövüş sanatları',
  [HealthActivityType.SWIMMING]: 'Yüzme',
  [HealthActivityType.CYCLING]: 'Bisiklet',
  [HealthActivityType.RUNNING]: 'Koşu',
  [HealthActivityType.WALKING]: 'Yürüyüş',
  [HealthActivityType.TENNIS]: 'Tenis',
  [HealthActivityType.OTHER]: 'Diğer',
};
