import { BASE_MESSAGES, createTranslator } from '@platform/shared';
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
