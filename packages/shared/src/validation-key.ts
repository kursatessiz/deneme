import type { MessageParams } from './i18n/translator';
import type { trValidation } from './i18n/messages/tr/validation';

/** Every `validation.*` message key. */
export type ValidationKey = keyof typeof trValidation;

export const VALIDATION_KEY_PREFIX = 'validation.';

/**
 * Message of a shared Zod schema rule (docs/I18N.md, "Doğrulama mesajları").
 *
 * The schema carries the i18n key instead of a sentence: `errors[].message`
 * of a 400 response and `issue.message` of a client-side `safeParse` are then
 * translated into the viewer's language (`translateValidationMessage`).
 * Dynamic parts ride along as a JSON suffix: `validation.x|{"min":2}`.
 */
export function vmsg(key: ValidationKey, params?: MessageParams): string {
  return params ? `${key}|${JSON.stringify(params)}` : key;
}
