import { z } from 'zod';
import { CountryCodeSchema } from '../growth/regions';

/**
 * Meta Lead Ads intake (M4c, docs/PAZARLAMA_MODULU.md 5.2). Pure contracts
 * and rules: the webhook payload, the lead fetched from the Graph API, how a
 * form's answers map to a contact, the consent answer and the retry policy.
 * The API (apps/api/src/modules/lead-ads) and the hub editor share them.
 */

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/** PENDING: received, not processed yet; RETRY: a transient failure, tried again later; PROCESSED: contact created; FAILED: gave up. */
export const LEAD_AD_EVENT_STATUSES = ['PENDING', 'RETRY', 'PROCESSED', 'FAILED'] as const;
export type LeadAdEventStatus = (typeof LEAD_AD_EVENT_STATUSES)[number];

/** Source recorded on the contact, the conversion event and the touchpoint. */
export const LEAD_AD_SOURCE_CHANNEL = 'META_LEAD_AD';
export const LEAD_AD_CONVERSION_SOURCE_KIND = 'meta_lead_ad';
export const LEAD_AD_UTM_SOURCE = 'meta';
export const LEAD_AD_UTM_MEDIUM = 'lead_ads';

/** Path of the public webhook (verification handshake and signed notifications). */
export const LEAD_ADS_WEBHOOK_PATH = 'webhooks/meta/leadgen';

/** Contact fields a form question can be mapped to; a question without a target stays in the attributes bag. */
export const LEAD_AD_FIELD_TARGETS = ['full_name', 'first_name', 'last_name', 'email', 'phone', 'company', 'country'] as const;
export type LeadAdFieldTarget = (typeof LEAD_AD_FIELD_TARGETS)[number];

/** Mapping applied when a form has no stored mapping: Meta's standard question keys. */
export const DEFAULT_LEAD_AD_FIELD_MAP: Readonly<Record<string, LeadAdFieldTarget>> = {
  full_name: 'full_name',
  first_name: 'first_name',
  last_name: 'last_name',
  email: 'email',
  work_email: 'email',
  phone_number: 'phone',
  work_phone_number: 'phone',
  company_name: 'company',
  country: 'country',
};

export const MAX_LEAD_AD_ATTRIBUTES = 50;
const MAX_ATTRIBUTE_KEY = 60;
const MAX_ATTRIBUTE_VALUE = 500;

// ---------------------------------------------------------------------------
// Meta payloads
// ---------------------------------------------------------------------------

const MetaId = z.string().regex(/^\d{1,40}$/);

/** The `value` of one `leadgen` change in a page webhook notification. */
export const LeadgenChangeValueSchema = z
  .object({
    leadgen_id: MetaId,
    page_id: MetaId,
    form_id: MetaId,
    ad_id: MetaId.optional(),
    adgroup_id: MetaId.optional(),
    created_time: z.number().int().nonnegative().optional(),
  })
  .passthrough();
export type LeadgenChangeValue = z.infer<typeof LeadgenChangeValueSchema>;

/** A page webhook notification; only `leadgen` changes are read, every other field is ignored. */
export const LeadgenWebhookPayloadSchema = z
  .object({
    object: z.string().optional(),
    entry: z
      .array(
        z
          .object({
            id: MetaId,
            time: z.number().optional(),
            changes: z.array(z.object({ field: z.string(), value: z.unknown() }).passthrough()).default([]),
          })
          .passthrough(),
      )
      .default([]),
  })
  .passthrough();
export type LeadgenWebhookPayload = z.infer<typeof LeadgenWebhookPayloadSchema>;

/** One `leadgen` change with its page, as the intake stores it. */
export interface LeadgenNotification {
  pageId: string;
  leadgenId: string;
  formId: string;
  adId: string | null;
  createdTime: Date | null;
}

/** Every well-formed `leadgen` change of a notification; anything else in the body is skipped, never an error. */
export function parseLeadgenNotifications(body: unknown): LeadgenNotification[] {
  const parsed = LeadgenWebhookPayloadSchema.safeParse(body);
  if (!parsed.success) return [];
  const out: LeadgenNotification[] = [];
  for (const entry of parsed.data.entry) {
    for (const change of entry.changes) {
      if (change.field !== 'leadgen') continue;
      const value = LeadgenChangeValueSchema.safeParse(change.value);
      if (!value.success) continue;
      out.push({
        // The page id in the change value wins over the entry id; both name the same page.
        pageId: value.data.page_id || entry.id,
        leadgenId: value.data.leadgen_id,
        formId: value.data.form_id,
        adId: value.data.ad_id ?? null,
        createdTime: value.data.created_time ? new Date(value.data.created_time * 1000) : null,
      });
    }
  }
  return out;
}

/** The lead object returned by `GET /{leadgen-id}` (Graph API, `leads_retrieval`). */
export const MetaLeadSchema = z
  .object({
    id: MetaId,
    created_time: z.string().optional(),
    ad_id: MetaId.optional(),
    adset_id: MetaId.optional(),
    campaign_id: MetaId.optional(),
    form_id: MetaId.optional(),
    is_organic: z.boolean().optional(),
    field_data: z.array(z.object({ name: z.string().max(200), values: z.array(z.string().max(2000)).default([]) })).default([]),
  })
  .passthrough();
export type MetaLead = z.infer<typeof MetaLeadSchema>;

// ---------------------------------------------------------------------------
// Field mapping
// ---------------------------------------------------------------------------

/** Question key (Meta `field_data[].name`) -> contact field. Stored per form as data. */
export const LeadAdFieldMappingSchema = z.record(z.string().trim().min(1).max(120), z.enum(LEAD_AD_FIELD_TARGETS)).refine((v) => Object.keys(v).length <= 60, {
  message: 'En fazla 60 soru eşlenebilir',
});
export type LeadAdFieldMapping = z.infer<typeof LeadAdFieldMappingSchema>;

/** The contact a lead maps to, plus what did not map and the consent answer. */
export interface MappedLead {
  fullName: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  countryCode: string | null;
  /** Answers that map to no contact field (the consent question excluded), for the attributes bag. */
  attributes: Record<string, string>;
  /** Null when the form has no consent question; otherwise whether the person ticked it. */
  consentGiven: boolean | null;
}

/** Answers a consent checkbox can carry when it is not ticked (Meta sends nothing for an empty checkbox). */
const CONSENT_NEGATIVE = new Set(['', '0', 'false', 'no', 'off', 'unchecked', 'hayir', 'hayır', 'nein', 'non']);

/** True when the consent answer is a ticked box: any non-empty answer that is not an explicit refusal. */
export function isConsentAnswerGiven(values: readonly string[] | undefined): boolean {
  if (!values || values.length === 0) return false;
  return values.some((v) => !CONSENT_NEGATIVE.has(v.trim().toLocaleLowerCase('en-US')));
}

const firstValue = (values: readonly string[]): string | null => {
  const v = values.map((x) => x.trim()).find(Boolean);
  return v ?? null;
};

/**
 * Applies a form's mapping (or the default map) to the answers. An explicit
 * mapping replaces the default entry for that question; questions the map
 * does not know go to the attributes bag, truncated and capped so a hostile
 * form cannot bloat a row. The consent question is never stored as an
 * attribute: it is only the answer to the consent rule.
 */
export function mapLeadFields(
  fieldData: readonly { name: string; values: readonly string[] }[],
  mapping: LeadAdFieldMapping | null | undefined,
  consentQuestionKey: string | null | undefined,
): MappedLead {
  const out: MappedLead = {
    fullName: null,
    firstName: null,
    lastName: null,
    email: null,
    phone: null,
    company: null,
    countryCode: null,
    attributes: {},
    consentGiven: null,
  };
  const explicit = mapping ?? {};
  for (const field of fieldData) {
    const key = field.name;
    if (consentQuestionKey && key === consentQuestionKey) {
      out.consentGiven = isConsentAnswerGiven(field.values);
      continue;
    }
    const target = explicit[key] ?? DEFAULT_LEAD_AD_FIELD_MAP[key];
    const value = firstValue(field.values);
    if (!target) {
      if (value && Object.keys(out.attributes).length < MAX_LEAD_AD_ATTRIBUTES) {
        out.attributes[key.slice(0, MAX_ATTRIBUTE_KEY)] = field.values.map((v) => v.trim()).filter(Boolean).join(', ').slice(0, MAX_ATTRIBUTE_VALUE);
      }
      continue;
    }
    if (!value) continue;
    switch (target) {
      case 'full_name':
        out.fullName ??= value;
        break;
      case 'first_name':
        out.firstName ??= value;
        break;
      case 'last_name':
        out.lastName ??= value;
        break;
      case 'email':
        out.email ??= value.toLocaleLowerCase('en-US');
        break;
      case 'phone':
        out.phone ??= value;
        break;
      case 'company':
        out.company ??= value.slice(0, MAX_ATTRIBUTE_VALUE);
        break;
      case 'country': {
        const code = CountryCodeSchema.safeParse(value.toUpperCase());
        if (code.success) out.countryCode ??= code.data;
        else if (Object.keys(out.attributes).length < MAX_LEAD_AD_ATTRIBUTES) out.attributes[key.slice(0, MAX_ATTRIBUTE_KEY)] = value.slice(0, MAX_ATTRIBUTE_VALUE);
        break;
      }
    }
  }
  return out;
}

/**
 * The name a contact is created with: first and last name when the form has
 * them, else the full name split at its last word, else (a form with no name
 * question) the local part of the e-mail address or the phone number, so the
 * contact is never nameless and no invented text is stored.
 */
export function resolveLeadName(lead: Pick<MappedLead, 'fullName' | 'firstName' | 'lastName' | 'email' | 'phone'>): { firstName: string; lastName: string } {
  if (lead.firstName || lead.lastName) {
    if (lead.firstName) return { firstName: lead.firstName, lastName: lead.lastName ?? '' };
    return { firstName: lead.lastName ?? '', lastName: '' };
  }
  if (lead.fullName) {
    const parts = lead.fullName.trim().split(/\s+/).filter(Boolean);
    if (parts.length <= 1) return { firstName: parts[0] ?? '', lastName: '' };
    return { firstName: parts.slice(0, -1).join(' '), lastName: parts[parts.length - 1] };
  }
  const fallback = (lead.email ? lead.email.split('@')[0] : lead.phone) ?? '';
  return { firstName: fallback.slice(0, 60), lastName: '' };
}

// ---------------------------------------------------------------------------
// Retry policy
// ---------------------------------------------------------------------------

/** Seconds before each retry of a failed lead fetch, indexed by the attempt that just failed (1-based). */
export const LEAD_AD_RETRY_DELAYS_SECONDS = [60, 300, 900, 3600, 14_400] as const;
/** The first try plus one per delay; after this many attempts the event is FAILED. */
export const LEAD_AD_MAX_ATTEMPTS = LEAD_AD_RETRY_DELAYS_SECONDS.length + 1;

/** When to retry after `attempts` failed tries, or null once the attempts are used up. */
export function nextLeadAdAttemptAt(attempts: number, now: Date): Date | null {
  if (attempts >= LEAD_AD_MAX_ATTEMPTS) return null;
  const seconds = LEAD_AD_RETRY_DELAYS_SECONDS[Math.max(attempts, 1) - 1];
  return new Date(now.getTime() + seconds * 1000);
}

/** A Graph API status that a retry cannot fix (bad token, missing permission, unknown or deleted lead). */
export function isPermanentGraphStatus(status: number): boolean {
  return status === 400 || status === 401 || status === 403 || status === 404;
}

/** Graph error codes that arrive as HTTP 400 but are rate limits or temporary faults: retry, do not give up. */
export const META_TRANSIENT_ERROR_CODES: ReadonlySet<number> = new Set([1, 2, 4, 17, 32, 341, 613]);

/** Whether a failed Graph call is worth retrying, from its HTTP status and the `error.code` of the body. */
export function isTransientGraphFailure(status: number, errorCode: number | null): boolean {
  if (errorCode !== null && META_TRANSIENT_ERROR_CODES.has(errorCode)) return true;
  return !isPermanentGraphStatus(status);
}

// ---------------------------------------------------------------------------
// Hub: lead ads block, form mappings and the verify token
// ---------------------------------------------------------------------------

/** NOT_CONFIGURED: no page id or app secret yet; CONFIGURED: ready, no lead seen; RECEIVING: leads arrive; ERROR: the last lead failed for good. */
export const LEAD_ADS_CONNECTION_STATUSES = ['NOT_CONFIGURED', 'CONFIGURED', 'RECEIVING', 'ERROR'] as const;
export type LeadAdsConnectionStatus = (typeof LEAD_ADS_CONNECTION_STATUSES)[number];

const FORM_ID = z.string().trim().regex(/^\d{5,40}$/, 'Geçersiz form kimliği');

export const LeadAdFormIdParamSchema = FORM_ID;

/** PUT /platform/integrations/lead-ads/forms/:formId */
export const UpsertLeadAdFormMappingSchema = z
  .object({
    formName: z.string().trim().min(1).max(120).nullable().optional(),
    mapping: LeadAdFieldMappingSchema,
    /** The form question that is the marketing consent checkbox; null means the form has none (no commercial consent). */
    consentQuestionKey: z.string().trim().min(1).max(120).nullable().default(null),
  })
  .strict();
export type UpsertLeadAdFormMappingInput = z.infer<typeof UpsertLeadAdFormMappingSchema>;

/** PUT /platform/integrations/lead-ads/:connectionId: the page and the app secret (write-only). */
export const ConfigureLeadAdsSchema = z
  .object({
    pageId: MetaId.nullable().optional(),
    /** The Meta app secret that signs the webhook; stored encrypted with the connection's credentials, never returned. */
    appSecret: z.string().trim().min(16).max(200).optional(),
  })
  .strict()
  .refine((v) => v.pageId !== undefined || v.appSecret !== undefined, { message: 'Sayfa kimliği veya uygulama sırrı gerekli' });
export type ConfigureLeadAdsInput = z.infer<typeof ConfigureLeadAdsSchema>;

/** PUT /admin/integrations/lead-ads/verify-token: a chosen token, or none to generate one. */
export const SetLeadgenVerifyTokenSchema = z
  .object({ token: z.string().trim().regex(/^[A-Za-z0-9_-]{16,128}$/, 'Doğrulama belirteci 16-128 harf, rakam, tire veya alt çizgi olmalı').optional() })
  .strict();
export type SetLeadgenVerifyTokenInput = z.infer<typeof SetLeadgenVerifyTokenSchema>;

export interface LeadgenVerifyTokenDTO {
  configured: boolean;
  last4: string | null;
  setAt: string | null;
}

/** The plaintext is shown once, right after it is set. */
export interface LeadgenVerifyTokenSetResultDTO extends LeadgenVerifyTokenDTO {
  token: string;
}

export interface HubLeadAdsConnectionDTO {
  connectionId: string;
  label: string;
  pageId: string | null;
  appSecretConfigured: boolean;
  status: LeadAdsConnectionStatus;
  /** Last time a subscribed_apps check saw the page subscribed. */
  subscribedAt: string | null;
  lastLeadAt: string | null;
  failedCount: number;
  lastError: string | null;
}

export interface HubLeadAdFormMappingDTO {
  id: string;
  formId: string;
  formName: string | null;
  mapping: LeadAdFieldMapping;
  consentQuestionKey: string | null;
  updatedAt: string;
}

export interface HubLeadAdsDTO {
  connections: HubLeadAdsConnectionDTO[];
  forms: HubLeadAdFormMappingDTO[];
  /** Events waiting for a retry. */
  retryCount: number;
  failedCount: number;
  lastLeadAt: string | null;
  /** Path (relative to the API base) to enter as the callback URL in the Meta app. */
  webhookPath: string;
  /** Super admins only; null for other platform members. */
  verifyToken: LeadgenVerifyTokenDTO | null;
}

/** GET /platform/integrations/lead-ads/events: recent intake events for troubleshooting. */
export interface LeadAdEventDTO {
  id: string;
  leadgenId: string;
  formId: string;
  pageId: string;
  status: LeadAdEventStatus;
  attempts: number;
  receivedAt: string;
  processedAt: string | null;
  contactId: string | null;
  lastError: string | null;
}
