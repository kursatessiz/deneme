import { trCommon } from './tr/common';
import { trLanguage } from './tr/language';
import { trMAccount } from './tr/mAccount';
import { trMAuth } from './tr/mAuth';
import { trMNav } from './tr/mNav';
import { enCommon } from './en/common';
import { enLanguage } from './en/language';
import { enMAccount } from './en/mAccount';
import { enMAuth } from './en/mAuth';
import { enMNav } from './en/mNav';

/**
 * Bundled message catalogues. Adding strings:
 * 1. put the Turkish text in messages/tr/<namespace>.ts (keys start with
 *    "<namespace>."), 2. add the English text in messages/en/<namespace>.ts
 *    (the type makes a missing English key a compile error), 3. list both
 *    below. Other languages come from the CMS or uploaded language packs.
 *
 * Namespaces prefixed with "m" (mNav, mAuth, mAccount, ...) belong to the
 * mobile app (apps/mobile); they are kept separate from the web app's
 * namespaces so the two agents extracting strings in parallel never collide
 * on a key.
 */
export const TR_NAMESPACES = [trCommon, trLanguage, trMNav, trMAuth, trMAccount] as const;
export const EN_NAMESPACES = [enCommon, enLanguage, enMNav, enMAuth, enMAccount] as const;

export const BASE_MESSAGES = Object.freeze({ ...trCommon, ...trLanguage, ...trMNav, ...trMAuth, ...trMAccount });
export type MessageKey = keyof typeof BASE_MESSAGES;

const EN_MESSAGES: Readonly<Record<MessageKey, string>> = Object.freeze({
  ...enCommon,
  ...enLanguage,
  ...enMNav,
  ...enMAuth,
  ...enMAccount,
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
