import type { trAutomationHub } from '../tr/automationHub';

export const enAutomationHub = {
  'automationHub.title': 'Automation (Zapier, Make, n8n)',
  'automationHub.description': 'Platform events are published only to the platform tenant\'s webhook subscriptions. Zapier and Make subscribe through POST /v1/public/hooks; inbound contact actions need an API key with the crm.write scope.',
  'automationHub.events': 'Platform events',
  'automationHub.subscriptions': 'Active subscriptions',
  'automationHub.crmWriteKeys': 'Active keys with crm.write: {count}',
  'automationHub.event.studio_signup': 'New business signup',
  'automationHub.event.studio_paid': 'Business made its first payment',
  'automationHub.event.studio_trial_expiring': 'Trial is about to end',
  'automationHub.event.contact_lifecycle_changed': 'Contact lifecycle changed',
  'automationHub.event.campaign_sent': 'Campaign send completed',
  'automationHub.scope.webhooks_manage': 'Webhook subscriptions (webhooks.manage)',
  'automationHub.scope.crm_write': 'Create contacts, tags and consent (crm.write)',
  'automationHub.scopes': 'Scopes',
} as const satisfies Record<keyof typeof trAutomationHub, string>;
