import { z } from 'zod';
import { CONTACT_CONSENT_CHANNELS, ContactCustomFieldsSchema, normalizeTag } from './crm';
import { CountryCodeSchema } from './growth/regions';
import { CONSENT_LEGAL_BASES } from './marketing/consent';

/**
 * The open platform (W18): API keys for the public REST API and outbound
 * webhooks. Single source of truth for scope/event catalogues and their
 * validators, shared by apps/api and apps/web.
 */

// ---------------------------------------------------------------------------
// API key scopes
// ---------------------------------------------------------------------------

export const API_KEY_SCOPES = {
  'schedules.read': 'Şube, hizmet türü ve seans takvimini okuma',
  'bookings.read': 'Rezervasyonları okuma',
  'bookings.write': 'Rezervasyon oluşturma ve iptal etme',
  'members.read': 'Üye telefon numarası dahil üye bilgilerini okuma',
  'webhooks.manage': 'Webhook uç noktalarını yönetme',
  // M4c: inbound actions of automation tools (Zapier, Make, n8n).
  'crm.write': 'Kişi oluşturma, etiketleme ve iletişim izni kaydetme',
} as const;

export type ApiKeyScope = keyof typeof API_KEY_SCOPES;

export const ALL_API_KEY_SCOPES = Object.keys(API_KEY_SCOPES) as ApiKeyScope[];

export function isApiKeyScope(value: string): value is ApiKeyScope {
  return Object.prototype.hasOwnProperty.call(API_KEY_SCOPES, value);
}

export const ApiKeyScopeSchema = z.enum(ALL_API_KEY_SCOPES as [ApiKeyScope, ...ApiKeyScope[]]);

export const CreateApiKeySchema = z.object({
  name: z.string().trim().min(2, 'Anahtar adı giriniz').max(80),
  scopes: z.array(ApiKeyScopeSchema).min(1, 'En az bir yetki alanı seçilmelidir'),
  expiresAt: z.string().datetime().optional(),
});
export type CreateApiKeyInput = z.infer<typeof CreateApiKeySchema>;

// ---------------------------------------------------------------------------
// Webhook events
// ---------------------------------------------------------------------------

export const WEBHOOK_EVENTS = {
  'booking.created': 'Yeni rezervasyon oluşturuldu',
  'booking.cancelled': 'Rezervasyon iptal edildi',
  'booking.attended': 'Üye seansa giriş yaptı',
  'member.created': 'Yeni üye eklendi',
  'payment.completed': 'Ödeme tamamlandı',
  'payment.refunded': 'Ödeme iade edildi',
  // G3c-3: automation tools (Zapier and other REST-hook clients).
  'lead.created': 'Yeni potansiyel müşteri (aday) oluşturuldu',
  'event.registration.created': 'Etkinliğe yeni kayıt oluşturuldu',
  'retail.sale.completed': 'Mağaza satışı tamamlandı',
  // M4c: platform events, published only for the platform tenant's subscriptions.
  'studio.signup': 'Yeni bir işletme hesabı oluşturuldu',
  'studio.paid': 'Bir işletme ilk ödemesini yaptı ve etkinleşti',
  'studio.trial_expiring': 'Bir işletmenin deneme süresi bitmek üzere',
  'contact.lifecycle_changed': 'Bir kişinin yaşam döngüsü aşaması değişti',
  'campaign.sent': 'Bir kampanyanın gönderimi tamamlandı',
} as const;

export type WebhookEvent = keyof typeof WEBHOOK_EVENTS;

export const ALL_WEBHOOK_EVENTS = Object.keys(WEBHOOK_EVENTS) as WebhookEvent[];

/**
 * Events about the platform's own business (signups, payments, campaigns of
 * the platform tenant). They are emitted only for webhook endpoints of the
 * platform tenant (Studio.isPlatform); other tenants cannot subscribe.
 */
export const PLATFORM_WEBHOOK_EVENTS = ['studio.signup', 'studio.paid', 'studio.trial_expiring', 'contact.lifecycle_changed', 'campaign.sent'] as const satisfies readonly WebhookEvent[];
export type PlatformWebhookEvent = (typeof PLATFORM_WEBHOOK_EVENTS)[number];

export function isPlatformWebhookEvent(event: string): event is PlatformWebhookEvent {
  return (PLATFORM_WEBHOOK_EVENTS as readonly string[]).includes(event);
}

/** Events every tenant may subscribe to (the catalogue without the platform events). */
export const TENANT_WEBHOOK_EVENTS: readonly WebhookEvent[] = ALL_WEBHOOK_EVENTS.filter((e) => !isPlatformWebhookEvent(e));

export function isWebhookEvent(value: string): value is WebhookEvent {
  return Object.prototype.hasOwnProperty.call(WEBHOOK_EVENTS, value);
}

export const WebhookEventSchema = z.enum(ALL_WEBHOOK_EVENTS as [WebhookEvent, ...WebhookEvent[]]);

export const CreateWebhookEndpointSchema = z.object({
  url: z
    .string()
    .url()
    .refine((v) => v.startsWith('https://'), 'Webhook adresi https:// ile başlamalıdır'),
  events: z.array(WebhookEventSchema).min(1, 'En az bir olay seçilmelidir'),
  isActive: z.boolean().default(true),
});
export type CreateWebhookEndpointInput = z.infer<typeof CreateWebhookEndpointSchema>;

export const UpdateWebhookEndpointSchema = z.object({
  url: z
    .string()
    .url()
    .refine((v) => v.startsWith('https://'), 'Webhook adresi https:// ile başlamalıdır')
    .optional(),
  events: z.array(WebhookEventSchema).min(1, 'En az bir olay seçilmelidir').optional(),
  isActive: z.boolean().optional(),
});
export type UpdateWebhookEndpointInput = z.infer<typeof UpdateWebhookEndpointSchema>;

export const SendTestWebhookSchema = z.object({
  event: WebhookEventSchema,
});
export type SendTestWebhookInput = z.infer<typeof SendTestWebhookSchema>;

// ---------------------------------------------------------------------------
// REST hooks and sample payloads (G3c-3, docs/ZAPIER.md)
// ---------------------------------------------------------------------------

/** Body of `POST /v1/public/hooks`: one target URL subscribed to exactly one event. */
export const SubscribeHookSchema = z.object({
  targetUrl: z
    .string()
    .url()
    .max(2000)
    .refine((v) => v.startsWith('https://'), 'Webhook adresi https:// ile başlamalıdır'),
  event: WebhookEventSchema,
});
export type SubscribeHookInput = z.infer<typeof SubscribeHookSchema>;

/** Most REST-hook subscriptions one studio may hold through the public API. */
export const MAX_REST_HOOKS_PER_STUDIO = 100;

/** Envelope every delivery carries: `data` differs per event, see WEBHOOK_SAMPLE_DATA. */
export interface WebhookEnvelope {
  event: WebhookEvent;
  studioId: string;
  occurredAt: string;
  data: Record<string, unknown>;
}

/**
 * Realistic `data` of each event, shaped exactly like what the emitting
 * service sends (ids are placeholders). Zapier shows these fields when the
 * user maps a trigger; a unit test keeps the keys equal to WEBHOOK_EVENTS.
 */
export const WEBHOOK_SAMPLE_DATA: Record<WebhookEvent, Record<string, unknown>> = {
  'booking.created': {
    bookingId: '3f0b6c1e-2b7a-4a3c-9d55-0a1b2c3d4e01',
    scheduleId: '8a1d4f52-6c1e-4b0f-8a52-5d7e9b1c2f02',
    memberId: '5c2e9a77-1d3b-4f6a-b8c4-7e0d1a2b3c03',
  },
  'booking.cancelled': {
    bookingId: '3f0b6c1e-2b7a-4a3c-9d55-0a1b2c3d4e01',
    scheduleId: '8a1d4f52-6c1e-4b0f-8a52-5d7e9b1c2f02',
    memberId: '5c2e9a77-1d3b-4f6a-b8c4-7e0d1a2b3c03',
    isLateCancellation: false,
  },
  'booking.attended': {
    bookingId: '3f0b6c1e-2b7a-4a3c-9d55-0a1b2c3d4e01',
    scheduleId: '8a1d4f52-6c1e-4b0f-8a52-5d7e9b1c2f02',
    memberId: '5c2e9a77-1d3b-4f6a-b8c4-7e0d1a2b3c03',
  },
  'member.created': {
    membershipId: '9e4b7c10-5a2d-4e8f-a1b3-6c7d8e9f0a04',
    firstName: 'Ayşe',
    lastName: 'Yılmaz',
  },
  // memberId is null for a guest or walk-in payment; contactId then names the
  // payer when known (both null for an anonymous walk-in sale).
  'payment.completed': {
    paymentId: '1b8d3e5f-7a9c-4d2e-8f10-3a4b5c6d7e05',
    memberId: '5c2e9a77-1d3b-4f6a-b8c4-7e0d1a2b3c03',
    contactId: null,
    amount: '250.00',
    currency: 'EUR',
  },
  'payment.refunded': {
    paymentId: '1b8d3e5f-7a9c-4d2e-8f10-3a4b5c6d7e05',
    memberId: null,
    contactId: '6d1f2a3b-4c5d-4e6f-8a7b-9c0d1e2f3a06',
    amount: '250.00',
    currency: 'EUR',
    fullyRefunded: false,
  },
  'lead.created': {
    contactId: '6d1f2a3b-4c5d-4e6f-8a7b-9c0d1e2f3a06',
    fullName: 'Mehmet Demir',
    phone: '+905551112233',
    email: 'mehmet@example.com',
    source: 'WEB_FORM',
  },
  'event.registration.created': {
    registrationId: '2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e07',
    eventId: '7f8a9b0c-1d2e-4f3a-8b4c-5d6e7f8a9b08',
    ticketTypeId: '4a5b6c7d-8e9f-4a0b-8c1d-2e3f4a5b6c09',
    status: 'CONFIRMED',
    memberId: '5c2e9a77-1d3b-4f6a-b8c4-7e0d1a2b3c03',
    contactId: null,
    amountDue: '400.00',
    currency: 'EUR',
  },
  'retail.sale.completed': {
    saleId: 'a0b1c2d3-e4f5-4a6b-8c7d-8e9f0a1b2c10',
    receiptNumber: 'S000042',
    total: '85.00',
    currency: 'EUR',
    paymentId: '1b8d3e5f-7a9c-4d2e-8f10-3a4b5c6d7e05',
  },
  'studio.signup': {
    studioId: 'b1c2d3e4-f5a6-4b7c-8d9e-0f1a2b3c4d11',
    name: 'Acme Studio',
    slug: 'acme-studio',
    countryCode: 'DE',
    ownerContactId: '6d1f2a3b-4c5d-4e6f-8a7b-9c0d1e2f3a06',
  },
  'studio.paid': {
    studioId: 'b1c2d3e4-f5a6-4b7c-8d9e-0f1a2b3c4d11',
    name: 'Acme Studio',
    planKey: 'growth',
    amount: '49.00',
    currency: 'EUR',
  },
  'studio.trial_expiring': {
    studioId: 'b1c2d3e4-f5a6-4b7c-8d9e-0f1a2b3c4d11',
    name: 'Acme Studio',
    trialEndsAt: '2026-10-01T09:00:00.000Z',
    daysLeft: 3,
  },
  'contact.lifecycle_changed': {
    contactId: '6d1f2a3b-4c5d-4e6f-8a7b-9c0d1e2f3a06',
    from: 'LEAD',
    to: 'TRIAL',
    event: 'trial',
  },
  'campaign.sent': {
    campaignId: 'c2d3e4f5-a6b7-4c8d-9e0f-1a2b3c4d5e12',
    name: 'Autumn offer',
    channel: 'EMAIL',
    audience: 1200,
    sent: 1180,
    skipped: 15,
    failed: 5,
  },
};

/** A full sample delivery for an event, as the receiving URL would see it. */
export function webhookSamplePayload(event: WebhookEvent, studioId: string, now: Date = new Date()): WebhookEnvelope {
  return { event, studioId, occurredAt: now.toISOString(), data: { ...WEBHOOK_SAMPLE_DATA[event] } };
}

// ---------------------------------------------------------------------------
// Retry policy (also used by unit tests and docs)
// ---------------------------------------------------------------------------

/** Delay in seconds before each retry attempt, indexed by attempt number (1-based). Attempt 1 is the first try, not a retry. */
export const WEBHOOK_RETRY_DELAYS_SECONDS = [0, 30, 120, 600, 1800, 3600] as const;
export const WEBHOOK_MAX_ATTEMPTS = WEBHOOK_RETRY_DELAYS_SECONDS.length;
/** Consecutive failed deliveries (across separate events) after which an endpoint is auto-disabled. */
export const WEBHOOK_AUTO_DISABLE_AFTER_FAILURES = 20;

/** Delay in seconds before the given attempt number is retried (attempt is 1-based, the attempt that just failed). */
export function webhookBackoffSeconds(attempt: number): number {
  const index = Math.min(Math.max(attempt, 1), WEBHOOK_RETRY_DELAYS_SECONDS.length) - 1;
  return WEBHOOK_RETRY_DELAYS_SECONDS[index];
}

// ---------------------------------------------------------------------------
// Public API pagination + masking helpers
// ---------------------------------------------------------------------------

export const PublicListSchedulesQuerySchema = z
  .object({
    branchId: z.string().uuid().optional(),
    from: z.string().datetime(),
    to: z.string().datetime(),
  })
  .refine((v) => new Date(v.to) > new Date(v.from), { path: ['to'], message: 'to, from tarihinden sonra olmalıdır' })
  .refine((v) => new Date(v.to).getTime() - new Date(v.from).getTime() <= 31 * 24 * 60 * 60 * 1000, {
    path: ['to'],
    message: 'Tarih aralığı en fazla 31 gün olabilir',
  });
export type PublicListSchedulesQuery = z.infer<typeof PublicListSchedulesQuerySchema>;

export const PublicListBookingsQuerySchema = z.object({
  branchId: z.string().uuid().optional(),
  scheduleId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type PublicListBookingsQuery = z.infer<typeof PublicListBookingsQuerySchema>;

export const PublicCreateBookingSchema = z.object({
  scheduleId: z.string().uuid(),
  memberPhone: z.string().min(8),
  memberPackageId: z.string().uuid().optional(),
  resourceIds: z.array(z.string().uuid()).max(5).default([]),
});
export type PublicCreateBookingInput = z.infer<typeof PublicCreateBookingSchema>;

export const PublicCancelBookingSchema = z.object({
  bookingId: z.string().uuid(),
  reason: z.string().max(500).optional(),
});
export type PublicCancelBookingInput = z.infer<typeof PublicCancelBookingSchema>;

/** Masks all but the last 2 digits of a phone number, e.g. +905321234567 -> +90 *** *** ** 67. */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 4) return '***';
  const last2 = digits.slice(-2);
  return `+${digits.slice(0, 2)} *** *** ** ${last2}`;
}

/**
 * An embed origin allowed to frame /embed/<slug>: https scheme, host and
 * optional port only. Anything else (paths, spaces, `;`) could inject CSP
 * directives, so it is rejected here and filtered again in the web middleware.
 */
export const EMBED_ORIGIN_PATTERN = /^https:\/\/[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:\d{1,5})?$/i;

/** Studio slug as used in public URLs. */
export const STUDIO_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

export const UpdateEmbedSettingsSchema = z.object({
  /** Empty list means any origin may frame /embed/<slug> (frame-ancestors *). */
  embedAllowedOrigins: z.array(z.string().regex(EMBED_ORIGIN_PATTERN, 'Geçersiz origin (ör. https://ornek.com)')).max(20),
});
export type UpdateEmbedSettingsInput = z.infer<typeof UpdateEmbedSettingsSchema>;

// ---------------------------------------------------------------------------
// Inbound actions for automation tools (M4c, scope crm.write)
// ---------------------------------------------------------------------------

/** Request header that makes a public write safe to retry; the response is stored for PUBLIC_IDEMPOTENCY_TTL_HOURS. */
export const PUBLIC_IDEMPOTENCY_HEADER = 'idempotency-key';
export const PUBLIC_IDEMPOTENCY_TTL_HOURS = 24;
export const PublicIdempotencyKeySchema = z.string().regex(/^[A-Za-z0-9._:-]{8,128}$/, 'Idempotency-Key 8-128 karakter olmalı (harf, rakam, . _ : -)');

/** Contacts created through the public API carry this manual source channel. */
export const PUBLIC_API_SOURCE_CHANNEL = 'API';

export const PUBLIC_API_ERROR_CODES = ['IDEMPOTENCY_KEY_REUSED', 'IDEMPOTENCY_IN_PROGRESS', 'CONSENT_BASIS_NOT_ALLOWED', 'CONSENT_CHANNEL_ADDRESS_MISSING', 'CONTACT_NOT_FOUND'] as const;
export type PublicApiErrorCode = (typeof PUBLIC_API_ERROR_CODES)[number];

const PublicTagSchema = z
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

/** POST /v1/public/contacts: creates the contact, or updates the one that already has this email or phone. */
export const PublicUpsertContactSchema = z
  .object({
    email: z.string().trim().email('Geçersiz e-posta formatı').max(120).optional(),
    /** E.164, or a national number in the tenant's country. */
    phone: z.string().trim().min(6).max(30).optional(),
    firstName: z.string().trim().min(1).max(60).optional(),
    lastName: z.string().trim().max(60).optional(),
    /** Split into first and last name when neither is given. */
    fullName: z.string().trim().min(1).max(121).optional(),
    locale: z.string().trim().min(2).max(10).optional(),
    countryCode: CountryCodeSchema.optional(),
    isBusiness: z.boolean().optional(),
    tags: z.array(PublicTagSchema).max(20).optional(),
    customFields: ContactCustomFieldsSchema.optional(),
    sourceDetail: z.string().trim().max(200).optional(),
  })
  .strict()
  .refine((v) => Boolean(v.email) || Boolean(v.phone), { message: 'Telefon veya e-posta gerekli', path: ['email'] });
export type PublicUpsertContactInput = z.infer<typeof PublicUpsertContactSchema>;

/** POST /v1/public/contacts/:id/tags */
export const PublicAddTagsSchema = z.object({ tags: z.array(PublicTagSchema).min(1).max(20) }).strict();
export type PublicAddTagsInput = z.infer<typeof PublicAddTagsSchema>;

/**
 * POST /v1/public/contacts/:id/consents: records the contact's consent on
 * one or more channels under the M3e rules. A CONSENT grant needs the form
 * version the person saw (recorded as evidence) and, in a double opt-in
 * region, waits for the confirmation e-mail's link. TR_MERCHANT_EXEMPTION
 * only applies to a business contact when the platform switch is on;
 * EXISTING_CUSTOMER is derived at send time and cannot be recorded.
 */
export const PublicRecordConsentSchema = z
  .object({
    channels: z
      .array(z.enum(CONTACT_CONSENT_CHANNELS))
      .min(1)
      .max(CONTACT_CONSENT_CHANNELS.length)
      .transform((list) => [...new Set(list)]),
    granted: z.boolean().default(true),
    legalBasis: z.enum(CONSENT_LEGAL_BASES).default('CONSENT'),
    formVersion: z.string().trim().min(1).max(60).optional(),
    /** Where the person is, when the contact has no country yet (decides double opt-in). */
    countryCode: CountryCodeSchema.optional(),
    locale: z.string().trim().min(2).max(10).optional(),
  })
  .strict()
  .refine((v) => !v.granted || v.legalBasis !== 'CONSENT' || Boolean(v.formVersion), {
    message: 'Onay için form sürümü gerekli',
    path: ['formVersion'],
  });
export type PublicRecordConsentInput = z.infer<typeof PublicRecordConsentSchema>;

/** A contact as the public API returns it: the phone is masked. */
export interface PublicContactDTO {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  tags: string[];
  lifecycleStage: string;
  createdAt: string;
}

export interface PublicContactUpsertResultDTO {
  created: boolean;
  contact: PublicContactDTO;
}

export interface PublicConsentResultDTO {
  contactId: string;
  channels: { channel: string; status: 'GRANTED' | 'REVOKED'; legalBasis: string | null; pendingConfirmation: boolean; suppressed: boolean }[];
  /** True when the grant waits for the person to click the confirmation e-mail. */
  doubleOptIn: boolean;
}
