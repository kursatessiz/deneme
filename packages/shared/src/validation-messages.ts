import { BASE_MESSAGES } from './i18n/messages';
import { hasOwn } from './i18n/own';
import { createTranslator } from './i18n/translator';
import type { MessageParams, Translate } from './i18n/translator';
import { VALIDATION_KEY_PREFIX } from './validation-key';

/**
 * Translation side of `vmsg` (validation-key.ts): turns the message of a
 * shared Zod rule back into text. A message that is not a validation key
 * (a custom or third-party sentence) is returned unchanged.
 */

const BASE_TRANSLATE: Translate = createTranslator({ locale: 'tr', messages: BASE_MESSAGES, fallback: BASE_MESSAGES });

export interface ParsedValidationMessage {
  key: string;
  params?: MessageParams;
}

/** Splits `validation.x` or `validation.x|{"n":2}` into key and params; null when the message is not a known key. */
export function parseValidationMessage(message: string): ParsedValidationMessage | null {
  if (!message.startsWith(VALIDATION_KEY_PREFIX)) return null;
  const bar = message.indexOf('|');
  const key = bar < 0 ? message : message.slice(0, bar);
  if (!hasOwn(BASE_MESSAGES, key)) return null;
  if (bar < 0) return { key };
  try {
    const raw: unknown = JSON.parse(message.slice(bar + 1));
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { key };
    const params: Record<string, string | number> = {};
    for (const [name, value] of Object.entries(raw)) {
      if (typeof value === 'string' || typeof value === 'number') params[name] = value;
    }
    return { key, params };
  } catch {
    return { key };
  }
}

/** Translates a Zod issue message with `t`; any other text passes through. */
export function translateValidationMessage(message: string, t: Translate): string {
  const parsed = parseValidationMessage(message);
  return parsed ? t(parsed.key, parsed.params) : message;
}

/** The Turkish base text of a validation message (what old clients and logs see). */
export function validationBaseMessage(message: string): string {
  return translateValidationMessage(message, BASE_TRANSLATE);
}

/** First issue of a Zod error as display text in the viewer's language. */
export function firstIssueMessage(error: { issues: ReadonlyArray<{ message: string }> }, t: Translate): string | undefined {
  const first = error.issues[0];
  return first ? translateValidationMessage(first.message, t) : undefined;
}
