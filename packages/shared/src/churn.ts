import { z } from 'zod';

/**
 * W12 churn risk: tenant-tunable scoring weights (Studio.churnWeights) and
 * the machine-key -> Turkish label dictionary for score reasons. The actual
 * scoring function lives in apps/api (business logic rule, CLAUDE.md #7)
 * at apps/api/src/modules/churn/churn-scoring.ts; this file is only the
 * shared, validated shape of its tunable inputs and vocabulary.
 */

export const CHURN_RISK_LEVELS = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type ChurnRiskLevel = (typeof CHURN_RISK_LEVELS)[number];

/**
 * Every weight is the maximum number of points a signal can contribute.
 * The scoring function scales a triggered signal's points between 0 and its
 * weight, so the sum of all weights need not be 100 -- the total score is
 * always clamped to [0, 100]. Days/threshold fields tune when a signal
 * starts contributing and when it caps out.
 */
export const ChurnWeightsSchema = z
  .object({
    // Attendance dropped in the last 28 days vs the 28 days before that.
    attendanceDeclineWeight: z.number().int().min(0).max(100).default(20),
    /** Ratio (0-1) of (previous - last) / previous at or above which the signal is fully triggered. */
    attendanceDeclineRatio: z.number().min(0.01).max(1).default(0.5),

    // Days since the member's last attended session.
    inactivityWeight: z.number().int().min(0).max(100).default(25),
    /** Days of inactivity before this signal starts contributing points. */
    inactivityThresholdDays: z.number().int().min(1).max(365).default(14),
    /** Days of inactivity at which this signal reaches its full weight. */
    inactivityMaxDays: z.number().int().min(1).max(730).default(60),

    // Active/frozen package ending soon with no renewal already purchased.
    packageEndingWeight: z.number().int().min(0).max(100).default(15),
    /** Window (days before end date) in which "ending soon" triggers. */
    packageEndingWindowDays: z.number().int().min(1).max(90).default(7),

    // Active package nearly out of session/credit units, no renewal purchased.
    packageLowUnitsWeight: z.number().int().min(0).max(100).default(15),
    /** Remaining units at or below this trigger the signal. */
    packageLowUnitsThreshold: z.number().int().min(0).max(50).default(2),

    // Package currently frozen.
    packageFrozenWeight: z.number().int().min(0).max(100).default(10),

    // Late cancellations + no-shows in the last 28 days.
    lateCancelNoShowWeight: z.number().int().min(0).max(100).default(15),
    /** Count of late cancels + no-shows in 28 days at which this signal reaches full weight. */
    lateCancelNoShowMaxCount: z.number().int().min(1).max(50).default(4),

    // Failed dunning payment attempts in the last 28 days.
    failedPaymentWeight: z.number().int().min(0).max(100).default(20),
    /** Failed attempts in 28 days at which this signal reaches full weight. */
    failedPaymentMaxCount: z.number().int().min(1).max(20).default(2),

    // Level thresholds; score >= highThreshold is HIGH, >= mediumThreshold is MEDIUM, else LOW.
    mediumThreshold: z.number().int().min(1).max(99).default(40),
    highThreshold: z.number().int().min(1).max(100).default(70),

    // New members inside this window get onboarding: true and skip the
    // attendance-trend and inactivity signals (too little history yet).
    onboardingDays: z.number().int().min(0).max(180).default(60),
  })
  .strict()
  .refine((v) => v.mediumThreshold < v.highThreshold, {
    message: 'Orta seviye eşiği yüksek seviye eşiğinden küçük olmalıdır',
    path: ['mediumThreshold'],
  });
export type ChurnWeights = z.infer<typeof ChurnWeightsSchema>;

export const DEFAULT_CHURN_WEIGHTS: ChurnWeights = ChurnWeightsSchema.parse({});

/** Studio.churnWeights is untrusted JSON (or null) until parsed; falls back to defaults on garbage. */
export function parseChurnWeights(raw: unknown): ChurnWeights {
  if (raw === null || raw === undefined) return DEFAULT_CHURN_WEIGHTS;
  const result = ChurnWeightsSchema.safeParse(raw);
  return result.success ? result.data : DEFAULT_CHURN_WEIGHTS;
}

/** Machine reason keys the scoring function may return, with their Turkish labels. */
export const CHURN_REASON_KEYS = [
  'attendance_declining',
  'inactive',
  'package_ending_soon',
  'package_low_units',
  'package_frozen',
  'late_cancels_no_shows',
  'failed_payments',
  'onboarding',
] as const;
export type ChurnReasonKey = (typeof CHURN_REASON_KEYS)[number];

export const CHURN_REASON_LABELS: Record<ChurnReasonKey, string> = {
  attendance_declining: 'Katılım son 28 günde düştü',
  inactive: 'Uzun süredir derse gelmiyor',
  package_ending_soon: 'Aktif paketi yakında bitiyor, yenileme yok',
  package_low_units: 'Paket hakkı neredeyse tükendi, yenileme yok',
  package_frozen: 'Paketi dondurulmuş',
  late_cancels_no_shows: 'Son 28 günde geç iptal / gelmeme',
  failed_payments: 'Son 28 günde başarısız ödeme denemesi',
  onboarding: 'Yeni üye (ilk 60 gün, alışma sürecinde)',
};

export interface ChurnReasonDTO {
  key: ChurnReasonKey;
  label: string;
  points: number;
  detail?: Record<string, number | string | null>;
}

export interface ChurnMemberSummaryDTO {
  memberId: string;
  membershipId: string;
  firstName: string;
  lastName: string;
  /** Only present when the caller has members.contact.view. */
  phone?: string;
  homeBranchId: string | null;
  score: number;
  previousScore: number | null;
  level: ChurnRiskLevel;
  onboarding: boolean;
  reasons: ChurnReasonDTO[];
  lastAttendedAt: string | null;
  activePackageEndDate: string | null;
  contactedAt: string | null;
  snoozedUntil: string | null;
  computedAt: string;
}

export interface ChurnListResponseDTO {
  items: ChurnMemberSummaryDTO[];
  total: number;
  page: number;
  limit: number;
}

export interface ChurnLevelCountDTO {
  level: ChurnRiskLevel;
  count: number;
  previousCount: number;
}

export interface ChurnSummaryDTO {
  studioId: string;
  counts: ChurnLevelCountDTO[];
  computedAt: string | null;
}

export const ChurnListQuerySchema = z.object({
  level: z.enum(CHURN_RISK_LEVELS).optional(),
  branchId: z.string().uuid().optional(),
  includeSnoozed: z.coerce.boolean().default(false),
  search: z.string().trim().max(150).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  format: z.enum(['json', 'csv']).default('json'),
});
export type ChurnListQuery = z.infer<typeof ChurnListQuerySchema>;

export const ChurnRecomputeSchema = z
  .object({
    /** Only honoured by the API when NODE_ENV=test, for deterministic e2e fixtures. */
    now: z.string().datetime().optional(),
  })
  .optional();
export type ChurnRecomputeInput = z.infer<typeof ChurnRecomputeSchema>;

export const MarkContactedSchema = z.object({
  note: z.string().trim().min(1, 'Not giriniz').max(1000),
});
export type MarkContactedInput = z.infer<typeof MarkContactedSchema>;

export const SnoozeRiskSchema = z.object({
  days: z.number().int().min(1).max(180),
});
export type SnoozeRiskInput = z.infer<typeof SnoozeRiskSchema>;

export const UpdateChurnWeightsSchema = ChurnWeightsSchema;
export type UpdateChurnWeightsInput = z.infer<typeof UpdateChurnWeightsSchema>;
