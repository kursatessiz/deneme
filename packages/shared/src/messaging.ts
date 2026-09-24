import { z } from 'zod';

/**
 * W7 messaging: tenant-configurable channel order/fallback, message
 * templates as tenant data, and İYS-style commercial consent gating.
 * See CLAUDE.md rule 8 and docs/MESSAGING.md.
 */

// ---------------------------------------------------------------------------
// Tenant channel settings (Studio.notificationSettings)
// ---------------------------------------------------------------------------

export const MESSAGE_CHANNELS = ['WHATSAPP', 'SMS'] as const;
export type MessageChannelName = (typeof MESSAGE_CHANNELS)[number];

/**
 * Stored in Studio.notificationSettings. `order` is the channel attempt
 * order (fallback happens in this order on failure or when a channel is
 * unavailable for the recipient); `whatsappEnabled` turns WhatsApp off for
 * the tenant entirely (falls straight to SMS); `smsSenderName` is the
 * approved SMS sender header for Netgsm / İleti Merkezi.
 */
export const NotificationSettingsSchema = z
  .object({
    order: z
      .array(z.enum(MESSAGE_CHANNELS))
      .min(1, 'En az bir kanal seçilmelidir')
      .refine((v) => new Set(v).size === v.length, 'Kanallar tekrar edemez'),
    whatsappEnabled: z.boolean().default(true),
    smsSenderName: z
      .string()
      .trim()
      .max(11, 'SMS başlığı en fazla 11 karakter olabilir')
      .optional(),
  })
  .strict();
export type NotificationSettings = z.infer<typeof NotificationSettingsSchema>;

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  order: ['WHATSAPP', 'SMS'],
  whatsappEnabled: true,
};

/** Studio.notificationSettings is untrusted JSON until parsed; falls back to the default on garbage. */
export function parseNotificationSettings(raw: unknown): NotificationSettings {
  const result = NotificationSettingsSchema.safeParse(raw);
  return result.success ? result.data : DEFAULT_NOTIFICATION_SETTINGS;
}

/** Effective attempt order after the whatsappEnabled toggle is applied. */
export function effectiveChannelOrder(settings: NotificationSettings): MessageChannelName[] {
  return settings.order.filter((c) => c !== 'WHATSAPP' || settings.whatsappEnabled);
}

// ---------------------------------------------------------------------------
// Message templates (tenant data)
// ---------------------------------------------------------------------------

/** Well-known template keys seeded as global defaults by super admin. */
export const MESSAGE_TEMPLATE_KEYS = [
  'BOOKING_REMINDER',
  'BOOKING_CANCELLED_BY_STUDIO',
  'WAITLIST_PROMOTED',
  'PACKAGE_EXPIRING',
  'PAYMENT_FAILED',
  'OTP',
] as const;
export type MessageTemplateKey = (typeof MESSAGE_TEMPLATE_KEYS)[number];

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;

/** Names referenced by {{name}} placeholders in a template body. */
export function templatePlaceholders(body: string): string[] {
  const names = new Set<string>();
  for (const match of body.matchAll(PLACEHOLDER_RE)) names.add(match[1]);
  return [...names];
}

export class TemplateRenderError extends Error {}

/**
 * Substitutes {{named}} placeholders. Throws when a placeholder in the body
 * has no matching param, so a message is never sent half-rendered.
 */
export function renderTemplate(body: string, params: Record<string, string>): string {
  const missing: string[] = [];
  const rendered = body.replace(PLACEHOLDER_RE, (_match, name: string) => {
    if (!(name in params)) {
      missing.push(name);
      return '';
    }
    return params[name];
  });
  if (missing.length > 0) {
    throw new TemplateRenderError(`Şablon parametreleri eksik: ${[...new Set(missing)].join(', ')}`);
  }
  return rendered;
}

export const UpsertMessageTemplateSchema = z
  .object({
    key: z.string().trim().min(1).max(60),
    channel: z.enum(['WHATSAPP', 'SMS', 'PUSH', 'EMAIL']),
    locale: z.string().trim().min(2).max(5).default('tr'),
    body: z.string().trim().min(1, 'Şablon metni boş olamaz').max(2000),
    whatsappTemplateName: z.string().trim().max(120).optional(),
    isTransactional: z.boolean().default(true),
    isActive: z.boolean().default(true),
  })
  .strict()
  .refine((v) => v.channel !== 'WHATSAPP' || !!v.whatsappTemplateName, {
    message: 'WhatsApp şablonları için onaylı şablon adı zorunludur',
    path: ['whatsappTemplateName'],
  });
export type UpsertMessageTemplateInput = z.infer<typeof UpsertMessageTemplateSchema>;

// ---------------------------------------------------------------------------
// Commercial consent (İYS)
// ---------------------------------------------------------------------------

export const CONSENT_CHANNELS = ['SMS', 'WHATSAPP', 'EMAIL', 'CALL'] as const;
export type ConsentChannelName = (typeof CONSENT_CHANNELS)[number];

export const UpdateConsentSchema = z
  .object({
    channel: z.enum(CONSENT_CHANNELS),
    granted: z.boolean(),
  })
  .strict();
export type UpdateConsentInput = z.infer<typeof UpdateConsentSchema>;

export interface CommunicationConsentDTO {
  channel: ConsentChannelName;
  status: 'GRANTED' | 'REVOKED';
  source: string;
  grantedAt: string | null;
  revokedAt: string | null;
}

export const UpdateNotificationSettingsSchema = NotificationSettingsSchema;

export const TopUpSmsWalletSchema = z
  .object({
    studioId: z.string().uuid(),
    credits: z.number().int().refine((v) => v !== 0, 'Kredi miktarı sıfır olamaz'),
    note: z.string().trim().max(200).optional(),
  })
  .strict();
export type TopUpSmsWalletInput = z.infer<typeof TopUpSmsWalletSchema>;
