import { z } from 'zod';
import { VideoContentProvider, VideoContentVisibility } from './enums';
import { HttpsUrlSchema } from './validators';

/**
 * W19: live online sessions (join links, delivery mode) and the on-demand
 * video library (VideoContent/VideoView). See docs/VIDEO.md.
 */

// ---------------------------------------------------------------------------
// Live session join
// ---------------------------------------------------------------------------

/** Minutes before a session's start that the join link becomes available. */
export const JOIN_WINDOW_MINUTES_BEFORE = 15;

/**
 * Whether the join link should be handed out right now: from
 * JOIN_WINDOW_MINUTES_BEFORE start until the session ends. Pure function,
 * unit tested directly (see schedules module video specs).
 */
export function isWithinJoinWindow(startTime: Date, endTime: Date, now: Date): boolean {
  const opensAt = new Date(startTime.getTime() - JOIN_WINDOW_MINUTES_BEFORE * 60 * 1000);
  return now >= opensAt && now <= endTime;
}

export interface JoinSessionResultDTO {
  joinUrl: string;
  scheduleId: string;
  startTime: string;
  endTime: string;
}

// ---------------------------------------------------------------------------
// On-demand video library
// ---------------------------------------------------------------------------

export const CreateVideoContentSchema = z
  .object({
    title: z.string().trim().min(3, 'Başlık en az 3 karakter olmalıdır').max(150),
    description: z.string().trim().max(2000).optional().or(z.literal('')),
    durationSeconds: z.number().int().positive('Süre 0 dan büyük olmalıdır'),
    provider: z.nativeEnum(VideoContentProvider).default(VideoContentProvider.EXTERNAL_URL),
    sourceUrl: HttpsUrlSchema.optional(),
    thumbnailUrl: HttpsUrlSchema.optional(),
    serviceTypeId: z.string().uuid().optional(),
    trainerProfileId: z.string().uuid().optional(),
    visibility: z.nativeEnum(VideoContentVisibility).default(VideoContentVisibility.ALL_MEMBERS),
    packageDefinitionIds: z.array(z.string().uuid()).max(50).default([]),
    creditCost: z.number().int().positive().optional(),
  })
  .refine((v) => v.provider !== VideoContentProvider.EXTERNAL_URL || !!v.sourceUrl, {
    path: ['sourceUrl'],
    message: 'Harici bağlantı için https bağlantısı giriniz',
  })
  .refine((v) => v.provider !== VideoContentProvider.UPLOADED, {
    path: ['provider'],
    message: 'Yükleme henüz desteklenmiyor, yalnızca harici bağlantı kullanılabilir',
  })
  .refine((v) => v.visibility !== VideoContentVisibility.SPECIFIC_PACKAGES || v.packageDefinitionIds.length > 0, {
    path: ['packageDefinitionIds'],
    message: 'Belirli paketler için en az bir paket seçmelisiniz',
  });
export type CreateVideoContentInput = z.infer<typeof CreateVideoContentSchema>;

export const UpdateVideoContentSchema = CreateVideoContentSchema;
export type UpdateVideoContentInput = z.infer<typeof UpdateVideoContentSchema>;

export const ListVideoContentQuerySchema = z
  .object({
    serviceTypeId: z.string().uuid().optional(),
    publishedOnly: z.coerce.boolean().default(false),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();
export type ListVideoContentQueryInput = z.infer<typeof ListVideoContentQuerySchema>;

export const StartWatchingSchema = z
  .object({
    /** Required only when the content has a creditCost and was never charged before. */
    memberPackageId: z.string().uuid().optional(),
  })
  .strict();
export type StartWatchingInput = z.infer<typeof StartWatchingSchema>;

export const RecordVideoProgressSchema = z
  .object({
    positionSeconds: z.number().int().nonnegative(),
    completed: z.boolean().default(false),
  })
  .strict();
export type RecordVideoProgressInput = z.infer<typeof RecordVideoProgressSchema>;

export interface VideoContentDTO {
  id: string;
  studioId: string;
  title: string;
  description: string | null;
  durationSeconds: number;
  provider: VideoContentProvider;
  sourceUrl: string | null;
  thumbnailUrl: string | null;
  serviceTypeId: string | null;
  serviceTypeName: string | null;
  trainerProfileId: string | null;
  trainerName: string | null;
  visibility: VideoContentVisibility;
  packageDefinitionIds: string[];
  creditCost: number | null;
  isPublished: boolean;
  publishedAt: string | null;
  createdAt: string;
}

/** Member-facing card: same as VideoContentDTO plus lock/resume state. */
export interface MemberVideoContentDTO extends VideoContentDTO {
  isLocked: boolean;
  /** Turkish explanation of why it is locked (null when unlocked). */
  lockedReason: string | null;
  lastPositionSeconds: number | null;
  completedAt: string | null;
  isCreditCharged: boolean;
}

export interface VideoContentStatsDTO {
  contentId: string;
  title: string;
  views: number;
  completions: number;
  uniqueViewers: number;
}
