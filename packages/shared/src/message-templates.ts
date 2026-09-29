import { z } from 'zod';
import { EmailBlocksSchema } from './email-blocks';
import type { EmailBlock } from './email-blocks';
import { BUNDLED_MESSAGES } from './i18n/messages';
import type { MessageKey } from './i18n/messages';
import type { MessagePurpose } from './messaging-engine';

/**
 * Message templates (docs/MESAJLASMA.md, "Şablonlar"). A template is keyed
 * by (key, channel, locale) and is either a tenant override, a global
 * default (super admin) or the built-in default below. The built-in texts
 * are i18n messages (namespace `msgTpl`), so every default ships in tr and
 * en and is seeded into the global template table.
 */

export const TEMPLATE_CHANNELS = ['SMS', 'WHATSAPP', 'EMAIL', 'PUSH', 'IN_APP'] as const;
export type TemplateChannel = (typeof TEMPLATE_CHANNELS)[number];

export const WHATSAPP_TEMPLATE_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;
export type WhatsappTemplateStatus = (typeof WHATSAPP_TEMPLATE_STATUSES)[number];

export interface BuiltinTemplateDefinition {
  key: string;
  purpose: MessagePurpose;
  /** Variables the texts use; listed in the editor. */
  variables: readonly string[];
  /** Name of the approved WhatsApp template for the default (per locale suffix). */
  whatsappName: string;
  /** Optional call-to-action button in the email: label message key and URL variable. */
  emailButton?: { labelKey: MessageKey; urlVariable: string };
}

/** Every template key the platform sends by itself. */
export const BUILTIN_TEMPLATES: readonly BuiltinTemplateDefinition[] = [
  { key: 'BOOKING_REMINDER', purpose: 'TRANSACTIONAL', variables: ['firstName', 'serviceName', 'startTime'], whatsappName: 'booking_reminder' },
  { key: 'BOOKING_CANCELLED_BY_STUDIO', purpose: 'TRANSACTIONAL', variables: ['firstName', 'serviceName', 'startTime'], whatsappName: 'booking_cancelled' },
  { key: 'WAITLIST_PROMOTED', purpose: 'TRANSACTIONAL', variables: ['firstName', 'serviceName'], whatsappName: 'waitlist_promoted' },
  {
    key: 'PACKAGE_EXPIRING',
    purpose: 'TRANSACTIONAL',
    variables: ['firstName', 'packageName', 'remainingUnits', 'expiryDate'],
    whatsappName: 'package_expiring',
  },
  { key: 'PAYMENT_FAILED', purpose: 'TRANSACTIONAL', variables: ['firstName', 'amount'], whatsappName: 'payment_failed' },
  { key: 'OTP', purpose: 'TRANSACTIONAL', variables: ['code'], whatsappName: 'otp' },
  { key: 'BIRTHDAY', purpose: 'COMMERCIAL', variables: ['firstName', 'studioName'], whatsappName: 'birthday' },
  { key: 'WIN_BACK', purpose: 'COMMERCIAL', variables: ['firstName', 'studioName'], whatsappName: 'win_back' },
  { key: 'FIRST_CLASS_FOLLOW_UP', purpose: 'TRANSACTIONAL', variables: ['firstName', 'studioName'], whatsappName: 'first_class_follow_up' },
  {
    key: 'NO_SHOW_FOLLOW_UP',
    purpose: 'TRANSACTIONAL',
    variables: ['firstName', 'serviceName', 'startTime'],
    whatsappName: 'no_show_follow_up',
  },
  {
    key: 'INVITE_LINK',
    purpose: 'TRANSACTIONAL',
    variables: ['studioName', 'inviteUrl'],
    whatsappName: 'invite_link',
    emailButton: { labelKey: 'msgTpl.INVITE_LINK.cta', urlVariable: 'inviteUrl' },
  },
  { key: 'INBOX_HELP_REPLY', purpose: 'TRANSACTIONAL', variables: ['studioName'], whatsappName: 'inbox_help' },
  { key: 'INBOX_OPT_OUT_CONFIRM', purpose: 'TRANSACTIONAL', variables: ['studioName'], whatsappName: 'inbox_opt_out' },
  /**
   * G3a: points about to expire. Informational about the member's own
   * balance, not an offer, so it is sent as TRANSACTIONAL (docs/SADAKAT.md).
   */
  {
    key: 'LOYALTY_POINTS_EXPIRING',
    purpose: 'TRANSACTIONAL',
    variables: ['firstName', 'studioName', 'points', 'expiryDate'],
    whatsappName: 'loyalty_points_expiring',
  },
  /**
   * G3c-1 events (docs/ETKINLIKLER.md): about the person's own registration,
   * never an offer, so all are TRANSACTIONAL.
   */
  {
    key: 'EVENT_REGISTRATION_CONFIRMED',
    purpose: 'TRANSACTIONAL',
    variables: ['firstName', 'studioName', 'eventTitle', 'startTime'],
    whatsappName: 'event_registration_confirmed',
  },
  { key: 'EVENT_REMINDER', purpose: 'TRANSACTIONAL', variables: ['firstName', 'eventTitle', 'startTime'], whatsappName: 'event_reminder' },
  { key: 'EVENT_CANCELLED', purpose: 'TRANSACTIONAL', variables: ['firstName', 'studioName', 'eventTitle', 'startTime'], whatsappName: 'event_cancelled' },
  { key: 'EVENT_WAITLIST_PROMOTED', purpose: 'TRANSACTIONAL', variables: ['firstName', 'eventTitle', 'startTime'], whatsappName: 'event_waitlist_promoted' },
  { key: 'EVENT_PAYMENT_DUE', purpose: 'TRANSACTIONAL', variables: ['firstName', 'eventTitle', 'paymentDueAt'], whatsappName: 'event_payment_due' },
  /**
   * G5c-1 platform billing (docs/DENEME_VE_ETKINLESTIRME.md): to the
   * business owner about their own platform account, so TRANSACTIONAL.
   */
  {
    key: 'TRIAL_ENDING',
    purpose: 'TRANSACTIONAL',
    variables: ['firstName', 'studioName', 'daysLeft', 'trialEndDate', 'planPrice'],
    whatsappName: 'trial_ending',
  },
  { key: 'TRIAL_RESTRICTED', purpose: 'TRANSACTIONAL', variables: ['firstName', 'studioName'], whatsappName: 'trial_restricted' },
  /**
   * H1 error reporting (docs/HATA_RAPORLAMA.md): email-only operational
   * alerts to super admins, TRANSACTIONAL. The link opens the group in the
   * super admin panel.
   */
  {
    key: 'ERROR_NEW_GROUP',
    purpose: 'TRANSACTIONAL',
    variables: ['firstName', 'title', 'source', 'release', 'code', 'route', 'link'],
    whatsappName: 'error_new_group',
    emailButton: { labelKey: 'msgTpl.ERROR_ALERT.cta', urlVariable: 'link' },
  },
  {
    key: 'ERROR_REGRESSION',
    purpose: 'TRANSACTIONAL',
    variables: ['firstName', 'title', 'source', 'release', 'resolvedInRelease', 'code', 'link'],
    whatsappName: 'error_regression',
    emailButton: { labelKey: 'msgTpl.ERROR_ALERT.cta', urlVariable: 'link' },
  },
  {
    key: 'ERROR_CRITICAL',
    purpose: 'TRANSACTIONAL',
    variables: ['firstName', 'title', 'source', 'release', 'code', 'route', 'count', 'link'],
    whatsappName: 'error_critical',
    emailButton: { labelKey: 'msgTpl.ERROR_ALERT.cta', urlVariable: 'link' },
  },
  {
    key: 'ERROR_DIGEST',
    purpose: 'TRANSACTIONAL',
    variables: ['firstName', 'events', 'newGroups', 'openGroups', 'regressions', 'topGroups', 'link'],
    whatsappName: 'error_digest',
    emailButton: { labelKey: 'msgTpl.ERROR_ALERT.cta', urlVariable: 'link' },
  },
  /** D2 backups (docs/YEDEKLER.md): email-only operational alert to super admins. */
  {
    key: 'BACKUP_STALE',
    purpose: 'TRANSACTIONAL',
    variables: ['firstName', 'hours', 'lastSuccessAt', 'threshold', 'link'],
    whatsappName: 'backup_stale',
    emailButton: { labelKey: 'msgTpl.BACKUP_STALE.cta', urlVariable: 'link' },
  },
  /**
   * M3b marketing approvals (docs/PAZARLAMA_MODULU.md 6.1): e-mail and
   * in-app notices to super admins (new request) and to the requester
   * (decision). Operational, so TRANSACTIONAL.
   */
  {
    key: 'MARKETING_APPROVAL_REQUESTED',
    purpose: 'TRANSACTIONAL',
    variables: ['firstName', 'requesterName', 'targetName', 'audience', 'reasons', 'link'],
    whatsappName: 'marketing_approval_requested',
    emailButton: { labelKey: 'msgTpl.MARKETING_APPROVAL.cta', urlVariable: 'link' },
  },
  {
    key: 'MARKETING_APPROVAL_APPROVED',
    purpose: 'TRANSACTIONAL',
    variables: ['firstName', 'targetName', 'deciderName', 'note', 'link'],
    whatsappName: 'marketing_approval_approved',
    emailButton: { labelKey: 'msgTpl.MARKETING_APPROVAL.cta', urlVariable: 'link' },
  },
  {
    key: 'MARKETING_APPROVAL_REJECTED',
    purpose: 'TRANSACTIONAL',
    variables: ['firstName', 'targetName', 'deciderName', 'note', 'link'],
    whatsappName: 'marketing_approval_rejected',
    emailButton: { labelKey: 'msgTpl.MARKETING_APPROVAL.cta', urlVariable: 'link' },
  },
];

export function builtinTemplate(key: string): BuiltinTemplateDefinition | null {
  return BUILTIN_TEMPLATES.find((t) => t.key === key) ?? null;
}

/** Content of one template variant as the engine uses it. */
export interface TemplateContent {
  body: string;
  subject: string | null;
  blocks: EmailBlock[] | null;
  whatsappTemplateName: string | null;
  isTransactional: boolean;
}

function message(locale: string, key: string): string | null {
  const catalogue = BUNDLED_MESSAGES[locale];
  if (!catalogue) return null;
  const value = catalogue[key];
  return typeof value === 'string' ? value : null;
}

/**
 * The built-in default for (key, channel, locale), or null when the key is
 * unknown or the locale has no bundled catalogue (only tr and en do).
 */
export function builtinTemplateContent(key: string, channel: TemplateChannel, locale: string): TemplateContent | null {
  const def = builtinTemplate(key);
  if (!def) return null;
  const body = message(locale, `msgTpl.${key}.text`);
  const subject = message(locale, `msgTpl.${key}.subject`);
  if (!body || !subject) return null;
  const isTransactional = def.purpose === 'TRANSACTIONAL';
  const blocks: EmailBlock[] | null =
    channel === 'EMAIL'
      ? [
          { type: 'heading', text: subject },
          { type: 'paragraph', text: body },
          ...(def.emailButton
            ? [{ type: 'button' as const, label: message(locale, def.emailButton.labelKey) ?? subject, url: `{${def.emailButton.urlVariable}}` }]
            : []),
        ]
      : null;
  return {
    body,
    subject: channel === 'EMAIL' || channel === 'PUSH' || channel === 'IN_APP' ? subject : null,
    blocks,
    whatsappTemplateName: channel === 'WHATSAPP' ? `${def.whatsappName}_${locale}` : null,
    isTransactional,
  };
}

/** The locales the built-in defaults ship in (seeded as global templates). */
export const BUILTIN_TEMPLATE_LOCALES = Object.keys(BUNDLED_MESSAGES);

/** Keys the Turkish catalogue must define for every built-in template (checked by the spec). */
export function builtinTemplateMessageKeys(): string[] {
  return BUILTIN_TEMPLATES.flatMap((t) => [
    `msgTpl.${t.key}.text`,
    `msgTpl.${t.key}.subject`,
    ...(t.emailButton ? [t.emailButton.labelKey] : []),
  ]);
}

// ---------------------------------------------------------------------------
// Tenant template editor (Mesaj şablonları)
// ---------------------------------------------------------------------------

export const TenantTemplateUpsertSchema = z
  .object({
    key: z.string().trim().regex(/^[A-Z][A-Z0-9_]{1,59}$/, 'Anahtar büyük harf, rakam ve alt çizgiden oluşmalıdır'),
    channel: z.enum(TEMPLATE_CHANNELS),
    locale: z.string().trim().regex(/^[a-z]{2}(-[A-Z]{2})?$/, 'Geçersiz dil kodu'),
    body: z.string().trim().min(1, 'Şablon metni boş olamaz').max(2000),
    subject: z.string().trim().min(1).max(200).nullable().optional(),
    blocks: EmailBlocksSchema.nullable().optional(),
    whatsappTemplateName: z.string().trim().max(120).nullable().optional(),
    isTransactional: z.boolean().default(true),
    isActive: z.boolean().default(true),
  })
  .strict()
  .refine((v) => v.channel !== 'WHATSAPP' || !!v.whatsappTemplateName, {
    message: 'WhatsApp şablonları için onaylı şablon adı zorunludur',
    path: ['whatsappTemplateName'],
  })
  .refine((v) => v.channel !== 'EMAIL' || !!v.subject, { message: 'E-posta şablonları için konu zorunludur', path: ['subject'] });
export type TenantTemplateUpsertInput = z.infer<typeof TenantTemplateUpsertSchema>;

export const TemplateListQuerySchema = z
  .object({
    key: z.string().trim().max(60).optional(),
    channel: z.enum(TEMPLATE_CHANNELS).optional(),
    locale: z.string().trim().max(10).optional(),
  })
  .strict();
export type TemplateListQuery = z.infer<typeof TemplateListQuerySchema>;

export type TemplateSource = 'TENANT' | 'GLOBAL' | 'BUILTIN';

export interface MessageTemplateDTO {
  id: string | null;
  key: string;
  channel: TemplateChannel;
  locale: string;
  source: TemplateSource;
  body: string;
  subject: string | null;
  blocks: EmailBlock[] | null;
  whatsappTemplateName: string | null;
  whatsappStatus: WhatsappTemplateStatus | null;
  isTransactional: boolean;
  isActive: boolean;
  variables: string[];
}

/** Studio brand for the email preview (the editor renders with emailBrandOf + renderEmail, like the engine). */
export interface TemplatePreviewBrandDTO {
  studioName: string;
  logoUrl: string | null;
  themeFamily: string;
  themePrimary: string;
  gradientPresetKey: string;
  address: string | null;
  defaultLocale: string;
}

export interface MessageTemplateListDTO {
  items: MessageTemplateDTO[];
  brand: TemplatePreviewBrandDTO;
}
