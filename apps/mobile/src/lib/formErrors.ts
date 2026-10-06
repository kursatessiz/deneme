import { translateValidationMessage } from '@platform/shared';
import type { Translate } from '@platform/shared';
import type { ZodError } from 'zod';

/**
 * Flattens a Zod error into { fieldName: firstMessage }, for TextField's errorMessage prop.
 * Shared rules carry `validation.*` keys; `t` renders them in the app language.
 */
export function fieldErrorsFromZod(error: ZodError, t: Translate): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? '_root');
    if (!(key in out)) out[key] = translateValidationMessage(issue.message, t);
  }
  return out;
}
