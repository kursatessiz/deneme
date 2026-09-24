import { z } from 'zod';
import { BadgeKind } from './enums';

/**
 * Gamification (W16): streaks, milestones, badges and monthly goals. The
 * evaluation logic (pure functions, the evaluator service) lives in
 * `apps/api/src/modules/gamification`; this file only holds the shared
 * schemas, DTOs and the badge threshold catalogue that both the API and the
 * mobile app rely on.
 */

// ---------------------------------------------------------------------------
// Badge threshold params: one Zod object per BadgeKind, validated on write.
// ---------------------------------------------------------------------------

export const MilestoneSessionsParamsSchema = z
  .object({
    kind: z.literal(BadgeKind.MILESTONE_SESSIONS),
    sessions: z.number().int().positive('Seans sayısı pozitif olmalıdır'),
  })
  .strict();

export const StreakWeeksParamsSchema = z
  .object({
    kind: z.literal(BadgeKind.STREAK_WEEKS),
    weeks: z.number().int().positive('Hafta sayısı pozitif olmalıdır'),
    /** Minimum attended sessions per ISO week to count that week. */
    minSessionsPerWeek: z.number().int().positive().default(1),
  })
  .strict();

export const MonthlyGoalMetParamsSchema = z
  .object({
    kind: z.literal(BadgeKind.MONTHLY_GOAL_MET),
  })
  .strict();

export const FirstSessionParamsSchema = z
  .object({
    kind: z.literal(BadgeKind.FIRST_SESSION),
  })
  .strict();

export const EarlyBirdParamsSchema = z
  .object({
    kind: z.literal(BadgeKind.EARLY_BIRD),
    /** Local hour (studio timezone) a session must start before, e.g. 8 for 08:00. */
    beforeHour: z.number().int().min(0).max(23).default(8),
  })
  .strict();

export const VarietyParamsSchema = z
  .object({
    kind: z.literal(BadgeKind.VARIETY),
    distinctServiceTypes: z.number().int().positive('Hizmet türü sayısı pozitif olmalıdır'),
  })
  .strict();

export const BadgeThresholdParamsSchema = z.discriminatedUnion('kind', [
  MilestoneSessionsParamsSchema,
  StreakWeeksParamsSchema,
  MonthlyGoalMetParamsSchema,
  FirstSessionParamsSchema,
  EarlyBirdParamsSchema,
  VarietyParamsSchema,
]);
export type BadgeThresholdParams = z.infer<typeof BadgeThresholdParamsSchema>;

// ---------------------------------------------------------------------------
// Badge definition CRUD
// ---------------------------------------------------------------------------

const BADGE_KEY_RE = /^[a-z0-9][a-z0-9-]{1,59}$/;

export const CreateBadgeDefinitionSchema = z
  .object({
    key: z.string().regex(BADGE_KEY_RE, 'Anahtar küçük harf, rakam ve tire içermelidir'),
    name: z.string().trim().min(2, 'Ad en az 2 karakter olmalıdır').max(100),
    description: z.string().trim().max(500).optional().or(z.literal('')),
    kind: z.nativeEnum(BadgeKind),
    threshold: BadgeThresholdParamsSchema,
    isActive: z.boolean().default(true),
  })
  .strict()
  .refine((v) => v.threshold.kind === v.kind, { message: 'threshold.kind, kind ile eşleşmelidir', path: ['threshold'] });
export type CreateBadgeDefinitionInput = z.infer<typeof CreateBadgeDefinitionSchema>;

export const UpdateBadgeDefinitionSchema = z
  .object({
    name: z.string().trim().min(2).max(100).optional(),
    description: z.string().trim().max(500).optional().or(z.literal('')),
    threshold: BadgeThresholdParamsSchema.optional(),
    isActive: z.boolean().optional(),
  })
  .strict();
export type UpdateBadgeDefinitionInput = z.infer<typeof UpdateBadgeDefinitionSchema>;

export interface BadgeDefinitionDTO {
  id: string;
  studioId: string | null;
  key: string;
  name: string;
  description: string | null;
  kind: BadgeKind;
  threshold: BadgeThresholdParams;
  isActive: boolean;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Member self-service
// ---------------------------------------------------------------------------

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
export const MonthSchema = z.string().regex(MONTH_RE, 'Ay YYYY-MM biçiminde olmalıdır');

export const SetMonthlyGoalSchema = z
  .object({
    month: MonthSchema,
    targetSessions: z.number().int().positive('Hedef pozitif olmalıdır').max(100),
  })
  .strict();
export type SetMonthlyGoalInput = z.infer<typeof SetMonthlyGoalSchema>;

export const LeaderboardOptInSchema = z.object({ optedIn: z.boolean() }).strict();
export type LeaderboardOptInInput = z.infer<typeof LeaderboardOptInSchema>;

export const LeaderboardQuerySchema = z.object({ month: MonthSchema }).strict();
export type LeaderboardQuery = z.infer<typeof LeaderboardQuerySchema>;

export const UpdateGamificationSettingsSchema = z.object({ enabled: z.boolean() }).strict();
export type UpdateGamificationSettingsInput = z.infer<typeof UpdateGamificationSettingsSchema>;

export interface GamificationSettingsDTO {
  enabled: boolean;
}

export interface EarnedBadgeDTO {
  badgeDefinitionId: string;
  key: string;
  name: string;
  description: string | null;
  kind: BadgeKind;
  earnedAt: string;
}

export interface NextBadgeProgressDTO {
  badgeDefinitionId: string;
  key: string;
  name: string;
  description: string | null;
  kind: BadgeKind;
  /** 0..1, how close the member is to earning it. */
  progressRatio: number;
  progressLabel: string;
}

export interface MonthlyGoalStatusDTO {
  month: string;
  targetSessions: number | null;
  progress: number;
  metGoal: boolean;
}

export interface MyGamificationStatsDTO {
  totalAttendedSessions: number;
  currentStreakWeeks: number;
  bestStreakWeeks: number;
  currentMonth: MonthlyGoalStatusDTO;
  leaderboardOptedIn: boolean;
  earnedBadges: EarnedBadgeDTO[];
  nextBadges: NextBadgeProgressDTO[];
}

export interface LeaderboardEntryDTO {
  rank: number;
  /** First name and last initial only, e.g. "Ayşe Y.", regardless of caller's role. */
  displayName: string;
  sessions: number;
  isSelf: boolean;
}

export interface LeaderboardDTO {
  month: string;
  entries: LeaderboardEntryDTO[];
}

export interface MemberAchievementSummaryDTO {
  memberId: string;
  memberName: string;
  totalAttendedSessions: number;
  currentStreakWeeks: number;
  bestStreakWeeks: number;
  badgeCount: number;
}

/** First name plus the initial of the last name, e.g. "Ayşe Yılmaz" -> "Ayşe Y.". */
export function maskLeaderboardName(firstName: string, lastName: string): string {
  const initial = lastName.trim().charAt(0).toLocaleUpperCase('tr-TR');
  return initial ? `${firstName.trim()} ${initial}.` : firstName.trim();
}
