import { z } from 'zod';
import { vmsg } from './validation-key';
import { BASE_MESSAGES } from './i18n/messages';
import { createTranslator } from './i18n/translator';
import type { Translate } from './i18n/translator';

const BASE_TRANSLATE: Translate = createTranslator({ locale: 'tr', messages: BASE_MESSAGES, fallback: BASE_MESSAGES });

/**
 * Notification categories a user can control under "Hesabım > Bildirim
 * ayarları". Security messages (login codes, invites) are not in this
 * list: they are always delivered and cannot be turned off.
 */
export const NOTIFICATION_CHANNELS = ['push', 'sms'] as const;
export type NotificationPreferenceChannel = (typeof NOTIFICATION_CHANNELS)[number];

/** Label and description of a category are the `apiTexts.notifCategory.<KEY>.label|description` messages. */
export interface NotificationCategoryDefinition {
  defaults: Record<NotificationPreferenceChannel, boolean>;
  /** Commercial messages need explicit opt-in (ETK / IYS); default off. */
  marketing: boolean;
  /** Shown only to users who hold a trainer profile somewhere. */
  staffOnly: boolean;
}

export const NOTIFICATION_CATEGORIES = {
  BOOKING_REMINDER: {
    defaults: { push: true, sms: false },
    marketing: false,
    staffOnly: false,
  },
  BOOKING_CHANGE: {
    defaults: { push: true, sms: true },
    marketing: false,
    staffOnly: false,
  },
  WAITLIST: {
    defaults: { push: true, sms: true },
    marketing: false,
    staffOnly: false,
  },
  PACKAGE: {
    defaults: { push: true, sms: false },
    marketing: false,
    staffOnly: false,
  },
  TRAINER_SCHEDULE: {
    defaults: { push: true, sms: false },
    marketing: false,
    staffOnly: true,
  },
  MARKETING: {
    defaults: { push: false, sms: false },
    marketing: true,
    staffOnly: false,
  },
  ACHIEVEMENT: {
    defaults: { push: true, sms: false },
    marketing: false,
    staffOnly: false,
  },
  FEEDBACK: {
    defaults: { push: true, sms: false },
    marketing: false,
    staffOnly: true,
  },
} as const satisfies Record<string, NotificationCategoryDefinition>;

export type NotificationCategory = keyof typeof NOTIFICATION_CATEGORIES;
export const NOTIFICATION_CATEGORY_KEYS = Object.keys(NOTIFICATION_CATEGORIES) as NotificationCategory[];

const ChannelTogglesSchema = z.object({ push: z.boolean(), sms: z.boolean() }).strict();

export const NotificationPreferencesSchema = z
  .record(z.enum(NOTIFICATION_CATEGORY_KEYS as [NotificationCategory, ...NotificationCategory[]]), ChannelTogglesSchema)
  .refine((v) => Object.keys(v).length > 0, vmsg('validation.leastOneCategorySent'));

/** PUT body: any subset of categories; missing ones keep their value. */
export const UpdateNotificationPreferencesSchema = z.object({ preferences: NotificationPreferencesSchema }).strict();
export type UpdateNotificationPreferencesInput = z.infer<typeof UpdateNotificationPreferencesSchema>;

export interface NotificationPreferenceItemDTO {
  category: NotificationCategory;
  label: string;
  description: string;
  marketing: boolean;
  push: boolean;
  sms: boolean;
}

export interface NotificationPreferencesDTO {
  items: NotificationPreferenceItemDTO[];
}

export const RegisterPushDeviceSchema = z
  .object({
    /** Expo push token: ExponentPushToken[...] */
    token: z.string().regex(/^Expo(nent)?PushToken\[[A-Za-z0-9_-]{10,200}\]$/, vmsg('validation.invalidPushToken')),
    platform: z.enum(['ios', 'android']),
    deviceName: z.string().max(100).optional(),
  })
  .strict();
export type RegisterPushDeviceInput = z.infer<typeof RegisterPushDeviceSchema>;

/** Effective settings: stored overrides on top of the category defaults. */
export function resolveNotificationPreferences(
  stored: { category: string; push: boolean; sms: boolean }[],
  options: { includeStaff: boolean },
  t: Translate = BASE_TRANSLATE,
): NotificationPreferenceItemDTO[] {
  return NOTIFICATION_CATEGORY_KEYS.filter((key) => options.includeStaff || !NOTIFICATION_CATEGORIES[key].staffOnly).map(
    (key) => {
      const def: NotificationCategoryDefinition = NOTIFICATION_CATEGORIES[key];
      const row = stored.find((s) => s.category === key);
      return {
        category: key,
        label: t(`apiTexts.notifCategory.${key}.label`),
        description: t(`apiTexts.notifCategory.${key}.description`),
        marketing: def.marketing,
        push: row ? row.push : def.defaults.push,
        sms: row ? row.sms : def.defaults.sms,
      };
    },
  );
}
