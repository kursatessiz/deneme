import type { trMPartners } from '../tr/mPartners';

export const enMPartners: Record<keyof typeof trMPartners, string> = {
  'mPartners.provider.mock': 'Test (Mock)',
  'mPartners.provider.other': 'Other',
  'mPartners.intro':
    'Connect ClassPass, Urban Sports Club, Wellhub (Gympass) and similar aggregator/marketplace platforms here. Credentials are entered only here and are never shown again.',
  'mPartners.missingCredentials': ' · Missing credentials',
  'mPartners.consecutiveFailures': ' · {count} consecutive sync failures',
  'mPartners.activeLabel': '{label} active',
  'mPartners.spotsPerSession': 'Spots per session: {count}',
  'mPartners.payoutPerVisit': 'Payout per visit: {amount} TRY',
  'mPartners.newConnection': 'New connection',
  'mPartners.providerLabel': 'Provider',
  'mPartners.labelField': 'Label',
  'mPartners.labelPlaceholder': 'E.g. ClassPass - Main branch',
  'mPartners.webhookSecretLabel': 'Webhook secret',
  'mPartners.webhookSecretPlaceholder': "The partner's webhook signing secret",
  'mPartners.apiKeyLabel': 'API key (optional)',
  'mPartners.spotsPerSessionLabel': 'Spots per session',
  'mPartners.payoutRateLabel': 'Payout per visit (TRY)',
  'mPartners.saveConnection': 'Save connection',
  'mPartners.addConnection': 'Add new partner connection',
  'mPartners.errors.loadFailed': 'Partner connections could not be loaded.',
  'mPartners.errors.toggleFailed': 'Change could not be saved, try again.',
  'mPartners.errors.labelAndSecretRequired': 'Label and webhook secret are required.',
  'mPartners.errors.createFailed': 'Connection could not be created.',
};
