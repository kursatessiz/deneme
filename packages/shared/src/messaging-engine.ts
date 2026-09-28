import { z } from 'zod';
import { parsePhoneNumberFromString } from 'libphonenumber-js/min';
import { interpolate, placeholdersOf } from './i18n/translator';
import type { MessageParams } from './i18n/translator';
import { complianceRegionOf } from './growth/regions';
import type { ComplianceRegion } from './growth/regions';

/**
 * G1c messaging engine contracts (docs/MESAJLASMA.md): purposes, tenant
 * messaging settings, frequency caps, strict variable interpolation,
 * inbound keyword handling and the WhatsApp customer-service window. The
 * engine itself (MessagingService) lives in apps/api; everything that web,
 * mobile and API must agree on lives here.
 */

export const MESSAGE_PURPOSES = ['TRANSACTIONAL', 'COMMERCIAL'] as const;
export type MessagePurpose = (typeof MESSAGE_PURPOSES)[number];

/** Every channel the engine can deliver on. Mirrors MESSAGE_CHANNELS_V2 (growth/journeys.ts). */
export const ENGINE_CHANNELS = ['EMAIL', 'SMS', 'WHATSAPP', 'PUSH', 'IN_APP'] as const;
export type EngineChannel = (typeof ENGINE_CHANNELS)[number];

/** SMS provider keys a tenant may pin (provider registry override). */
export const SMS_PROVIDER_KEYS = ['NETGSM', 'ILETI_MERKEZI', 'TWILIO'] as const;
export type SmsProviderKey = (typeof SMS_PROVIDER_KEYS)[number];

// ---------------------------------------------------------------------------
// Tenant messaging settings (Studio.messagingSettings)
// ---------------------------------------------------------------------------

export const FrequencyCapSchema = z
  .object({
    perDay: z.number().int().min(0).max(50),
    perWeek: z.number().int().min(0).max(200),
  })
  .strict()
  .refine((v) => v.perWeek >= v.perDay, { message: 'Haftalık sınır günlük sınırdan küçük olamaz', path: ['perWeek'] });
export type FrequencyCap = z.infer<typeof FrequencyCapSchema>;

export const DEFAULT_FREQUENCY_CAP: FrequencyCap = { perDay: 3, perWeek: 10 };

const E164 = z.string().regex(/^\+[1-9]\d{6,14}$/, 'Telefon numarası E.164 biçiminde olmalıdır');

/**
 * Stored in Studio.messagingSettings (the WhatsApp -> SMS channel order stays
 * in Studio.notificationSettings, unchanged). Every field is optional so an
 * empty object means "platform defaults".
 */
export const MessagingSettingsSchema = z
  .object({
    /** Pins the tenant's SMS provider; null follows the country priority list. */
    smsProvider: z.enum(SMS_PROVIDER_KEYS).nullable().optional(),
    /** Commercial messages per contact (all channels together). */
    frequencyCap: FrequencyCapSchema.optional(),
    /** Display name on outgoing email; defaults to the studio name. */
    emailFromName: z.string().trim().min(1).max(80).nullable().optional(),
    /** Reply-To for outgoing email; defaults to the studio email. */
    emailReplyTo: z.string().trim().email('Geçersiz e-posta adresi').max(254).nullable().optional(),
    /** The tenant's own WhatsApp Business phone number id (inbound routing). */
    whatsappPhoneNumberId: z
      .string()
      .trim()
      .regex(/^\d{5,30}$/, 'Geçersiz WhatsApp telefon numarası kimliği')
      .nullable()
      .optional(),
    /** The tenant's own inbound SMS number (Twilio "To"), for inbound routing. */
    inboundSmsNumber: E164.nullable().optional(),
  })
  .strict();
export type MessagingSettings = z.infer<typeof MessagingSettingsSchema>;

/**
 * What a tenant may change itself. The inbound routing numbers decide which
 * tenant receives someone's replies, so only the platform owner sets them
 * (MessagingRoutingSchema), and never to a number another tenant uses.
 */
export const TenantMessagingSettingsSchema = MessagingSettingsSchema.omit({ whatsappPhoneNumberId: true, inboundSmsNumber: true });
export type TenantMessagingSettingsInput = z.infer<typeof TenantMessagingSettingsSchema>;

export const MessagingRoutingSchema = MessagingSettingsSchema.pick({ whatsappPhoneNumberId: true, inboundSmsNumber: true });
export type MessagingRoutingInput = z.infer<typeof MessagingRoutingSchema>;

export interface ResolvedMessagingSettings {
  smsProvider: SmsProviderKey | null;
  frequencyCap: FrequencyCap;
  emailFromName: string | null;
  emailReplyTo: string | null;
  whatsappPhoneNumberId: string | null;
  inboundSmsNumber: string | null;
}

/** Studio.messagingSettings is untrusted JSON until parsed; garbage falls back to the defaults. */
export function parseMessagingSettings(raw: unknown): ResolvedMessagingSettings {
  const parsed = MessagingSettingsSchema.safeParse(raw ?? {});
  const v: MessagingSettings = parsed.success ? parsed.data : {};
  return {
    smsProvider: v.smsProvider ?? null,
    frequencyCap: v.frequencyCap ?? DEFAULT_FREQUENCY_CAP,
    emailFromName: v.emailFromName ?? null,
    emailReplyTo: v.emailReplyTo ?? null,
    whatsappPhoneNumberId: v.whatsappPhoneNumberId ?? null,
    inboundSmsNumber: v.inboundSmsNumber ?? null,
  };
}

/** Commercial sends already made to one contact in the trailing day and week. */
export interface FrequencyCounts {
  lastDay: number;
  lastWeek: number;
}

/** True when one more commercial message would exceed the tenant's cap. */
export function frequencyCapReached(counts: FrequencyCounts, cap: FrequencyCap): boolean {
  return counts.lastDay >= cap.perDay || counts.lastWeek >= cap.perWeek;
}

// ---------------------------------------------------------------------------
// Variable interpolation
// ---------------------------------------------------------------------------

const LEGACY_PLACEHOLDER = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;

/**
 * Templates written before G1c use `{{name}}`; the i18n translator (and
 * every template from now on) uses `{name}`. Normalising the template (not
 * the values) keeps a substituted value from ever being re-read as a
 * placeholder.
 */
export function normalizeTemplateSyntax(template: string): string {
  return template.replace(LEGACY_PLACEHOLDER, '{$1}');
}

/** Placeholder names a template needs (either syntax), sorted. */
export function messagePlaceholders(template: string): string[] {
  return placeholdersOf(normalizeTemplateSyntax(template));
}

export class MessageRenderError extends Error {
  constructor(readonly missing: string[]) {
    super(`Şablon parametreleri eksik: ${missing.join(', ')}`);
    this.name = 'MessageRenderError';
  }
}

/**
 * Renders a message with the shared translator's `interpolate`. Throws
 * MessageRenderError when a placeholder has no value, so a message is never
 * sent half-rendered. Numbers are formatted for `locale`.
 */
export function renderMessageText(template: string, variables: MessageParams, locale?: string): string {
  const normalized = normalizeTemplateSyntax(template);
  const missing = placeholdersOf(normalized).filter((name) => !Object.prototype.hasOwnProperty.call(variables, name));
  if (missing.length > 0) throw new MessageRenderError(missing);
  return interpolate(normalized, variables, locale);
}

/** Preview rendering: missing placeholders stay visible as `{name}` instead of throwing. */
export function renderMessageTextLenient(template: string, variables: MessageParams, locale?: string): string {
  return interpolate(normalizeTemplateSyntax(template), variables, locale);
}

// ---------------------------------------------------------------------------
// Recipient region and inbound keywords
// ---------------------------------------------------------------------------

/** ISO country of an E.164 number, or null when it cannot be told. */
export function countryOfPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  try {
    return parsePhoneNumberFromString(phone)?.country ?? null;
  } catch {
    return null;
  }
}

/** Compliance region of a recipient: their own country, else their phone's, else the tenant's. */
export function recipientRegion(input: {
  countryCode?: string | null;
  phone?: string | null;
  studioCountryCode?: string | null;
}): ComplianceRegion {
  return complianceRegionOf(input.countryCode || countryOfPhone(input.phone) || input.studioCountryCode || null);
}

export type InboundKeyword = 'OPT_OUT' | 'HELP';

/** Recognised everywhere, so a recipient's own language always works. */
const BASE_OPT_OUT = ['STOP', 'UNSUBSCRIBE', 'IPTAL', 'DUR'] as const;
const BASE_HELP = ['HELP', 'YARDIM'] as const;

/** Region extras: TCPA's standard opt-out words for US/CA, İYS's "RET" for TR. */
const REGION_OPT_OUT: Record<ComplianceRegion, readonly string[]> = {
  TR: ['RET'],
  US: ['STOPALL', 'CANCEL', 'END', 'QUIT', 'REVOKE', 'OPTOUT'],
  CA: ['STOPALL', 'CANCEL', 'END', 'QUIT', 'REVOKE', 'OPTOUT', 'ARRET'],
  EU: [],
  UK: [],
  DEFAULT: [],
};
const REGION_HELP: Record<ComplianceRegion, readonly string[]> = {
  TR: [],
  US: ['INFO'],
  CA: ['INFO', 'AIDE'],
  EU: [],
  UK: ['INFO'],
  DEFAULT: [],
};

/** Upper-cases, strips diacritics (İ, ı -> I) and everything that is not a letter. */
export function normalizeKeyword(text: string): string {
  return text
    .trim()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z]/g, '');
}

/** The whole inbound message, as one keyword, per the recipient's region; null for ordinary text. */
export function classifyInboundKeyword(text: string, region: ComplianceRegion): InboundKeyword | null {
  const word = normalizeKeyword(text);
  if (!word || word.length > 12) return null;
  if ((BASE_OPT_OUT as readonly string[]).includes(word) || REGION_OPT_OUT[region].includes(word)) return 'OPT_OUT';
  if ((BASE_HELP as readonly string[]).includes(word) || REGION_HELP[region].includes(word)) return 'HELP';
  return null;
}

// ---------------------------------------------------------------------------
// WhatsApp customer-service window
// ---------------------------------------------------------------------------

/** Meta allows free-form replies for 24 hours after the customer's last message. */
export const WHATSAPP_SERVICE_WINDOW_HOURS = 24;

export function whatsappWindowOpen(lastInboundAt: Date | string | null | undefined, now: Date = new Date()): boolean {
  if (!lastInboundAt) return false;
  const at = typeof lastInboundAt === 'string' ? new Date(lastInboundAt) : lastInboundAt;
  if (Number.isNaN(at.getTime())) return false;
  const elapsed = now.getTime() - at.getTime();
  return elapsed >= 0 && elapsed < WHATSAPP_SERVICE_WINDOW_HOURS * 60 * 60 * 1000;
}

// ---------------------------------------------------------------------------
// Delivery record DTOs
// ---------------------------------------------------------------------------

export const MESSAGE_SEND_REASON_CODES = [
  'CONSENT_REQUIRED',
  'OPTED_OUT',
  'QUIET_HOURS',
  'FREQUENCY_CAP',
  'SUPPRESSED',
  'DUPLICATE',
  'PREFERENCE_OFF',
  'NO_TEMPLATE',
  'TEMPLATE_NOT_APPROVED',
  'RENDER_ERROR',
  'NO_ADDRESS',
  'INSUFFICIENT_CREDIT',
  'PROVIDER_ERROR',
  'NOT_CONFIGURED',
  'RECIPIENT_NOT_FOUND',
] as const;
export type MessageSendReasonCode = (typeof MESSAGE_SEND_REASON_CODES)[number];

/** A member's in-app message (NotificationLog row with channel IN_APP). */
export interface InAppMessageDTO {
  id: string;
  subject: string | null;
  body: string;
  createdAt: string;
  readAt: string | null;
}
