import type { trMIntegrations } from '../tr/mIntegrations';

export const enMIntegrations: Record<keyof typeof trMIntegrations, string> = {
  'mIntegrations.title': 'Integrations',
  'mIntegrations.description':
    'Create an API key for integrations that use the public booking API, and see the status of your webhook endpoints. See docs/PUBLIC_API.md for details.',
  'mIntegrations.apiKeys': 'API keys',
  'mIntegrations.secretShownOnceNotice': 'This key is shown only now and cannot be viewed again.',
  'mIntegrations.copied': 'Copied',
  'mIntegrations.copyKey': 'Copy key',
  'mIntegrations.keyPrefixSuffix': 'pk_live_{prefix}_**** · {count} scopes',
  'mIntegrations.revoked': 'Revoked',
  'mIntegrations.revoke': 'Revoke',
  'mIntegrations.newKey': 'New key',
  'mIntegrations.keyNamePlaceholder': 'Key name (e.g. Website widget)',
  'mIntegrations.createKey': 'Create key',
  'mIntegrations.webhookEndpoints': 'Webhook endpoints',
  'mIntegrations.noWebhooksYet': 'No webhook endpoint defined yet. Use the business dashboard to add one.',
  'mIntegrations.eventsCount': '{count} events',
  'mIntegrations.active': 'Active',
  'mIntegrations.inactive': 'Inactive',
  'mIntegrations.consecutiveFailures': ' · {count} consecutive failures',
  'mIntegrations.errors.loadFailed': 'Integrations could not be loaded.',
  'mIntegrations.errors.nameAndScopeRequired': 'Key name and at least one scope are required.',
  'mIntegrations.errors.keyCreateFailed': 'Key could not be created.',
  'mIntegrations.errors.keyRevokeFailed': 'Key could not be revoked.',
};
