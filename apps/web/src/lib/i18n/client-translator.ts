import { BASE_MESSAGES, createTranslator, translateValidationMessage } from '@platform/shared';
import type { MessageParams, Translate } from '@platform/shared';

/**
 * The active translator for plain (non-React) client code such as bffFetch,
 * which has no useT(). I18nProvider registers the resolved translator on
 * render; before that (or in a test) Turkish base messages answer.
 */
let current: Translate | null = null;
const base: Translate = createTranslator({ locale: 'tr', messages: BASE_MESSAGES, fallback: BASE_MESSAGES });

export function registerClientTranslator(t: Translate): void {
  current = t;
}

export function clientT(key: string, params?: MessageParams): string {
  return (current ?? base)(key, params);
}

/** Message of a shared Zod rule (a `validation.*` key, see `vmsg`) in the active language; other text passes through. */
export function validationText(message: string): string {
  return translateValidationMessage(message, clientT);
}

/** First Zod issue message in the active language, or `fallback` when there is none. */
export function validationMessageOf(message: string | undefined, fallback: string): string {
  return message === undefined ? fallback : validationText(message);
}
