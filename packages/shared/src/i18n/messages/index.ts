import { trCommon } from './tr/common';
import { trLanguage } from './tr/language';
import { enCommon } from './en/common';
import { enLanguage } from './en/language';

/**
 * Bundled message catalogues. Adding strings:
 * 1. put the Turkish text in messages/tr/<namespace>.ts (keys start with
 *    "<namespace>."), 2. add the English text in messages/en/<namespace>.ts
 *    (the type makes a missing English key a compile error), 3. list both
 *    below. Other languages come from the CMS or uploaded language packs.
 */
export const TR_NAMESPACES = [trCommon, trLanguage] as const;
export const EN_NAMESPACES = [enCommon, enLanguage] as const;

export const BASE_MESSAGES = Object.freeze({ ...trCommon, ...trLanguage });
export type MessageKey = keyof typeof BASE_MESSAGES;

const EN_MESSAGES: Readonly<Record<MessageKey, string>> = Object.freeze({ ...enCommon, ...enLanguage });

export const BUNDLED_MESSAGES: Readonly<Record<string, Readonly<Record<string, string>>>> = Object.freeze({
  tr: BASE_MESSAGES,
  en: EN_MESSAGES,
});

/** Languages whose messages ship with the code; the API creates their rows on boot. */
export const BUNDLED_LANGUAGES = [
  { code: 'tr', name: 'Turkish', nativeName: 'Türkçe' },
  { code: 'en', name: 'English', nativeName: 'English' },
] as const;
