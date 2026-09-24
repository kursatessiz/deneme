import { z } from 'zod';
import { ReferralRewardType, ReferralStatus } from './enums';

/**
 * W15: post-class ratings, Google review redirect, refer-a-friend. See
 * docs/FEEDBACK_REFERRAL.md.
 */

// ---------------------------------------------------------------------------
// Ratings
// ---------------------------------------------------------------------------

export const RATING_WINDOW_DAYS = 7;
export const RATING_EDIT_WINDOW_HOURS = 24;
/** Ratings at or below this score notify the owner (category FEEDBACK). */
export const LOW_RATING_THRESHOLD = 2;
/** Ratings at or above this score are eligible for the Google review prompt. */
export const GOOD_RATING_THRESHOLD = 4;

export const RateBookingSchema = z
  .object({
    score: z.number().int().min(1, '1 ile 5 arasında bir puan giriniz').max(5, '1 ile 5 arasında bir puan giriniz'),
    comment: z.string().trim().max(1000, 'Yorum en fazla 1000 karakter olabilir').optional().or(z.literal('')),
  })
  .strict();
export type RateBookingInput = z.infer<typeof RateBookingSchema>;

export const ListRatingsQuerySchema = z
  .object({
    trainerProfileId: z.string().uuid().optional(),
    serviceTypeId: z.string().uuid().optional(),
    branchId: z.string().uuid().optional(),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();
export type ListRatingsQueryInput = z.infer<typeof ListRatingsQuerySchema>;

export interface SessionRatingDTO {
  id: string;
  bookingId: string;
  memberId: string;
  /** Null to a trainer's own view when isAnonymousToTrainer is true. */
  memberName: string | null;
  trainerProfileId: string;
  trainerName: string;
  serviceTypeId: string;
  serviceTypeName: string;
  branchId: string | null;
  score: number;
  comment: string | null;
  isAnonymousToTrainer: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RatingAggregateDTO {
  count: number;
  average: number | null;
  distribution: Record<'1' | '2' | '3' | '4' | '5', number>;
}

export interface RatingListResultDTO {
  items: SessionRatingDTO[];
  aggregate: RatingAggregateDTO;
  page: number;
  pageSize: number;
  total: number;
}

/** Returned by POST rate when the rating is good enough to prompt a review. */
export interface ReviewPromptDTO {
  googleReviewUrl: string;
}

export interface RateBookingResultDTO {
  rating: SessionRatingDTO;
  reviewPrompt: ReviewPromptDTO | null;
}

/** An attended, unrated session still inside the rating window: home screen prompt card. */
export interface PendingRatingPromptDTO {
  bookingId: string;
  serviceTypeName: string;
  trainerName: string;
  sessionEndTime: string;
}

/** Whether `now` is still within the rating window after a session ended. */
export function isWithinRatingWindow(sessionEndTime: Date, now: Date): boolean {
  const deadline = new Date(sessionEndTime.getTime() + RATING_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  return now >= sessionEndTime && now <= deadline;
}

/** Whether an existing rating may still be edited by its author. */
export function isWithinRatingEditWindow(ratingCreatedAt: Date, now: Date): boolean {
  const deadline = new Date(ratingCreatedAt.getTime() + RATING_EDIT_WINDOW_HOURS * 60 * 60 * 1000);
  return now <= deadline;
}

// ---------------------------------------------------------------------------
// Google review redirect
// ---------------------------------------------------------------------------

const GOOGLE_REVIEW_URL_PREFIXES = [
  'https://g.page/',
  'https://search.google.com/local/writereview',
  'https://www.google.com/maps',
] as const;

export function isValidGoogleReviewUrl(value: string): boolean {
  return GOOGLE_REVIEW_URL_PREFIXES.some((prefix) => value.startsWith(prefix));
}

export const GoogleReviewUrlSchema = z
  .string()
  .trim()
  .url('Geçerli bir bağlantı giriniz')
  .refine(
    (v) => v.startsWith('https://'),
    'Bağlantı https:// ile başlamalıdır',
  )
  .refine(isValidGoogleReviewUrl, 'Bağlantı g.page, search.google.com/local/writereview veya google.com/maps ile başlamalıdır');

export const UpdateFeedbackSettingsSchema = z
  .object({
    /** Null clears the URL and disables the review prompt. */
    googleReviewUrl: GoogleReviewUrlSchema.nullable().optional(),
    referralRewardUnits: z.number().int().min(0).max(50).optional(),
  })
  .strict();
export type UpdateFeedbackSettingsInput = z.infer<typeof UpdateFeedbackSettingsSchema>;

export interface FeedbackSettingsDTO {
  googleReviewUrl: string | null;
  referralRewardUnits: number;
}

// ---------------------------------------------------------------------------
// Referrals
// ---------------------------------------------------------------------------

/** Optional field on lead/member creation forms; the referrer's short code. */
export const ReferralCodeInputSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{4,24}$/, 'Geçersiz tavsiye kodu')
  .optional()
  .or(z.literal(''));

export interface ReferralCodeDTO {
  code: string;
  shareText: string;
}

export interface ReferralDTO {
  id: string;
  referrerMemberId: string;
  referrerName: string;
  referredUserId: string;
  referredName: string;
  referredPhone: string;
  status: ReferralStatus;
  qualifiedAt: string | null;
  rewardedAt: string | null;
  rewardType: ReferralRewardType | null;
  rewardUnits: number | null;
  voidedAt: string | null;
  voidReason: string | null;
  createdAt: string;
}

export const VoidReferralSchema = z
  .object({
    reason: z.string().trim().min(3, 'İptal sebebi giriniz').max(500),
  })
  .strict();
export type VoidReferralInput = z.infer<typeof VoidReferralSchema>;

export const ListReferralsQuerySchema = z
  .object({
    status: z.nativeEnum(ReferralStatus).optional(),
    memberId: z.string().uuid().optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();
export type ListReferralsQueryInput = z.infer<typeof ListReferralsQuerySchema>;

/** Public landing info for a referral link, e.g. /r/:code. No PII beyond the studio's own public text. */
export interface ReferralLandingDTO {
  studioName: string;
  offerText: string;
}
