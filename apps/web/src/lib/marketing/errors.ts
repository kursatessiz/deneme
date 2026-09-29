import { isMarketingApprovalErrorCode, isMarketingStudioErrorCode, type Translate } from '@platform/shared';
import { BffError } from '@/lib/session/client';
import { aiErrorText } from '@/lib/ai/errors';

/**
 * User-facing text for a failed marketing studio call: the API sends a
 * stable `code` (BRAND_KIT_REQUIRED, DRAFT_HAS_BLOCKING_ISSUES, ...) shown in
 * the viewer's language; AI core codes (AI_NOT_CONFIGURED,
 * MARKETING_AI_BUDGET_EXCEEDED, ...) go through aiErrorText; anything else
 * falls back to the API message.
 */
export function marketingErrorText(err: unknown, t: Translate): string {
  if (err instanceof BffError && isMarketingStudioErrorCode(err.code)) return t(`marketingStudio.error.${err.code}`);
  return aiErrorText(err, t);
}

/**
 * Approval flow errors: the BFF already swaps the API message for the
 * translation of its stable code (TRANSLATED_API_ERROR_CODES); this only
 * guarantees a translated text for an unknown failure.
 */
export function approvalErrorText(err: unknown, t: Translate): string {
  if (err instanceof BffError && isMarketingApprovalErrorCode(err.code)) return t(`marketingApprovals.error.${err.code}`);
  if (err instanceof BffError && err.message) return err.message;
  return t('common.error.generic');
}
