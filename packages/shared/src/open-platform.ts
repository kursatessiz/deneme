import { z } from 'zod';

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
} as const;

export type WebhookEvent = keyof typeof WEBHOOK_EVENTS;

export const ALL_WEBHOOK_EVENTS = Object.keys(WEBHOOK_EVENTS) as WebhookEvent[];

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
