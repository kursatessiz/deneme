import { z } from 'zod';
import type { ComplianceRegion } from '../growth/regions';
import type { ConsentLegalBasis } from './consent';

/**
 * Marketing approvals (M3b, docs/PAZARLAMA_MODULU.md 6.1): every outgoing
 * action of the platform tenant (a campaign send today; journeys, social
 * posts, page publishing, ad budget changes and exports later) needs an
 * ApprovalRequest that is either self-approved (inside the thresholds of
 * MarketingSettings, by a holder of `platform.marketing.send`) or approved
 * by a super admin. The request is bound to a content hash: when the
 * content changes after the decision, the approval no longer counts.
 */

export const APPROVAL_TARGET_TYPES = ['CAMPAIGN', 'JOURNEY', 'SOCIAL_POST', 'PAGE_PUBLISH', 'AD_BUDGET', 'AD_ACTIVATE', 'EXPORT'] as const;
export type ApprovalTargetType = (typeof APPROVAL_TARGET_TYPES)[number];

export const APPROVAL_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'CANCELLED', 'SELF_APPROVED'] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

/** Statuses that let the target go out (as long as the content hash still matches). */
export const GRANTED_APPROVAL_STATUSES = ['APPROVED', 'SELF_APPROVED'] as const satisfies readonly ApprovalStatus[];

export function isGrantedApprovalStatus(status: string): boolean {
  return (GRANTED_APPROVAL_STATUSES as readonly string[]).includes(status);
}

/** Channels the precheck evaluates with thresholds; PUSH and IN_APP campaigns always need a super admin. */
export const APPROVAL_CHANNELS = ['EMAIL', 'SMS', 'WHATSAPP', 'PUSH', 'IN_APP'] as const;
export type ApprovalChannel = (typeof APPROVAL_CHANNELS)[number];

// ---------------------------------------------------------------------------
// Precheck findings and approval reasons
// ---------------------------------------------------------------------------

/**
 * Findings of the dry-run precheck. `warning` findings make the precheck
 * "not clean" and always require a super admin; `info` findings only
 * describe who will be skipped at send time (the engine decides per
 * recipient anyway).
 */
export const PRECHECK_FINDING_CODES = [
  'AUDIENCE_EMPTY',
  'NO_SENDABLE_RECIPIENTS',
  'TEMPLATE_MISSING',
  'WHATSAPP_TEMPLATE_NOT_APPROVED',
  'PHYSICAL_ADDRESS_MISSING',
  'EMAIL_DOMAIN_NOT_VERIFIED',
  'SMS_CREDITS_INSUFFICIENT',
  'US_SMS_RECIPIENTS',
  'CONSENT_MISSING',
  'OPTED_OUT',
  'NO_ADDRESS',
  'QUIET_HOURS',
  'FREQUENCY_CAP',
  // M3e: dropped for their consent legal basis (counts only).
  'DOUBLE_OPT_IN_PENDING',
  'NO_LEGAL_BASIS',
  'TR_EXEMPTION_DISABLED',
] as const;
export type PrecheckFindingCode = (typeof PRECHECK_FINDING_CODES)[number];
export type PrecheckSeverity = 'warning' | 'info';

export interface PrecheckFinding {
  code: PrecheckFindingCode;
  severity: PrecheckSeverity;
  /** The channel the finding is about; null for the whole audience. */
  channel: ApprovalChannel | null;
  /** Number of recipients concerned, when it is a count. */
  count: number | null;
}

/** Why a request could not be self-approved (shown on the approval screen). */
export const APPROVAL_REASON_CODES = [
  'EMAIL_OVER_THRESHOLD',
  'SMS_OVER_THRESHOLD',
  'SMS_CREDITS_OVER_THRESHOLD',
  'FIRST_TIME_SEGMENT',
  'NEW_REGION',
  'PRECHECK_WARNING',
  'US_SMS_RECIPIENT',
  'EMAIL_DOMAIN_NOT_VERIFIED',
  'CHANNEL_REQUIRES_APPROVAL',
] as const;
export type ApprovalReasonCode = (typeof APPROVAL_REASON_CODES)[number];

export interface SelfApprovalThresholds {
  selfApproveEmailMax: number;
  selfApproveSmsMax: number;
  selfApproveSmsCredits: number;
}

export interface SelfApprovalInput {
  /** Channels the campaign may use: its own channel, or the tenant's channel order. */
  channels: readonly ApprovalChannel[];
  audienceTotal: number;
  /** Estimated SMS credits (one per SMS recipient that passes consent and opt-out). */
  smsCredits: number;
  /** The SMS audience holds at least one recipient in the United States (TCPA). */
  usSmsRecipients: boolean;
  /** A granted request for this segment exists already (another campaign). */
  segmentApprovedBefore: boolean;
  /** Countries in the audience that no granted request has reached before. */
  newCountries: readonly string[];
  findings: readonly PrecheckFinding[];
  /** A MARKETING sender domain with SPF, DKIM and DMARC all valid. */
  emailDomainVerified: boolean;
  thresholds: SelfApprovalThresholds;
}

export interface SelfApprovalDecision {
  selfApprovable: boolean;
  reasons: ApprovalReasonCode[];
}

/**
 * The self-approval matrix of section 6.1. Pure: the API gathers the facts,
 * this decides. A request is self-approvable only when no reason applies;
 * the reasons are stored in the summary for the approver.
 */
export function decideSelfApproval(input: SelfApprovalInput): SelfApprovalDecision {
  const reasons = new Set<ApprovalReasonCode>();
  const channels = new Set(input.channels);
  const { thresholds } = input;

  if (channels.has('EMAIL')) {
    if (input.audienceTotal > thresholds.selfApproveEmailMax) reasons.add('EMAIL_OVER_THRESHOLD');
    if (!input.emailDomainVerified) reasons.add('EMAIL_DOMAIN_NOT_VERIFIED');
  }
  if (channels.has('SMS') || channels.has('WHATSAPP')) {
    if (input.audienceTotal > thresholds.selfApproveSmsMax) reasons.add('SMS_OVER_THRESHOLD');
    if (input.smsCredits > thresholds.selfApproveSmsCredits) reasons.add('SMS_CREDITS_OVER_THRESHOLD');
  }
  if (channels.has('SMS') && input.usSmsRecipients) reasons.add('US_SMS_RECIPIENT');
  if (channels.has('PUSH') || channels.has('IN_APP') || channels.size === 0) reasons.add('CHANNEL_REQUIRES_APPROVAL');
  if (!input.segmentApprovedBefore) reasons.add('FIRST_TIME_SEGMENT');
  if (input.newCountries.length > 0) reasons.add('NEW_REGION');
  if (input.findings.some((f) => f.severity === 'warning')) reasons.add('PRECHECK_WARNING');

  const ordered = APPROVAL_REASON_CODES.filter((r) => reasons.has(r));
  return { selfApprovable: ordered.length === 0, reasons: ordered };
}

/**
 * Four eyes (6.1): the approver may not be the requester, except a super
 * admin approving their own request, which is recorded as SELF_APPROVED
 * with `selfApprovedBySuperAdmin` in the summary.
 */
export type ApprovalDecisionOutcome = 'APPROVED' | 'SELF_APPROVED' | 'FOUR_EYES_VIOLATION';

export function approvalOutcomeFor(input: { requestedByUserId: string; approverUserId: string; approverIsSuperAdmin: boolean }): ApprovalDecisionOutcome {
  if (input.requestedByUserId !== input.approverUserId) return 'APPROVED';
  return input.approverIsSuperAdmin ? 'SELF_APPROVED' : 'FOUR_EYES_VIOLATION';
}

export function approvalExpiresAt(createdAt: Date, ttlHours: number): Date {
  return new Date(createdAt.getTime() + ttlHours * 60 * 60 * 1000);
}

/** A PENDING request past its expiry; the heartbeat marks it EXPIRED and a decision on it is refused. */
export function isApprovalExpired(request: { status: string; expiresAt: Date }, now: Date): boolean {
  return request.status === 'PENDING' && request.expiresAt.getTime() <= now.getTime();
}

// ---------------------------------------------------------------------------
// Campaign state machine (platform tenant)
// ---------------------------------------------------------------------------

/**
 * DRAFT -> request-approval -> SCHEDULED (self-approved) | PENDING_APPROVAL
 * PENDING_APPROVAL -> approve -> SCHEDULED (or SENDING when it had started)
 * PENDING_APPROVAL -> reject | cancel | expire -> DRAFT
 * SCHEDULED | SENDING -> pause -> PAUSED -> resume -> SCHEDULED | SENDING
 * Any content change after a decision -> PENDING_APPROVAL with a new request.
 */
export const PAUSABLE_CAMPAIGN_STATUSES = ['SCHEDULED', 'SENDING'] as const;
export const APPROVAL_REQUESTABLE_CAMPAIGN_STATUSES = ['DRAFT', 'SCHEDULED', 'PENDING_APPROVAL'] as const;

export function canPauseCampaign(status: string): boolean {
  return (PAUSABLE_CAMPAIGN_STATUSES as readonly string[]).includes(status);
}

export function canResumeCampaign(status: string): boolean {
  return status === 'PAUSED';
}

export function canRequestCampaignApproval(status: string): boolean {
  return (APPROVAL_REQUESTABLE_CAMPAIGN_STATUSES as readonly string[]).includes(status);
}

// ---------------------------------------------------------------------------
// Stored summary and DTOs
// ---------------------------------------------------------------------------

export interface ApprovalCostEstimate {
  /** SMS credits the send is expected to use (credits are only spent on an accepted SMS). */
  smsCredits: number;
  /** Messages expected per channel (recipients that pass consent and opt-out on that channel). */
  messages: Partial<Record<ApprovalChannel, number>>;
  /** Money per ISO 4217 currency, decimal strings. Empty while no channel has a currency price. */
  byCurrency: Record<string, string>;
}

/** Snapshot stored on the request (approval_requests.summary). */
export interface ApprovalSummary {
  version: 1;
  target: {
    name: string;
    channel: string | null;
    templateKey: string | null;
    segmentId: string | null;
    segmentName: string | null;
  };
  /** ISO time the requester asked for; null means as soon as it is approved. */
  requestedSchedule: string | null;
  channels: ApprovalChannel[];
  audience: { total: number; reachable: Partial<Record<ApprovalChannel, number>> };
  /** Recipients per ISO country ('ZZ' when unknown) and per compliance region. */
  countries: Record<string, number>;
  regions: Partial<Record<ComplianceRegion, number>>;
  newCountries: string[];
  cost: ApprovalCostEstimate;
  findings: PrecheckFinding[];
  reasons: ApprovalReasonCode[];
  selfApprovable: boolean;
  segmentApprovedBefore: boolean;
  emailDomainVerified: boolean;
  thresholds: SelfApprovalThresholds;
  evaluatedAt: string;
  /**
   * M3e: sendable recipients per consent legal basis on their first
   * reachable channel (aggregate counts only). Absent on summaries written
   * before M3e.
   */
  legalBases?: Partial<Record<ConsentLegalBasis, number>>;
  /** Set when a super admin approved their own request. */
  selfApprovedBySuperAdmin?: boolean;
  /** Set on a request cancelled because the content changed after the decision. */
  invalidated?: { at: string; reason: 'CONTENT_CHANGED'; replacedByRequestId: string | null };
}

/** Unknown country marker in ApprovalSummary.countries. */
export const UNKNOWN_COUNTRY = 'ZZ';

export interface ApprovalUserDTO {
  id: string;
  name: string;
}

export interface ApprovalRequestDTO {
  id: string;
  targetType: ApprovalTargetType;
  targetId: string;
  status: ApprovalStatus;
  contentHash: string;
  summary: ApprovalSummary;
  requestedBy: ApprovalUserDTO;
  decidedBy: ApprovalUserDTO | null;
  decisionNote: string | null;
  expiresAt: string;
  createdAt: string;
  decidedAt: string | null;
  /** Current state of the target (campaign name and status), null when it is gone. */
  target: { name: string; status: string } | null;
  /** The viewer may approve or reject (super admin, request pending). */
  canDecide: boolean;
  /** The viewer may cancel (requester or super admin, request pending). */
  canCancel: boolean;
}

export interface ApprovalListDTO {
  items: ApprovalRequestDTO[];
  /** Pending requests in total (menu badge). */
  pendingCount: number;
}

export interface RequestApprovalResultDTO {
  request: ApprovalRequestDTO;
  /** Campaign status after the request: SCHEDULED when self-approved, PENDING_APPROVAL otherwise. */
  campaignStatus: string;
}

export const ApprovalListQuerySchema = z
  .object({
    status: z.enum(APPROVAL_STATUSES).optional(),
    targetId: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(200).default(100),
  })
  .strict();
export type ApprovalListQuery = z.infer<typeof ApprovalListQuerySchema>;

export const RequestCampaignApprovalSchema = z
  .object({
    /** Omitted: send as soon as it is approved. */
    scheduledAt: z.string().datetime().optional(),
  })
  .strict();
export type RequestCampaignApprovalInput = z.infer<typeof RequestCampaignApprovalSchema>;

export const APPROVAL_NOTE_MAX = 1000;

export const ApproveRequestSchema = z.object({ note: z.string().trim().max(APPROVAL_NOTE_MAX).optional() }).strict();
export type ApproveRequestInput = z.infer<typeof ApproveRequestSchema>;

export const RejectRequestSchema = z.object({ note: z.string().trim().min(1).max(APPROVAL_NOTE_MAX) }).strict();
export type RejectRequestInput = z.infer<typeof RejectRequestSchema>;

export const CancelRequestSchema = z.object({ note: z.string().trim().max(APPROVAL_NOTE_MAX).optional() }).strict();
export type CancelRequestInput = z.infer<typeof CancelRequestSchema>;

// ---------------------------------------------------------------------------
// Stable error codes
// ---------------------------------------------------------------------------

export const MARKETING_APPROVAL_ERROR_CODES = [
  'CAMPAIGN_APPROVAL_REQUIRED',
  'CAMPAIGN_NOT_REQUESTABLE',
  'CAMPAIGN_NOT_PAUSABLE',
  'CAMPAIGN_NOT_RESUMABLE',
  'APPROVAL_NOT_PENDING',
  'APPROVAL_EXPIRED',
  'APPROVAL_FOUR_EYES',
  'APPROVAL_CONTENT_CHANGED',
  'APPROVAL_CANCEL_FORBIDDEN',
] as const;
export type MarketingApprovalErrorCode = (typeof MARKETING_APPROVAL_ERROR_CODES)[number];

export function isMarketingApprovalErrorCode(value: unknown): value is MarketingApprovalErrorCode {
  return typeof value === 'string' && (MARKETING_APPROVAL_ERROR_CODES as readonly string[]).includes(value);
}

/** Translation keys the web BFF substitutes for the API message (TRANSLATED_API_ERROR_CODES). */
export const MARKETING_APPROVAL_TRANSLATED_ERRORS = {
  CAMPAIGN_APPROVAL_REQUIRED: 'marketingApprovals.error.CAMPAIGN_APPROVAL_REQUIRED',
  CAMPAIGN_NOT_REQUESTABLE: 'marketingApprovals.error.CAMPAIGN_NOT_REQUESTABLE',
  CAMPAIGN_NOT_PAUSABLE: 'marketingApprovals.error.CAMPAIGN_NOT_PAUSABLE',
  CAMPAIGN_NOT_RESUMABLE: 'marketingApprovals.error.CAMPAIGN_NOT_RESUMABLE',
  APPROVAL_NOT_PENDING: 'marketingApprovals.error.APPROVAL_NOT_PENDING',
  APPROVAL_EXPIRED: 'marketingApprovals.error.APPROVAL_EXPIRED',
  APPROVAL_FOUR_EYES: 'marketingApprovals.error.APPROVAL_FOUR_EYES',
  APPROVAL_CONTENT_CHANGED: 'marketingApprovals.error.APPROVAL_CONTENT_CHANGED',
  APPROVAL_CANCEL_FORBIDDEN: 'marketingApprovals.error.APPROVAL_CANCEL_FORBIDDEN',
} as const satisfies Record<MarketingApprovalErrorCode, string>;

// ---------------------------------------------------------------------------
// Transactional notification templates (message-templates.ts BUILTIN_TEMPLATES)
// ---------------------------------------------------------------------------

export const MARKETING_APPROVAL_TEMPLATE_KEYS = {
  requested: 'MARKETING_APPROVAL_REQUESTED',
  approved: 'MARKETING_APPROVAL_APPROVED',
  rejected: 'MARKETING_APPROVAL_REJECTED',
} as const;
