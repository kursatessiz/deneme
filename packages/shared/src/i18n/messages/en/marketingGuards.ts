import type { trMarketingGuards } from '../tr/marketingGuards';

export const enMarketingGuards = {
  'marketingGuards.reason.BOUNCE': 'bounce',
  'marketingGuards.reason.COMPLAINT': 'complaint',
} as const satisfies Record<keyof typeof trMarketingGuards, string>;
