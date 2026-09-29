import { isAiErrorCode, type Translate } from '@platform/shared';
import { BffError } from '@/lib/session/client';

/**
 * User-facing text for a failed AI call: the API sends a stable `code`
 * (AI_NOT_CONFIGURED, AI_MONTHLY_LIMIT_REACHED, ...) which is shown in the
 * viewer's language; anything else falls back to the API message.
 */
export function aiErrorText(err: unknown, t: Translate): string {
  if (err instanceof BffError && isAiErrorCode(err.code)) return t(`ai.error.${err.code}`);
  if (err instanceof BffError && err.message) return err.message;
  return t('ai.error.generic');
}
