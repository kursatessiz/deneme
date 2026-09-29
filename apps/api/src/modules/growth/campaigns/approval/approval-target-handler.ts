import type { ApprovalRequest, Prisma } from '@platform/database';

/**
 * What a target other than a campaign (a social post today; journeys, page
 * publishing and the rest later) supplies so the approval queue can decide
 * on its requests: the queue owns the request lifecycle and the four-eyes
 * rule, the target owns its own state. Registered with
 * CampaignApprovalService.registerTargetHandler().
 */
export interface ApprovalTargetHandler {
  /**
   * The content hash of the target as it is now, or null when the target is
   * gone or no longer waits on this request (the decision is then refused as
   * "not pending").
   */
  currentHash(request: ApprovalRequest): Promise<string | null>;

  /** Inside the decision transaction: the request was APPROVED (or SELF_APPROVED by a super admin). */
  onApproved(tx: Prisma.TransactionClient, request: ApprovalRequest): Promise<void>;

  /**
   * Inside the transaction that closes a request as REJECTED, CANCELLED or
   * EXPIRED, or drops it because the content changed: the target leaves
   * PENDING_APPROVAL again.
   */
  onClosed(tx: Prisma.TransactionClient, request: ApprovalRequest, reason: 'REJECTED' | 'CANCELLED' | 'EXPIRED' | 'CONTENT_CHANGED'): Promise<void>;
}
