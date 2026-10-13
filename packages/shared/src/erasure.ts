import { z } from 'zod';

/**
 * KVKK/GDPR personal data erasure of one studio membership
 * (docs/KVKK_SILME.md). The member asks in the mobile app, staff with
 * `members.erase` approve or reject in the web panel, and the scheduler
 * heartbeat executes approved requests. A request nobody handled within
 * ERASURE_AUTO_PROCESS_DAYS is executed automatically.
 */

export const ERASURE_REQUEST_SOURCES = ['MEMBER', 'STUDIO'] as const;
export type ErasureRequestSource = (typeof ERASURE_REQUEST_SOURCES)[number];

/** PENDING (waiting for staff), APPROVED (executed by the heartbeat), REJECTED, COMPLETED. */
export const ERASURE_REQUEST_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'COMPLETED'] as const;
export type ErasureRequestStatus = (typeof ERASURE_REQUEST_STATUSES)[number];

/** Statuses that block a second request for the same membership. */
export const ERASURE_OPEN_STATUSES: readonly ErasureRequestStatus[] = ['PENDING', 'APPROVED'];

/** An unhandled PENDING request is executed automatically after this many days. */
export const ERASURE_AUTO_PROCESS_DAYS = 30;

/** The heartbeat stops retrying a request after this many failed attempts (it stays APPROVED and visible). */
export const ERASURE_MAX_ATTEMPTS = 5;

/** Largest number of requests the heartbeat executes in one run. */
export const ERASURE_BATCH_SIZE = 20;

/**
 * Neutral, non-linguistic stand-in written into required name columns of
 * anonymized rows. Screens that know a membership was erased show a
 * translated label instead (`erasure.erasedMember`).
 */
export const ERASED_NAME_PLACEHOLDER = '***';

/** Prefix of the unique, non-routable phone a fully anonymized global user gets (never a valid E.164 number). */
export const ERASED_PHONE_PREFIX = 'ERASED-';

/** Audit actions written by the erasure flow (AuditLog.action). */
export const ERASURE_AUDIT_ACTIONS = {
  requested: 'erasure.requested',
  approved: 'erasure.approved',
  rejected: 'erasure.rejected',
  executed: 'erasure.executed',
} as const;

/** Staff reason, free text; must not contain personal data. */
const DecisionNoteSchema = z.string().trim().max(500).optional();

export const ApproveErasureRequestSchema = z.object({ note: DecisionNoteSchema }).strict();
export type ApproveErasureRequestInput = z.infer<typeof ApproveErasureRequestSchema>;

export const RejectErasureRequestSchema = z.object({ note: DecisionNoteSchema }).strict();
export type RejectErasureRequestInput = z.infer<typeof RejectErasureRequestSchema>;

/** Staff start erasure directly from the member card. */
export const StartErasureSchema = z.object({ note: DecisionNoteSchema }).strict();
export type StartErasureInput = z.infer<typeof StartErasureSchema>;

export const ErasureRequestListQuerySchema = z
  .object({
    status: z.enum(ERASURE_REQUEST_STATUSES).optional(),
  })
  .strict();
export type ErasureRequestListQuery = z.infer<typeof ErasureRequestListQuerySchema>;

export interface ErasureRequestDTO {
  id: string;
  membershipId: string;
  /** MemberProfile id (the member card route parameter); null when the membership has no member profile. */
  memberProfileId: string | null;
  /** Display name; null once the membership was erased. */
  memberName: string | null;
  source: ErasureRequestSource;
  status: ErasureRequestStatus;
  requestedAt: string;
  dueAt: string;
  decidedAt: string | null;
  decisionNote: string | null;
  autoProcessed: boolean;
  executedAt: string | null;
}

/** What the member sees in Hesabım > Gizlilik: the latest request, if any. */
export interface SelfErasureStatusDTO {
  request: ErasureRequestDTO | null;
}

/** Counts per table of what one execution changed; stored on the request, never holds personal data. */
export type ErasureSummary = Record<string, number>;

/** Result of the scheduler step. */
export interface ErasureHeartbeatResult {
  executed: number;
  autoProcessed: number;
  failed: number;
}
