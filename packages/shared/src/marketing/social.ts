import { z } from 'zod';
import type { ApprovalReasonCode } from './approvals';
import type { HubConnectionAuthDTO } from './oauth';
import { hasBlockingIssues, runMarketingChecks, type MarketingCheckContext, type MarketingCheckIssue } from './checks';

/**
 * Organic social publishing (M4b, docs/PAZARLAMA_MODULU.md 5.2 and 6.1):
 * pasted-token connections to a Facebook Page, an Instagram business account
 * or a LinkedIn organization, and the posts published through them. A post
 * goes out only from SCHEDULED; it gets there directly when the brand check
 * is clean and the tenant does not require approval for every social post,
 * and through a super admin approval otherwise.
 */

export const SOCIAL_PROVIDERS = ['META_PAGE', 'INSTAGRAM', 'LINKEDIN_ORG'] as const;
export type SocialProvider = (typeof SOCIAL_PROVIDERS)[number];

/** REAUTH_REQUIRED (M4a): an OAuth token could not be refreshed; the hub offers a reconnect. */
export const SOCIAL_CONNECTION_STATUSES = ['CONNECTED', 'ERROR', 'REAUTH_REQUIRED'] as const;
export type SocialConnectionStatus = (typeof SOCIAL_CONNECTION_STATUSES)[number];

export const SOCIAL_POST_STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'SCHEDULED', 'PUBLISHING', 'PUBLISHED', 'FAILED', 'CANCELLED'] as const;
export type SocialPostStatus = (typeof SOCIAL_POST_STATUSES)[number];

/** States in which the content of a post may still be edited (an edit drops a granted or pending approval). */
export const SOCIAL_EDITABLE_STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'SCHEDULED', 'FAILED'] as const satisfies readonly SocialPostStatus[];
/** States that block deleting a connection: the post still has something to do. */
export const SOCIAL_ACTIVE_STATUSES = ['PENDING_APPROVAL', 'SCHEDULED', 'PUBLISHING'] as const satisfies readonly SocialPostStatus[];

export function isSocialPostEditable(status: string): boolean {
  return (SOCIAL_EDITABLE_STATUSES as readonly string[]).includes(status);
}

export function isSocialPostActive(status: string): boolean {
  return (SOCIAL_ACTIVE_STATUSES as readonly string[]).includes(status);
}

// ---------------------------------------------------------------------------
// Outbound hosts, API versions and per-network limits (data, not code)
// ---------------------------------------------------------------------------

export const META_GRAPH_HOST = 'graph.facebook.com';
export const INSTAGRAM_GRAPH_HOST = 'graph.instagram.com';
export const LINKEDIN_API_HOST = 'api.linkedin.com';

/** The fixed set of hosts each social provider may call; the shared HTTP helper refuses everything else. */
export const SOCIAL_PROVIDER_ALLOWED_HOSTS: Readonly<Record<SocialProvider, readonly string[]>> = {
  META_PAGE: [META_GRAPH_HOST],
  INSTAGRAM: [META_GRAPH_HOST, INSTAGRAM_GRAPH_HOST],
  LINKEDIN_ORG: [LINKEDIN_API_HOST],
};

/** Pinned API versions: bump in one place when a network deprecates the old one. */
export const SOCIAL_META_API_VERSION = 'v21.0';
/** LinkedIn versioned APIs use a YYYYMM header value. */
export const SOCIAL_LINKEDIN_API_VERSION = '202405';

/**
 * How the link of a post is carried: `SEPARATE` is a native link field of
 * the network; `APPENDED` is added to the end of the text (Instagram
 * captions have no link field) and counts towards the length limit.
 */
export type SocialLinkPlacement = 'SEPARATE' | 'APPENDED';

export interface SocialNetworkLimits {
  /** Maximum text length in characters (Unicode code points). */
  maxTextLength: number;
  /** Maximum number of media URLs; 0 means the network takes no media in M4b. */
  maxMedia: number;
  mediaRequired: boolean;
  linkPlacement: SocialLinkPlacement;
}

/** Per-network content limits. Pure data: changing a limit never touches code. */
export const SOCIAL_NETWORK_LIMITS: Readonly<Record<SocialProvider, SocialNetworkLimits>> = {
  META_PAGE: { maxTextLength: 63_206, maxMedia: 1, mediaRequired: false, linkPlacement: 'SEPARATE' },
  INSTAGRAM: { maxTextLength: 2_200, maxMedia: 1, mediaRequired: true, linkPlacement: 'APPENDED' },
  LINKEDIN_ORG: { maxTextLength: 3_000, maxMedia: 0, mediaRequired: false, linkPlacement: 'SEPARATE' },
};

/** The text as the network will count it: Instagram appends the link to the caption. */
export function socialEffectiveText(provider: SocialProvider, text: string, link: string | null | undefined): string {
  const placement = SOCIAL_NETWORK_LIMITS[provider].linkPlacement;
  return placement === 'APPENDED' && link ? `${text}\n${link}` : text;
}

/** Length of the effective text in Unicode code points (what the counter in the composer shows). */
export function socialTextLength(provider: SocialProvider, text: string, link: string | null | undefined): number {
  return [...socialEffectiveText(provider, text, link)].length;
}

// ---------------------------------------------------------------------------
// Retry with backoff
// ---------------------------------------------------------------------------

/** Minutes to wait after the 1st, 2nd, ... retryable failure (5xx, 429, network). After the last entry the post is FAILED. */
export const SOCIAL_RETRY_BACKOFF_MINUTES = [1, 5, 15, 60] as const;

/** Milliseconds to wait before the next attempt given the attempts made so far (>= 1), or null when the retries are used up. */
export function socialRetryDelayMs(attemptsMade: number): number | null {
  const minutes = SOCIAL_RETRY_BACKOFF_MINUTES[attemptsMade - 1];
  return minutes === undefined ? null : minutes * 60_000;
}

/** How long a post waits after Instagram reported the 24 hour publishing quota as used up. */
export const SOCIAL_QUOTA_RETRY_MINUTES = 30;

/** Most posts one heartbeat run publishes. */
export const SOCIAL_MAX_POSTS_PER_RUN = 10;

/** A post stuck in PUBLISHING (a crash in the middle of a call) is put back after this many minutes. */
export const SOCIAL_PUBLISHING_STALE_MINUTES = 15;

// ---------------------------------------------------------------------------
// Brand check and approval gating
// ---------------------------------------------------------------------------

export interface SocialBrandCheck {
  checkedAt: string;
  issues: MarketingCheckIssue[];
}

/**
 * Deterministic brand check of a post (docs/PAZARLAMA_MODULU.md 4.4): the
 * brand kit checks of the AI studio on the text, plus the network's own
 * length limit on the text as the network counts it.
 */
export function runSocialPostChecks(provider: SocialProvider, input: { text: string; link?: string | null }, ctx: MarketingCheckContext): MarketingCheckIssue[] {
  const issues = runMarketingChecks('SOCIAL_POST', { text: input.text }, ctx);
  const limit = SOCIAL_NETWORK_LIMITS[provider].maxTextLength;
  const actual = socialTextLength(provider, input.text, input.link);
  if (actual > limit) issues.push({ code: 'LENGTH_EXCEEDED', severity: 'BLOCKING', field: 'text', limit, actual });
  return issues;
}

/** Why a post needs a super admin approval before it may go out. */
export const SOCIAL_APPROVAL_REASONS = ['SOCIAL_APPROVAL_REQUIRED_SETTING', 'SOCIAL_BRAND_CHECK_BLOCKING'] as const satisfies readonly ApprovalReasonCode[];
export type SocialApprovalReason = (typeof SOCIAL_APPROVAL_REASONS)[number];

export interface SocialApprovalDecision {
  required: boolean;
  reasons: SocialApprovalReason[];
}

/**
 * Section 6.1: an organic post is self-approved (by a holder of
 * `platform.marketing.send`) when the brand check has no BLOCKING issue;
 * `requireApprovalForSocial` sends every post to a super admin instead.
 */
export function decideSocialApproval(input: { requireApprovalForSocial: boolean; issues: readonly MarketingCheckIssue[] }): SocialApprovalDecision {
  const reasons: SocialApprovalReason[] = [];
  if (input.requireApprovalForSocial) reasons.push('SOCIAL_APPROVAL_REQUIRED_SETTING');
  if (hasBlockingIssues(input.issues)) reasons.push('SOCIAL_BRAND_CHECK_BLOCKING');
  return { required: reasons.length > 0, reasons };
}

export type SocialContentIssueCode = 'MEDIA_REQUIRED' | 'TOO_MANY_MEDIA' | 'MEDIA_NOT_SUPPORTED';

/** Structural problems that no approval can fix: the network cannot take this post at all. */
export function validateSocialPostShape(provider: SocialProvider, input: { mediaUrls: readonly string[] }): SocialContentIssueCode[] {
  const limits = SOCIAL_NETWORK_LIMITS[provider];
  const issues: SocialContentIssueCode[] = [];
  if (limits.maxMedia === 0 && input.mediaUrls.length > 0) issues.push('MEDIA_NOT_SUPPORTED');
  else if (input.mediaUrls.length > limits.maxMedia) issues.push('TOO_MANY_MEDIA');
  if (limits.mediaRequired && input.mediaUrls.length === 0) issues.push('MEDIA_REQUIRED');
  return issues;
}

/** Video file extensions; anything else is treated as an image. */
const VIDEO_EXTENSION = /\.(mp4|mov|m4v)(\?|#|$)/i;

export function isVideoUrl(url: string): boolean {
  return VIDEO_EXTENSION.test(url);
}

// ---------------------------------------------------------------------------
// Stable error codes
// ---------------------------------------------------------------------------

export const SOCIAL_ERROR_CODES = [
  'SOCIAL_QUOTA_EXHAUSTED',
  'SOCIAL_POST_NOT_EDITABLE',
  'SOCIAL_POST_INVALID',
  'SOCIAL_POST_NOT_SCHEDULABLE',
  'SOCIAL_APPROVAL_REQUIRED',
  'SOCIAL_CONNECTION_IN_USE',
  'SOCIAL_CONNECTION_DUPLICATE',
  'SOCIAL_CONNECTION_UNUSABLE',
  'SOCIAL_SCHEDULE_IN_PAST',
] as const;
export type SocialErrorCode = (typeof SOCIAL_ERROR_CODES)[number];

export function isSocialErrorCode(value: unknown): value is SocialErrorCode {
  return typeof value === 'string' && (SOCIAL_ERROR_CODES as readonly string[]).includes(value);
}

/** Translation keys the web BFF substitutes for the API message (TRANSLATED_API_ERROR_CODES). */
export const SOCIAL_TRANSLATED_ERRORS = {
  SOCIAL_QUOTA_EXHAUSTED: 'marketingSocial.error.SOCIAL_QUOTA_EXHAUSTED',
  SOCIAL_POST_NOT_EDITABLE: 'marketingSocial.error.SOCIAL_POST_NOT_EDITABLE',
  SOCIAL_POST_INVALID: 'marketingSocial.error.SOCIAL_POST_INVALID',
  SOCIAL_POST_NOT_SCHEDULABLE: 'marketingSocial.error.SOCIAL_POST_NOT_SCHEDULABLE',
  SOCIAL_APPROVAL_REQUIRED: 'marketingSocial.error.SOCIAL_APPROVAL_REQUIRED',
  SOCIAL_CONNECTION_IN_USE: 'marketingSocial.error.SOCIAL_CONNECTION_IN_USE',
  SOCIAL_CONNECTION_DUPLICATE: 'marketingSocial.error.SOCIAL_CONNECTION_DUPLICATE',
  SOCIAL_CONNECTION_UNUSABLE: 'marketingSocial.error.SOCIAL_CONNECTION_UNUSABLE',
  SOCIAL_SCHEDULE_IN_PAST: 'marketingSocial.error.SOCIAL_SCHEDULE_IN_PAST',
} as const satisfies Record<SocialErrorCode, string>;

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const HttpsUrl = z
  .string()
  .trim()
  .max(2_000)
  .url()
  .refine((v) => v.startsWith('https://'), { message: 'https bağlantısı giriniz' });

const ExternalId = z
  .string()
  .trim()
  .min(1, 'Hesap kimliği giriniz')
  .max(80)
  .regex(/^[A-Za-z0-9_.:-]+$/, 'Geçersiz hesap kimliği');

/** Write-only: never echoed back by any endpoint. */
export const SocialCredentialsSchema = z
  .object({
    accessToken: z.string().trim().min(8, 'Erişim anahtarı giriniz').max(4_000),
    /** Instagram only: the host the token belongs to (Facebook login tokens use graph.facebook.com, Instagram login tokens graph.instagram.com). */
    apiHost: z.enum([META_GRAPH_HOST, INSTAGRAM_GRAPH_HOST]).optional(),
  })
  .strict();
export type SocialCredentials = z.infer<typeof SocialCredentialsSchema>;

export const CreateSocialConnectionSchema = z
  .object({
    provider: z.enum(SOCIAL_PROVIDERS),
    externalId: ExternalId,
    displayName: z.string().trim().min(1).max(160).optional(),
    credentials: SocialCredentialsSchema,
  })
  .strict();
export type CreateSocialConnectionInput = z.infer<typeof CreateSocialConnectionSchema>;

export const UpdateSocialConnectionSchema = z
  .object({
    displayName: z.string().trim().min(1).max(160).optional(),
    credentials: SocialCredentialsSchema.optional(),
  })
  .strict();
export type UpdateSocialConnectionInput = z.infer<typeof UpdateSocialConnectionSchema>;

const Locale = z
  .string()
  .trim()
  .regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/, 'Geçersiz dil kodu')
  .max(10);

export const CreateSocialPostSchema = z
  .object({
    connectionId: z.string().uuid(),
    locale: Locale,
    text: z.string().trim().min(1, 'Metin giriniz').max(10_000),
    mediaUrls: z.array(HttpsUrl).max(10).default([]),
    link: HttpsUrl.nullable().optional(),
    scheduledAt: z.string().datetime().nullable().optional(),
    /** Provenance only: the AI studio draft the text came from. */
    aiDraftId: z.string().uuid().nullable().optional(),
    /** The calendar item this post fulfils; it flips to SENT when the post is published. */
    calendarItemId: z.string().uuid().nullable().optional(),
  })
  .strict();
export type CreateSocialPostInput = z.infer<typeof CreateSocialPostSchema>;

export const UpdateSocialPostSchema = CreateSocialPostSchema.partial().strict();
export type UpdateSocialPostInput = z.infer<typeof UpdateSocialPostSchema>;

export const ScheduleSocialPostSchema = z.object({ scheduledAt: z.string().datetime() }).strict();
export type ScheduleSocialPostInput = z.infer<typeof ScheduleSocialPostSchema>;

export const SocialPostsQuerySchema = z
  .object({
    status: z.enum(SOCIAL_POST_STATUSES).optional(),
    connectionId: z.string().uuid().optional(),
    calendarItemId: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(200).default(100),
  })
  .strict();
export type SocialPostsQuery = z.infer<typeof SocialPostsQuerySchema>;

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

/** Connection as every endpoint returns it: the credential is only ever a masked tail. */
export interface SocialConnectionDTO extends HubConnectionAuthDTO {
  id: string;
  provider: SocialProvider;
  externalId: string;
  displayName: string;
  status: SocialConnectionStatus;
  lastError: string | null;
  credentialPreview: string;
  connectedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Card of the integrations hub (same fields as the connection). */
export type HubSocialConnectionDTO = SocialConnectionDTO;

export interface SocialConnectionTestDTO {
  ok: boolean;
  displayName: string | null;
  /** Stable, credential-free reason when the test failed. */
  error: string | null;
  connection: SocialConnectionDTO;
}

export interface SocialPostApprovalDTO {
  id: string;
  status: string;
  reasons: SocialApprovalReason[];
  expiresAt: string;
}

export interface SocialPostDTO {
  id: string;
  connectionId: string;
  provider: SocialProvider;
  connectionName: string;
  status: SocialPostStatus;
  locale: string;
  text: string;
  mediaUrls: string[];
  link: string | null;
  scheduledAt: string | null;
  publishedAt: string | null;
  externalPostId: string | null;
  lastError: string | null;
  aiDraftId: string | null;
  calendarItemId: string | null;
  approval: SocialPostApprovalDTO | null;
  brandCheck: SocialBrandCheck;
  /** Length of the text as the network counts it, and the network's limit. */
  textLength: number;
  textLimit: number;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
}

export interface SocialPostListDTO {
  items: SocialPostDTO[];
}

/** Value shape of the JSON `brandCheck` column, tolerant of the empty default. */
export function parseSocialBrandCheck(raw: unknown): SocialBrandCheck {
  if (raw && typeof raw === 'object' && Array.isArray((raw as { issues?: unknown }).issues)) {
    const value = raw as { checkedAt?: unknown; issues: MarketingCheckIssue[] };
    return { checkedAt: typeof value.checkedAt === 'string' ? value.checkedAt : '', issues: value.issues };
  }
  return { checkedAt: '', issues: [] };
}
