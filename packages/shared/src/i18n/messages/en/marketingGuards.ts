import type { trMarketingGuards } from '../tr/marketingGuards';

export const enMarketingGuards = {
  'marketingGuards.reason.BOUNCE': 'bounce',
  'marketingGuards.reason.COMPLAINT': 'complaint',
  'marketingGuards.adCap.manual': 'Ads are not stopped automatically; review the campaigns on the ad platform.',
  'marketingGuards.adCap.paused.one': 'Auto-pause was on: {count} active campaign was paused. Only you can resume campaigns.',
  'marketingGuards.adCap.paused.other': 'Auto-pause was on: {count} active campaigns were paused. Only you can resume campaigns.',
  'marketingGuards.adCap.nothingToPause': 'Auto-pause is on but there was no active campaign to pause.',
  'marketingGuards.adCap.failed': '{count} campaign(s) could not be paused; stop them by hand on the ad platform.',
  'marketingGuards.adCap.unsupported': 'Auto-pause is not supported for {platforms}; stop the campaigns by hand.',
  'marketingGuards.adCap.error': 'Auto-pause hit an error; check the campaigns by hand on the ad platform.',
} as const satisfies Record<keyof typeof trMarketingGuards, string>;
