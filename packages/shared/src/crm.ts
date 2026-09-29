import { z } from 'zod';
import { PhoneSchema } from './validators';
import { ATTRIBUTION_MODELS } from './growth/attribution';
import { LIFECYCLE_STAGES } from './growth/conversions';
import type { ConversionEventType, LifecycleStage } from './growth/conversions';
import { CountryCodeSchema } from './growth/regions';
import type { SegmentFieldKind } from './growth/segments';

/**
 * CRM contracts (G1b): contacts, pipeline stages, custom fields, tasks and
 * the attribution report. See docs/CRM_VE_ATIF.md and
 * docs/BUYUME_VE_GLOBAL_MIMARI.md section 3.1.
 */

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

export const CONTACT_ACTIVITY_TYPES = [
  'NOTE',
  'CALL',
  'MESSAGE',
  'STAGE_CHANGE',
  'TRIAL_BOOKED',
  'LIFECYCLE',
  'MERGE',
  'FORM',
  'TASK',
  'CONVERSION',
] as const;
export type ContactActivityType = (typeof CONTACT_ACTIVITY_TYPES)[number];

/** Activity types staff may log by hand. */
export const MANUAL_CONTACT_ACTIVITY_TYPES = ['NOTE', 'CALL', 'MESSAGE'] as const;

/** Custom field kinds: the scalar subset of SEGMENT_FIELD_KINDS. */
export const CONTACT_FIELD_KINDS = ['string', 'number', 'date', 'boolean', 'enum'] as const satisfies readonly SegmentFieldKind[];
export type ContactFieldKind = (typeof CONTACT_FIELD_KINDS)[number];

export const PIPELINE_STAGE_KINDS = ['OPEN', 'WON', 'LOST'] as const;
export type PipelineStageKind = (typeof PIPELINE_STAGE_KINDS)[number];

export const CONTACT_TASK_STATUSES = ['OPEN', 'DONE', 'CANCELLED'] as const;
export type ContactTaskStatus = (typeof CONTACT_TASK_STATUSES)[number];

/**
 * Stages every tenant starts with. System stages cannot be deleted and keep
 * their key; their label is the i18n key crm.stage.<key> unless the tenant
 * renames them. The keys match the legacy LeadStage values so the /leads
 * compatibility endpoints keep their shapes. The data migration SQL
 * (20260929000000_crm_attribution) inserts the same list.
 */
export const DEFAULT_PIPELINE_STAGES: readonly { key: string; kind: PipelineStageKind; sortOrder: number }[] = [
  { key: 'NEW', kind: 'OPEN', sortOrder: 0 },
  { key: 'CONTACTED', kind: 'OPEN', sortOrder: 1 },
  { key: 'TRIAL_BOOKED', kind: 'OPEN', sortOrder: 2 },
  { key: 'TRIAL_DONE', kind: 'OPEN', sortOrder: 3 },
  { key: 'WON', kind: 'WON', sortOrder: 4 },
  { key: 'LOST', kind: 'LOST', sortOrder: 5 },
];

// ---------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------

export const TAG_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} _.-]{0,39}$/u;

/** Tags are trimmed, inner whitespace collapsed and lower-cased so "VIP" and "vip " are one tag. */
export function normalizeTag(raw: string): string | null {
  const tag = raw.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
  return TAG_PATTERN.test(tag) ? tag : null;
}

export function contactDisplayName(contact: { firstName: string; lastName: string }): string {
  return [contact.firstName, contact.lastName].filter((part) => part && part.trim()).join(' ').trim();
}

/** Best-effort split of a free-text full name: the last word is the surname. */
export function splitContactName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { firstName: parts[0] ?? '', lastName: '' };
  return { firstName: parts.slice(0, -1).join(' '), lastName: parts[parts.length - 1] };
}

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

const TagSchema = z
  .string()
  .max(60)
  .transform((value, ctx) => {
    const tag = normalizeTag(value);
    if (!tag) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Geçersiz etiket' });
      return z.NEVER;
    }
    return tag;
  });

const CustomFieldValueSchema = z.union([z.string().max(500), z.number().finite(), z.boolean(), z.null()]);
export const ContactCustomFieldsSchema = z.record(z.string().regex(/^[a-z][a-z0-9_]{0,59}$/), CustomFieldValueSchema);
export type ContactCustomFields = z.infer<typeof ContactCustomFieldsSchema>;

const EmailSchema = z.string().trim().email('Geçersiz e-posta formatı').max(120);

const ContactFieldsSchema = z.object({
  firstName: z.string().trim().min(1, 'Ad giriniz').max(60),
  lastName: z.string().trim().max(60).optional(),
  phone: PhoneSchema.optional(),
  email: EmailSchema.optional().or(z.literal('')),
  locale: z.string().trim().min(2).max(10).optional(),
  countryCode: CountryCodeSchema.optional(),
  timezone: z.string().trim().min(1).max(60).optional(),
  lifecycleStage: z.enum(LIFECYCLE_STAGES).optional(),
  /** Pipeline stage key; omitted keeps the contact out of the pipeline. */
  pipelineStageKey: z.string().trim().min(1).max(40).optional(),
  ownerMembershipId: z.string().uuid().optional(),
  branchId: z.string().uuid().optional(),
  tags: z.array(TagSchema).max(50).optional(),
  customFields: ContactCustomFieldsSchema.optional(),
  sourceChannel: z.string().trim().max(30).optional(),
  sourceDetail: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(2000).optional(),
  isTest: z.boolean().optional(),
});

/** POST /crm/studios/:studioId/contacts (the studio comes from the route). */
export const CreateContactSchema = ContactFieldsSchema.strict()
  .refine((v) => Boolean(v.phone) || Boolean(v.email), { message: 'Telefon veya e-posta giriniz', path: ['phone'] });
export type CreateContactInput = z.infer<typeof CreateContactSchema>;

export const UpdateContactSchema = ContactFieldsSchema.partial()
  .extend({
    ownerMembershipId: z.string().uuid().nullable().optional(),
    branchId: z.string().uuid().nullable().optional(),
    pipelineStageKey: z.string().trim().min(1).max(40).nullable().optional(),
    lostReason: z.string().trim().max(500).optional(),
    nextFollowUpAt: z.string().datetime().nullable().optional(),
  })
  .strict();
export type UpdateContactInput = z.infer<typeof UpdateContactSchema>;

const ContactFilterShape = {
  stage: z.string().trim().min(1).max(40).optional(),
  lifecycleStage: z.enum(LIFECYCLE_STAGES).optional(),
  ownerMembershipId: z.string().uuid().optional(),
  branchId: z.string().uuid().optional(),
  tag: z.string().trim().max(60).optional(),
  /** Matches the first or last attribution source, or the manual channel. */
  source: z.string().trim().max(250).optional(),
  search: z.string().trim().max(150).optional(),
  includeTest: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
};

export const ContactListQuerySchema = z
  .object({
    ...ContactFilterShape,
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();
export type ContactListQuery = z.infer<typeof ContactListQuerySchema>;

export const ContactExportQuerySchema = z.object(ContactFilterShape).strict();
export type ContactExportQuery = z.infer<typeof ContactExportQuerySchema>;

export const MergeContactsSchema = z
  .object({
    /** The contact that remains. */
    survivorId: z.string().uuid(),
    /** The contact folded into the survivor and hidden afterwards. */
    mergedId: z.string().uuid(),
  })
  .strict()
  .refine((v) => v.survivorId !== v.mergedId, { message: 'Bir kişi kendisiyle birleştirilemez', path: ['mergedId'] });
export type MergeContactsInput = z.infer<typeof MergeContactsSchema>;

export const ContactTagsSchema = z
  .object({
    add: z.array(TagSchema).max(50).default([]),
    remove: z.array(TagSchema).max(50).default([]),
  })
  .strict();
export type ContactTagsInput = z.infer<typeof ContactTagsSchema>;

export const AddContactActivitySchema = z
  .object({
    type: z.enum(MANUAL_CONTACT_ACTIVITY_TYPES),
    body: z.string().trim().min(1, 'Not giriniz').max(2000),
  })
  .strict();
export type AddContactActivityInput = z.infer<typeof AddContactActivitySchema>;

// ---------------------------------------------------------------------------
// Custom field definitions
// ---------------------------------------------------------------------------

/** locale code -> label, e.g. { tr: 'Hedef', en: 'Goal' }. */
export const LocalizedLabelSchema = z
  .record(z.string().regex(/^[a-z]{2,3}(-[A-Z]{2})?$/), z.string().trim().min(1).max(120))
  .refine((v) => Object.keys(v).length > 0, { message: 'En az bir dilde etiket giriniz' });

export const CreateContactFieldSchema = z
  .object({
    key: z.string().regex(/^[a-z][a-z0-9_]{0,59}$/, 'Anahtar küçük harf, rakam ve alt çizgi içerebilir'),
    label: LocalizedLabelSchema,
    kind: z.enum(CONTACT_FIELD_KINDS),
    options: z.array(z.string().trim().min(1).max(80)).max(50).optional(),
    sortOrder: z.number().int().min(0).max(1000).optional(),
  })
  .strict()
  .refine((v) => v.kind !== 'enum' || (v.options?.length ?? 0) > 0, {
    message: 'Seçenek listesi giriniz',
    path: ['options'],
  });
export type CreateContactFieldInput = z.infer<typeof CreateContactFieldSchema>;

export const UpdateContactFieldSchema = z
  .object({
    label: LocalizedLabelSchema.optional(),
    options: z.array(z.string().trim().min(1).max(80)).max(50).optional(),
    sortOrder: z.number().int().min(0).max(1000).optional(),
    isArchived: z.boolean().optional(),
  })
  .strict();
export type UpdateContactFieldInput = z.infer<typeof UpdateContactFieldSchema>;

export const ContactFieldListQuerySchema = z
  .object({
    includeArchived: z
      .enum(['true', 'false'])
      .optional()
      .transform((v) => v === 'true'),
  })
  .strict();
export type ContactFieldListQuery = z.infer<typeof ContactFieldListQuerySchema>;

/** Checks one custom field value against its definition; returns an error message or null. */
export function validateCustomFieldValue(
  def: { kind: string; options: readonly string[] },
  value: string | number | boolean | null,
): string | null {
  if (value === null) return null;
  switch (def.kind) {
    case 'string':
      return typeof value === 'string' ? null : 'Metin bekleniyor';
    case 'number':
      return typeof value === 'number' ? null : 'Sayı bekleniyor';
    case 'boolean':
      return typeof value === 'boolean' ? null : 'Evet/hayır bekleniyor';
    case 'date':
      return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value))
        ? null
        : 'Tarih (YYYY-AA-GG) bekleniyor';
    case 'enum':
      return typeof value === 'string' && def.options.includes(value) ? null : 'Listede olmayan değer';
    default:
      return 'Bilinmeyen alan türü';
  }
}

// ---------------------------------------------------------------------------
// Pipeline stages
// ---------------------------------------------------------------------------

export const CreatePipelineStageSchema = z
  .object({
    key: z.string().regex(/^[A-Z][A-Z0-9_]{0,39}$/, 'Anahtar büyük harf, rakam ve alt çizgi içerebilir'),
    name: z.string().trim().min(1).max(80),
    kind: z.enum(PIPELINE_STAGE_KINDS).default('OPEN'),
    sortOrder: z.number().int().min(0).max(1000).optional(),
  })
  .strict();
export type CreatePipelineStageInput = z.infer<typeof CreatePipelineStageSchema>;

export const UpdatePipelineStageSchema = z
  .object({
    /** Null restores the built-in (translated) label of a system stage. */
    name: z.string().trim().min(1).max(80).nullable().optional(),
    sortOrder: z.number().int().min(0).max(1000).optional(),
  })
  .strict();
export type UpdatePipelineStageInput = z.infer<typeof UpdatePipelineStageSchema>;

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export const CreateContactTaskSchema = z
  .object({
    title: z.string().trim().min(1, 'Başlık giriniz').max(200),
    notes: z.string().trim().max(2000).optional(),
    dueAt: z.string().datetime().optional(),
    assigneeMembershipId: z.string().uuid().optional(),
  })
  .strict();
export type CreateContactTaskInput = z.infer<typeof CreateContactTaskSchema>;

export const UpdateContactTaskSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
    dueAt: z.string().datetime().nullable().optional(),
    assigneeMembershipId: z.string().uuid().nullable().optional(),
    status: z.enum(CONTACT_TASK_STATUSES).optional(),
  })
  .strict();
export type UpdateContactTaskInput = z.infer<typeof UpdateContactTaskSchema>;

export const ContactTaskListQuerySchema = z
  .object({
    status: z.enum(CONTACT_TASK_STATUSES).optional(),
    assigneeMembershipId: z.string().uuid().optional(),
    overdue: z
      .enum(['true', 'false'])
      .optional()
      .transform((v) => v === 'true'),
  })
  .strict();
export type ContactTaskListQuery = z.infer<typeof ContactTaskListQuerySchema>;

// ---------------------------------------------------------------------------
// Attribution report
// ---------------------------------------------------------------------------

export const ATTRIBUTION_GROUP_BY = ['source', 'campaign', 'adset', 'ad'] as const;
export type AttributionGroupBy = (typeof ATTRIBUTION_GROUP_BY)[number];

export const AttributionReportQuerySchema = z
  .object({
    model: z.enum(ATTRIBUTION_MODELS).default('LAST_TOUCH'),
    from: z.string().datetime(),
    to: z.string().datetime(),
    groupBy: z.enum(ATTRIBUTION_GROUP_BY).default('source'),
  })
  .strict()
  .refine((v) => Date.parse(v.from) < Date.parse(v.to), { message: 'Başlangıç bitişten önce olmalı', path: ['from'] });
export type AttributionReportQuery = z.infer<typeof AttributionReportQuerySchema>;

/** Tenant setting (G2b): replaces the previously hard-coded DEFAULT_ATTRIBUTION_WINDOW_DAYS. */
export const UpdateAttributionWindowSchema = z.object({ attributionWindowDays: z.number().int().min(1).max(365) }).strict();
export type UpdateAttributionWindowInput = z.infer<typeof UpdateAttributionWindowSchema>;

/** Placeholder bucket keys for conversions without a matching touch. */
export const ATTRIBUTION_DIRECT = '(direct)';
export const ATTRIBUTION_NONE = '(none)';

export interface AttributionReportRowDTO {
  key: string;
  /** Credited conversions per type; fractional under the LINEAR model. */
  conversions: Partial<Record<ConversionEventType, number>>;
  /** Credited revenue per ISO 4217 currency, as decimal strings. */
  revenue: Record<string, string>;
  /** Ad spend matched to this key (G2b), per ISO 4217 currency, as decimal strings. Empty when no AdSpendDaily matched. */
  spend: Record<string, string>;
  /** Cost per lead, customer acquisition cost and return on ad spend, per currency; null when there is no spend or no matching conversions in that currency. */
  cpl: Record<string, number | null>;
  cac: Record<string, number | null>;
  roas: Record<string, number | null>;
}

export interface AttributionReportDTO {
  model: (typeof ATTRIBUTION_MODELS)[number];
  groupBy: AttributionGroupBy;
  from: string;
  to: string;
  windowDays: number;
  rows: AttributionReportRowDTO[];
  totals: {
    conversions: Partial<Record<ConversionEventType, number>>;
    revenue: Record<string, string>;
    spend: Record<string, string>;
    cpl: Record<string, number | null>;
    cac: Record<string, number | null>;
    roas: Record<string, number | null>;
  };
  /** Touchpoints in the range that came from paid ads without our standard parameters. */
  untaggedPaidTouchpoints: number;
}


// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

export interface PipelineStageDTO {
  id: string;
  key: string;
  name: string | null;
  kind: PipelineStageKind;
  sortOrder: number;
  isSystem: boolean;
}

export interface ContactDTO {
  id: string;
  studioId: string;
  firstName: string;
  lastName: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  locale: string | null;
  countryCode: string | null;
  timezone: string | null;
  lifecycleStage: LifecycleStage;
  pipelineStage: { id: string; key: string; name: string | null; kind: PipelineStageKind } | null;
  ownerMembershipId: string | null;
  ownerName: string | null;
  branchId: string | null;
  tags: string[];
  customFields: ContactCustomFields;
  membershipId: string | null;
  firstSource: string | null;
  firstCampaignId: string | null;
  lastSource: string | null;
  lastCampaignId: string | null;
  sourceChannel: string | null;
  sourceDetail: string | null;
  nextFollowUpAt: string | null;
  notes: string | null;
  isTest: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ContactListResponseDTO {
  items: ContactDTO[];
  total: number;
  page: number;
  limit: number;
}

// ---------------------------------------------------------------------------
// Contact-level commercial consent (G2a)
// ---------------------------------------------------------------------------

/**
 * Commercial-message consent recorded on the contact itself, so a person
 * without a user account (a lead from a form, an imported contact) can be
 * messaged lawfully. For a contact with an account the member's own
 * CommunicationConsent row still counts: the most recent decision of the
 * two wins, and an unsubscribe or STOP revokes both.
 */
export const CONTACT_CONSENT_CHANNELS = ['SMS', 'WHATSAPP', 'EMAIL'] as const;
export type ContactConsentChannel = (typeof CONTACT_CONSENT_CHANNELS)[number];

export const UpdateContactConsentSchema = z
  .object({
    channel: z.enum(CONTACT_CONSENT_CHANNELS),
    granted: z.boolean(),
    /** How the person agreed (e.g. "signed form at the desk"); required when granting. */
    evidence: z.string().trim().max(300).optional(),
  })
  .strict()
  .refine((v) => !v.granted || (v.evidence?.length ?? 0) > 0, { message: 'Onayın nasıl alındığını yazınız', path: ['evidence'] });
export type UpdateContactConsentInput = z.infer<typeof UpdateContactConsentSchema>;

export interface ContactConsentDTO {
  channel: ContactConsentChannel;
  /** Effective status after merging the contact row and the member's own consent. */
  status: 'GRANTED' | 'REVOKED';
  /** Which record decided the status. */
  decidedBy: 'contact' | 'member' | 'default';
  source: string | null;
  evidence: string | null;
  grantedAt: string | null;
  revokedAt: string | null;
  /** The address is on the suppression list (unsubscribe, STOP, bounce, complaint). */
  suppressed: boolean;
}

export interface ContactActivityDTO {
  id: string;
  type: string;
  body: string;
  actorName: string | null;
  createdAt: string;
}

export interface ContactTaskDTO {
  id: string;
  title: string;
  notes: string | null;
  dueAt: string | null;
  status: ContactTaskStatus;
  assigneeMembershipId: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface ContactTouchpointDTO {
  id: string;
  occurredAt: string;
  landingHost: string | null;
  landingPath: string;
  referrerHost: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  adPlatform: string | null;
  pwCid: string | null;
  pwAsid: string | null;
  pwAdid: string | null;
  isPaidUntagged: boolean;
}

export interface ContactConversionDTO {
  id: string;
  eventId: string;
  type: string;
  occurredAt: string;
  valueAmount: string | null;
  currency: string | null;
  isTest: boolean;
}

/** GET /crm/studios/:studioId/contacts/:contactId */
export interface ContactDetailDTO extends ContactDTO {
  activities: ContactActivityDTO[];
  tasks: ContactTaskDTO[];
  touchpoints: ContactTouchpointDTO[];
  conversions: ContactConversionDTO[];
  consents: ContactConsentDTO[];
}

export interface ContactFieldDefinitionDTO {
  id: string;
  key: string;
  label: Record<string, string>;
  kind: ContactFieldKind;
  options: string[];
  sortOrder: number;
  isArchived: boolean;
}
