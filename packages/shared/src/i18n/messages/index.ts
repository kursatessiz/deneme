import { trCommon } from './tr/common';
import { trLanguage } from './tr/language';
import { trNav } from './tr/nav';
import { trLayout } from './tr/layout';
import { trAuth } from './tr/auth';
import { trAdminI18n } from './tr/admin-i18n';
import { enCommon } from './en/common';
import { enLanguage } from './en/language';
import { enNav } from './en/nav';
import { enLayout } from './en/layout';
import { enAuth } from './en/auth';
import { enAdminI18n } from './en/admin-i18n';

/**
 * Bundled message catalogues. Adding strings:
 * 1. put the Turkish text in messages/tr/<namespace>.ts (keys start with
 *    "<namespace>."), 2. add the English text in messages/en/<namespace>.ts
 *    (the type makes a missing English key a compile error), 3. list both
 *    below. Other languages come from the CMS or uploaded language packs.
 */
export const TR_NAMESPACES = [trCommon, trLanguage, trNav, trLayout, trAuth, trAdminI18n] as const;
export const EN_NAMESPACES = [enCommon, enLanguage, enNav, enLayout, enAuth, enAdminI18n] as const;

export const BASE_MESSAGES = Object.freeze({ ...trCommon, ...trLanguage, ...trNav, ...trLayout, ...trAuth, ...trAdminI18n });
export type MessageKey = keyof typeof BASE_MESSAGES;

const EN_MESSAGES: Readonly<Record<MessageKey, string>> = Object.freeze({
  ...enCommon,
  ...enLanguage,
  ...enNav,
  ...enLayout,
  ...enAuth,
  ...enAdminI18n,
});

export const BUNDLED_MESSAGES: Readonly<Record<string, Readonly<Record<string, string>>>> = Object.freeze({
  tr: BASE_MESSAGES,
  en: EN_MESSAGES,
});

/** Languages whose messages ship with the code; the API creates their rows on boot. */
export const BUNDLED_LANGUAGES = [
  { code: 'tr', name: 'Turkish', nativeName: 'Türkçe' },
  { code: 'en', name: 'English', nativeName: 'English' },
] as const;
