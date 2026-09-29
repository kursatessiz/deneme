import { z } from 'zod';
import type { HubSocialConnectionDTO } from './marketing/social';
import type { HubLeadAdsDTO } from './marketing/lead-ads';
import { SMS_PROVIDER_KEYS, SMS_REGISTRATION_STATUSES, SmsSenderRegistrationSchema } from './messaging-engine';
import type { SmsProviderKey, SmsRegistrationStatus } from './messaging-engine';
import type { WebhookEvent } from './open-platform';

/**
 * Platform integrations hub (docs/PAZARLAMA_MODULU.md 5.1): one summary of
 * the platform tenant's ad connections, API keys (Zapier/Make/n8n),
 * webhooks, messaging channels and email sender domains, served by
 * `/platform/integrations/*` to both the super admin (`/admin/entegrasyonlar`)
 * and the marketing panel (`/pazarlama/entegrasyonlar`). Secrets never
 * appear here: only masked previews (last 4 characters, key prefixes).
 */

/** Which panel a hub request came from; recorded as `metadata.via` on every audit entry. */
export const INTEGRATION_ENTRY_POINTS = ['admin', 'marketing'] as const;
export type IntegrationEntryPoint = (typeof INTEGRATION_ENTRY_POINTS)[number];
/** Request header carrying the entry point; a caller who is not a super admin is always recorded as 'marketing'. */
export const INTEGRATION_ENTRY_HEADER = 'x-platform-entry';

export const EMAIL_DOMAIN_PURPOSES = ['MARKETING', 'TRANSACTIONAL'] as const;
export type EmailDomainPurpose = (typeof EMAIL_DOMAIN_PURPOSES)[number];

/** VALID: the expected record resolves; INVALID: a record exists but does not match; MISSING: nothing found; PENDING: never checked. */
export const DNS_RECORD_STATUSES = ['PENDING', 'VALID', 'INVALID', 'MISSING'] as const;
export type DnsRecordStatus = (typeof DNS_RECORD_STATUSES)[number];

export interface ExpectedDnsRecordDTO {
  kind: 'SPF' | 'DKIM' | 'DMARC' | 'MAIL_FROM_MX';
  type: 'TXT' | 'CNAME' | 'MX';
  name: string;
  value: string;
  status: DnsRecordStatus;
}

export interface EmailSenderDomainDTO {
  id: string;
  domain: string;
  purpose: EmailDomainPurpose;
  mailFromDomain: string | null;
  spfStatus: DnsRecordStatus;
  dkimStatus: DnsRecordStatus;
  dmarcStatus: DnsRecordStatus;
  dmarcPolicy: string | null;
  /** All three of SPF, DKIM and DMARC are VALID: commercial sending may use this domain. */
  verified: boolean;
  expectedRecords: ExpectedDnsRecordDTO[];
  lastCheckedAt: string | null;
  lastError: string | null;
  dailyCap: number | null;
  createdAt: string;
}

const DOMAIN_PATTERN = /^(?=.{3,253}$)(?!-)([a-z0-9-]{1,63}\.)+[a-z]{2,63}$/;
const DKIM_TOKEN_PATTERN = /^[a-z0-9]{16,64}$/;

export const CreateEmailSenderDomainSchema = z.object({
  domain: z
    .string()
    .trim()
    .toLowerCase()
    .regex(DOMAIN_PATTERN),
  purpose: z.enum(EMAIL_DOMAIN_PURPOSES).default('MARKETING'),
  mailFromDomain: z
    .string()
    .trim()
    .toLowerCase()
    .regex(DOMAIN_PATTERN)
    .optional(),
  /** Easy DKIM tokens copied from the SES console (usually three). */
  dkimTokens: z.array(z.string().trim().toLowerCase().regex(DKIM_TOKEN_PATTERN)).max(3).default([]),
  dailyCap: z.number().int().positive().max(1_000_000).optional(),
});
export type CreateEmailSenderDomainInput = z.infer<typeof CreateEmailSenderDomainSchema>;

export interface HubAdConnectionDTO {
  id: string;
  platform: string;
  label: string;
  status: string;
  isTestMode: boolean;
  credentialPreview: string;
  lastSyncAt: string | null;
  lastError: string | null;
}

export interface HubApiKeyDTO {
  id: string;
  name: string;
  /** Public prefix only; the secret is never stored in plaintext. */
  prefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface HubWebhookDTO {
  id: string;
  /** Host only: a path can carry a Zapier/Make hook token. */
  host: string;
  events: string[];
  isActive: boolean;
  failureCount: number;
}

export interface HubMessagingChannelDTO {
  channel: 'EMAIL' | 'SMS' | 'WHATSAPP';
  /** The provider in use for the platform tenant, or null when only the mock is configured. */
  provider: string | null;
  configured: boolean;
}

/** Super-admin-only platform cards: read-only status pointing at the screen that manages them. */
export interface HubPlatformCardDTO {
  key: 'ai' | 'smsBalance' | 'payments';
  configured: boolean;
  href: string;
}

export interface IntegrationHubDTO {
  platformStudioId: string;
  adConnections: HubAdConnectionDTO[];
  /** M4b: connected social accounts (organic publishing), credentials masked. */
  socialConnections: HubSocialConnectionDTO[];
  apiKeys: HubApiKeyDTO[];
  webhooks: HubWebhookDTO[];
  messaging: HubMessagingChannelDTO[];
  emailDomains: EmailSenderDomainDTO[];
  /** Only for super admins; empty for platform members. */
  platformCards: HubPlatformCardDTO[];
  /** M4c: Meta Lead Ads intake, form mappings and (super admin) the verify token. */
  leadAds: HubLeadAdsDTO;
  /** M4c: SMS sender id registration and Twilio 10DLC status. */
  smsSender: HubSmsSenderDTO;
  /** M4c: platform event subscriptions and crm.write keys. */
  automation: HubAutomationDTO;
}

/** One SMS provider's alphanumeric sender id and its registration status (entered by hand). */
export interface HubSmsSenderProviderDTO {
  provider: SmsProviderKey;
  senderId: string | null;
  status: SmsRegistrationStatus;
  updatedAt: string | null;
  /** The provider the platform tenant sends through today (pinned in messaging settings, else the environment). */
  active: boolean;
}

export interface HubSmsSenderDTO {
  providers: HubSmsSenderProviderDTO[];
  /** Null until a Twilio 10DLC status was entered. */
  twilio10dlc: { brandStatus: SmsRegistrationStatus; campaignStatus: SmsRegistrationStatus; updatedAt: string | null } | null;
}

/** PUT /platform/integrations/sms-sender */
export const UpdateSmsSenderSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('SENDER_ID'),
      provider: z.enum(SMS_PROVIDER_KEYS),
      senderId: SmsSenderRegistrationSchema.shape.senderId,
      status: z.enum(SMS_REGISTRATION_STATUSES),
    })
    .strict(),
  z
    .object({
      kind: z.literal('TWILIO_10DLC'),
      brandStatus: z.enum(SMS_REGISTRATION_STATUSES),
      campaignStatus: z.enum(SMS_REGISTRATION_STATUSES),
    })
    .strict(),
]);
export type UpdateSmsSenderInput = z.infer<typeof UpdateSmsSenderSchema>;

/** How many active webhook subscriptions each platform event has (Zapier, Make and n8n hooks included). */
export interface HubAutomationDTO {
  platformEvents: { event: WebhookEvent; activeSubscriptions: number }[];
  /** Active API keys that can write contacts (scope crm.write). */
  crmWriteKeyCount: number;
}

export const HubUpdateAdConnectionSchema = z.object({
  label: z.string().trim().min(1).max(80).optional(),
  isTestMode: z.boolean().optional(),
});
export type HubUpdateAdConnectionInput = z.infer<typeof HubUpdateAdConnectionSchema>;

export const HubUpdateWebhookSchema = z.object({ isActive: z.boolean() });
export type HubUpdateWebhookInput = z.infer<typeof HubUpdateWebhookSchema>;

/** `abcd…wxyz` style preview; never more than the last four characters of a secret. */
export function maskSecretPreview(last4: string | null | undefined): string {
  if (!last4) return '****';
  return `****${last4.slice(-4)}`;
}
