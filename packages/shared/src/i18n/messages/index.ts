import { trAdminI18n } from './tr/admin-i18n';
import { trAuth } from './tr/auth';
import { trCommon } from './tr/common';
import { trConsent } from './tr/consent';
import { trCrm } from './tr/crm';
import { trLanguage } from './tr/language';
import { trLayout } from './tr/layout';
import { trMAccount } from './tr/mAccount';
import { trMAuth } from './tr/mAuth';
import { trMNav } from './tr/mNav';
import { trNav } from './tr/nav';
import { enAdminI18n } from './en/admin-i18n';
import { enAuth } from './en/auth';
import { enCommon } from './en/common';
import { enConsent } from './en/consent';
import { enCrm } from './en/crm';
import { enLanguage } from './en/language';
import { enLayout } from './en/layout';
import { enMAccount } from './en/mAccount';
import { enMAuth } from './en/mAuth';
import { enMNav } from './en/mNav';
import { enNav } from './en/nav';

/**
 * Bundled message catalogues. Adding strings:
 * 1. put the Turkish text in messages/tr/<namespace>.ts (keys start with
 *    "<namespace>."), 2. add the English text in messages/en/<namespace>.ts
 *    (typed against the Turkish file, so a missing English key is a compile
 *    error), 3. add one line to each list below. The spec checks that both
 *    lists cover the same keys and that no key appears in two namespaces.
 *    Other languages come from the CMS or uploaded language packs.
 *
 * Namespaces prefixed with "m" (mNav, mAuth, mAccount, ...) belong to the
 * mobile app; the others to the web app or both.
 */
export const TR_NAMESPACES = [
  trAdminI18n,
  trAuth,
  trCommon,
  trConsent,
  trCrm,
  trLanguage,
  trLayout,
  trMAccount,
  trMAuth,
  trMNav,
  trNav,
] as const;

export const EN_NAMESPACES = [
  enAdminI18n,
  enAuth,
  enCommon,
  enConsent,
  enCrm,
  enLanguage,
  enLayout,
  enMAccount,
  enMAuth,
  enMNav,
  enNav,
] as const;

type UnionToIntersection<U> = (U extends unknown ? (arg: U) => void : never) extends (arg: infer I) => void
  ? I
  : never;
type MergedCatalogue = UnionToIntersection<(typeof TR_NAMESPACES)[number]>;

export const BASE_MESSAGES: Readonly<MergedCatalogue> = Object.freeze(
  Object.assign({}, ...TR_NAMESPACES) as MergedCatalogue,
);
export type MessageKey = keyof MergedCatalogue;

const EN_MESSAGES: Readonly<Record<MessageKey, string>> = Object.freeze(
  Object.assign({}, ...EN_NAMESPACES) as Record<MessageKey, string>,
);

export const BUNDLED_MESSAGES: Readonly<Record<string, Readonly<Record<string, string>>>> = Object.freeze({
  tr: BASE_MESSAGES,
  en: EN_MESSAGES,
});

/** Languages whose messages ship with the code; the API creates their rows on boot. */
export const BUNDLED_LANGUAGES = [
  { code: 'tr', name: 'Turkish', nativeName: 'Türkçe' },
  { code: 'en', name: 'English', nativeName: 'English' },
] as const;
