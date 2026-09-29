import { z } from 'zod';
import { HttpsUrlSchema } from './validators';

/**
 * Community feed and access tiers (G5b, docs/TOPLULUK.md). A post is shown
 * to the members who satisfy at least one of its access tiers; a post with
 * no tiers is shown to every active member. Tiers and their rules are
 * tenant data (CLAUDE.md rule 7): the lists below only name what the API
 * knows how to evaluate. Access is decided in apps/api only
 * (CommunityAccessService); clients never filter posts themselves.
 */

// ---------------------------------------------------------------------------
// Catalogues
// ---------------------------------------------------------------------------

/** VIDEO links an existing video library item (W19); FILE carries an https link to a document. */
export const COMMUNITY_POST_TYPES = ['POST', 'VIDEO', 'FILE', 'ANNOUNCEMENT'] as const;
export type CommunityPostType = (typeof COMMUNITY_POST_TYPES)[number];

export const COMMUNITY_POST_STATUSES = ['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const;
export type CommunityPostStatus = (typeof COMMUNITY_POST_STATUSES)[number];

/**
 * How a tier rule is satisfied by a member of the studio:
 * - ACTIVE_MEMBER: any active member (the membership is ACTIVE and has a member profile);
 * - ACTIVE_PACKAGE: the member has any ACTIVE, unexpired package;
 * - PACKAGE_DEFINITION: the member has an ACTIVE, unexpired package of this definition.
 * Frozen, depleted and expired packages never satisfy a rule (same semantics as the video library).
 */
export const ACCESS_TIER_RULE_KINDS = ['ACTIVE_MEMBER', 'ACTIVE_PACKAGE', 'PACKAGE_DEFINITION'] as const;
export type AccessTierRuleKind = (typeof ACCESS_TIER_RULE_KINDS)[number];

export const COMMUNITY_TITLE_MAX = 160;
export const COMMUNITY_BODY_MAX = 10_000;
export const COMMUNITY_COMMENT_MAX = 1_000;
export const COMMUNITY_MAX_TIERS_PER_POST = 20;
export const ACCESS_TIER_MAX_RULES = 20;
/** Public share tokens: 32 random bytes, base64url (43 characters, no padding). */
export const COMMUNITY_SHARE_TOKEN_BYTES = 32;
export const COMMUNITY_SHARE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** Stable error codes the API sends in the body (`code`); clients translate `community.error.<code>`. */
export const COMMUNITY_ERROR_CODES = [
  'COMMUNITY_POST_NOT_FOUND',
  'COMMUNITY_COMMENT_NOT_FOUND',
  'COMMUNITY_TIER_NOT_FOUND',
  'COMMUNITY_TIER_IN_USE',
  'COMMUNITY_VIDEO_NOT_FOUND',
  'COMMUNITY_PACKAGE_NOT_FOUND',
  'COMMUNITY_POST_INVALID',
  'COMMUNITY_POST_NOT_PUBLISHED',
  'COMMUNITY_COMMENTS_DISABLED',
  'COMMUNITY_MEMBERS_ONLY',
  'COMMUNITY_NOT_COMMENT_AUTHOR',
] as const;
export type CommunityErrorCode = (typeof COMMUNITY_ERROR_CODES)[number];

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

const TierIdsSchema = z.array(z.string().uuid()).max(COMMUNITY_MAX_TIERS_PER_POST);

const PostFieldsSchema = z.object({
  type: z.enum(COMMUNITY_POST_TYPES),
  title: z.string().trim().min(1).max(COMMUNITY_TITLE_MAX),
  body: z.string().max(COMMUNITY_BODY_MAX),
  /** Required for VIDEO posts: a video library item of the same studio. */
  videoContentId: z.string().uuid().nullable(),
  /** Required for FILE posts: an https link (there is no upload storage yet, see docs/TOPLULUK.md). */
  attachmentUrl: HttpsUrlSchema.pipe(z.string().max(2000)).nullable(),
  attachmentName: z.string().trim().max(200).nullable(),
  pinned: z.boolean(),
  commentsEnabled: z.boolean(),
  /** Empty: every active member sees the post. Otherwise any one satisfied tier is enough. */
  tierIds: TierIdsSchema,
});

/** The type-specific fields a post needs; checked on create and again after an update is merged. */
export function communityPostShapeIssue(post: {
  type: CommunityPostType;
  videoContentId: string | null;
  attachmentUrl: string | null;
}): string | null {
  if (post.type === 'VIDEO' && !post.videoContentId) return 'videoContentId';
  if (post.type !== 'VIDEO' && post.videoContentId) return 'videoContentId';
  if (post.type === 'FILE' && !post.attachmentUrl) return 'attachmentUrl';
  return null;
}

export const CreateCommunityPostSchema = z
  .object({
    type: PostFieldsSchema.shape.type,
    title: PostFieldsSchema.shape.title,
    body: PostFieldsSchema.shape.body.default(''),
    videoContentId: PostFieldsSchema.shape.videoContentId.default(null),
    attachmentUrl: PostFieldsSchema.shape.attachmentUrl.default(null),
    attachmentName: PostFieldsSchema.shape.attachmentName.default(null),
    pinned: PostFieldsSchema.shape.pinned.default(false),
    commentsEnabled: PostFieldsSchema.shape.commentsEnabled.default(true),
    tierIds: TierIdsSchema.default([]),
  })
  .strict()
  .superRefine((post, ctx) => {
    const issue = communityPostShapeIssue(post);
    if (issue) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [issue], message: 'Gönderi türü için gerekli alan eksik veya fazla' });
  });
export type CreateCommunityPostInput = z.infer<typeof CreateCommunityPostSchema>;

export const UpdateCommunityPostSchema = PostFieldsSchema.partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'En az bir alan gerekir' });
export type UpdateCommunityPostInput = z.infer<typeof UpdateCommunityPostSchema>;

export const CommunityPostListQuerySchema = z.object({
  status: z.enum(COMMUNITY_POST_STATUSES).optional(),
  type: z.enum(COMMUNITY_POST_TYPES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});
export type CommunityPostListQuery = z.infer<typeof CommunityPostListQuerySchema>;

export const CommunityFeedQuerySchema = z.object({
  type: z.enum(COMMUNITY_POST_TYPES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});
export type CommunityFeedQuery = z.infer<typeof CommunityFeedQuerySchema>;

/** Comments are listed oldest first. */
export const CommunityCommentListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});
export type CommunityCommentListQuery = z.infer<typeof CommunityCommentListQuerySchema>;

export const CreateCommunityCommentSchema = z
  .object({
    body: z.string().trim().min(1).max(COMMUNITY_COMMENT_MAX),
  })
  .strict();
export type CreateCommunityCommentInput = z.infer<typeof CreateCommunityCommentSchema>;

export const AccessTierRuleInputSchema = z
  .object({
    kind: z.enum(ACCESS_TIER_RULE_KINDS),
    packageDefinitionId: z.string().uuid().nullable().default(null),
  })
  .strict()
  .refine((r) => (r.kind === 'PACKAGE_DEFINITION') === (r.packageDefinitionId !== null), {
    message: 'Paket kuralı için bir paket seçilmelidir',
    path: ['packageDefinitionId'],
  });
export type AccessTierRuleInput = z.infer<typeof AccessTierRuleInputSchema>;

const TierRulesSchema = z.array(AccessTierRuleInputSchema).min(1).max(ACCESS_TIER_MAX_RULES);

export const CreateAccessTierSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    description: z.string().trim().max(300).nullable().default(null),
    rules: TierRulesSchema,
  })
  .strict();
export type CreateAccessTierInput = z.infer<typeof CreateAccessTierSchema>;

export const UpdateAccessTierSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    description: z.string().trim().max(300).nullable().optional(),
    rules: TierRulesSchema.optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'En az bir alan gerekir' });
export type UpdateAccessTierInput = z.infer<typeof UpdateAccessTierSchema>;

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

export interface AccessTierRuleDTO {
  kind: AccessTierRuleKind;
  packageDefinitionId: string | null;
  packageDefinitionName: string | null;
}

export interface AccessTierDTO {
  id: string;
  name: string;
  description: string | null;
  rules: AccessTierRuleDTO[];
  /** Posts (any status) that use this tier. */
  postCount: number;
  createdAt: string;
}

export interface CommunityVideoSummaryDTO {
  id: string;
  title: string;
  durationSeconds: number;
  thumbnailUrl: string | null;
}

/** Staff view of a post (GET /studios/:studioId/community/posts). */
export interface CommunityPostDTO {
  id: string;
  type: CommunityPostType;
  status: CommunityPostStatus;
  title: string;
  body: string;
  pinned: boolean;
  commentsEnabled: boolean;
  video: CommunityVideoSummaryDTO | null;
  attachmentUrl: string | null;
  attachmentName: string | null;
  tiers: { id: string; name: string }[];
  authorName: string | null;
  /** Present only while the public share link is on. */
  shareToken: string | null;
  likeCount: number;
  commentCount: number;
  hiddenCommentCount: number;
  publishedAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A post in the member feed. Never carries the tiers, the status or the share token. */
export interface CommunityFeedItemDTO {
  id: string;
  type: CommunityPostType;
  title: string;
  body: string;
  pinned: boolean;
  commentsEnabled: boolean;
  /** The video's own library rules still apply: a locked video never carries its source link. */
  video: (CommunityVideoSummaryDTO & { isLocked: boolean; sourceUrl: string | null }) | null;
  attachmentUrl: string | null;
  attachmentName: string | null;
  authorName: string | null;
  likeCount: number;
  commentCount: number;
  likedByMe: boolean;
  publishedAt: string;
}

export interface CommunityCommentDTO {
  id: string;
  postId: string;
  body: string;
  authorName: string;
  isMine: boolean;
  /** Only staff with community.view ever receive hidden comments. */
  isHidden: boolean;
  createdAt: string;
}

export interface CommunityLikeResultDTO {
  liked: boolean;
  likeCount: number;
}

export interface CommunityShareResultDTO {
  shareToken: string | null;
}

/** What an unauthenticated share link shows: read-only, no comments, no author details. */
export interface PublicCommunityPostDTO {
  studioName: string;
  type: CommunityPostType;
  title: string;
  body: string;
  video: CommunityVideoSummaryDTO | null;
  attachmentUrl: string | null;
  attachmentName: string | null;
  publishedAt: string;
}

/** Display name for another member in a comment thread: first name and last initial. */
export function communityDisplayName(firstName: string, lastName: string): string {
  const initial = lastName.trim().charAt(0);
  return initial ? `${firstName.trim()} ${initial.toLocaleUpperCase()}.` : firstName.trim();
}
