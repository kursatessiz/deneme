import { trAdminI18n } from './tr/admin-i18n';
import { trAdminAi } from './tr/admin-ai';
import { trAi } from './tr/ai';
import { trAds } from './tr/ads';
import { trAuth } from './tr/auth';
import { trBooking } from './tr/booking';
import { trCalendar } from './tr/calendar';
import { trCampaigns } from './tr/campaigns';
import { trChurn } from './tr/churn';
import { trJourneys } from './tr/journeys';
import { trSegments } from './tr/segments';
import { trCommon } from './tr/common';
import { trConsent } from './tr/consent';
import { trEmbed } from './tr/embed';
import { trCrm } from './tr/crm';
import { trFinance } from './tr/finance';
import { trLanguage } from './tr/language';
import { trLayout } from './tr/layout';
import { trLeads } from './tr/leads';
import { trMessaging } from './tr/messaging';
import { trMsgTpl } from './tr/msgTpl';
import { trMMessaging } from './tr/mMessaging';
import { trMAccount } from './tr/mAccount';
import { trMembers } from './tr/members';
import { trMAuth } from './tr/mAuth';
import { trMNav } from './tr/mNav';
import { trMScreens } from './tr/mScreens';
import { trMWidgets } from './tr/mWidgets';
import { trNav } from './tr/nav';
import { trPackages } from './tr/packages';
import { trReports } from './tr/reports';
import { trScreens } from './tr/screens';
import { trSettings } from './tr/settings';
import { trSites } from './tr/sites';
import { enAdminI18n } from './en/admin-i18n';
import { enAdminAi } from './en/admin-ai';
import { enAi } from './en/ai';
import { enAds } from './en/ads';
import { enAuth } from './en/auth';
import { enBooking } from './en/booking';
import { enCalendar } from './en/calendar';
import { enCampaigns } from './en/campaigns';
import { enChurn } from './en/churn';
import { enJourneys } from './en/journeys';
import { enSegments } from './en/segments';
import { enCommon } from './en/common';
import { enConsent } from './en/consent';
import { enEmbed } from './en/embed';
import { enCrm } from './en/crm';
import { enFinance } from './en/finance';
import { enLanguage } from './en/language';
import { enLayout } from './en/layout';
import { enLeads } from './en/leads';
import { enMessaging } from './en/messaging';
import { enMsgTpl } from './en/msgTpl';
import { enMMessaging } from './en/mMessaging';
import { enMAccount } from './en/mAccount';
import { enMembers } from './en/members';
import { enMAuth } from './en/mAuth';
import { enMNav } from './en/mNav';
import { enMScreens } from './en/mScreens';
import { enMWidgets } from './en/mWidgets';
import { enNav } from './en/nav';
import { enPackages } from './en/packages';
import { enReports } from './en/reports';
import { enScreens } from './en/screens';
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
  trAdminAi,
  trAi,
  trAds,
  trAuth,
  trBooking,
  trCalendar,
  trCampaigns,
  trChurn,
  trJourneys,
  trSegments,
  trCommon,
  trConsent,
  trCrm,
  trEmbed,
  trFinance,
  trLanguage,
  trLayout,
  trLeads,
  trMessaging,
  trMsgTpl,
  trMAccount,
  trMAuth,
  trMembers,
  trMMessaging,
  trMNav,
  trMScreens,
  trMWidgets,
  trNav,
  trPackages,
  trReports,
  trScreens,
  trSettings,
  trSites,
] as const;

export const EN_NAMESPACES = [
  enAdminI18n,
  enAdminAi,
  enAi,
  enAds,
  enAuth,
  enBooking,
  enCalendar,
  enCampaigns,
  enChurn,
  enJourneys,
  enSegments,
  enCommon,
  enConsent,
  enCrm,
  enEmbed,
  enFinance,
  enLanguage,
  enLayout,
  enLeads,
  enMessaging,
  enMsgTpl,
  enMAccount,
  enMAuth,
  enMembers,
  enMMessaging,
  enMNav,
  enMScreens,
  enMWidgets,
  enNav,
  enPackages,
  enReports,
  enScreens,
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
