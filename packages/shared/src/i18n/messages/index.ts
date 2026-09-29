import { trAdminI18n } from './tr/admin-i18n';
import { trAds } from './tr/ads';
import { trAuth } from './tr/auth';
import { trCampaigns } from './tr/campaigns';
import { trJourneys } from './tr/journeys';
import { trSegments } from './tr/segments';
import { trCommon } from './tr/common';
import { trConsent } from './tr/consent';
import { trCrm } from './tr/crm';
import { trFinance } from './tr/finance';
import { trLanguage } from './tr/language';
import { trLayout } from './tr/layout';
import { trMessaging } from './tr/messaging';
import { trMsgTpl } from './tr/msgTpl';
import { trMMessaging } from './tr/mMessaging';
import { trMAccount } from './tr/mAccount';
import { trMAuth } from './tr/mAuth';
import { trMNav } from './tr/mNav';
import { trMScreens } from './tr/mScreens';
import { trMWidgets } from './tr/mWidgets';
import { trNav } from './tr/nav';
import { trReports } from './tr/reports';
import { trSettings } from './tr/settings';
import { trSites } from './tr/sites';
import { enAdminI18n } from './en/admin-i18n';
import { enAds } from './en/ads';
import { enAuth } from './en/auth';
import { enCampaigns } from './en/campaigns';
import { enJourneys } from './en/journeys';
import { enSegments } from './en/segments';
import { enCommon } from './en/common';
import { enConsent } from './en/consent';
import { enCrm } from './en/crm';
import { enFinance } from './en/finance';
import { enLanguage } from './en/language';
import { enLayout } from './en/layout';
import { enMessaging } from './en/messaging';
import { enMsgTpl } from './en/msgTpl';
import { enMMessaging } from './en/mMessaging';
import { enMAccount } from './en/mAccount';
import { enMAuth } from './en/mAuth';
import { enMNav } from './en/mNav';
import { enMScreens } from './en/mScreens';
import { enMWidgets } from './en/mWidgets';
import { enNav } from './en/nav';
import { enReports } from './en/reports';
import { enSettings } from './en/settings';
import { enSites } from './en/sites';

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
  trAds,
  trAuth,
  trCampaigns,
  trJourneys,
  trSegments,
  trCommon,
  trConsent,
  trCrm,
  trFinance,
  trLanguage,
  trLayout,
  trMessaging,
  trMsgTpl,
  trMAccount,
  trMAuth,
  trMMessaging,
  trMNav,
  trMScreens,
  trMWidgets,
  trNav,
  trReports,
  trSettings,
  trSites,
] as const;

export const EN_NAMESPACES = [
  enAdminI18n,
  enAds,
  enAuth,
  enCampaigns,
  enJourneys,
  enSegments,
  enCommon,
  enConsent,
  enCrm,
  enFinance,
  enLanguage,
  enLayout,
  enMessaging,
  enMsgTpl,
  enMAccount,
  enMAuth,
  enMMessaging,
  enMNav,
  enMScreens,
  enMWidgets,
  enNav,
  enReports,
  enSettings,
  enSites,
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
