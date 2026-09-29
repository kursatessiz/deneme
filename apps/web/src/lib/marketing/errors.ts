import { isMarketingStudioErrorCode, type Translate } from '@platform/shared';
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
