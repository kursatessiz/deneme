import { z } from 'zod';

/**
 * Notification categories a user can control under "Hesabım > Bildirim
 * ayarları". Security messages (login codes, invites) are not in this
 * list: they are always delivered and cannot be turned off.
 */
export const NOTIFICATION_CHANNELS = ['push', 'sms'] as const;
export type NotificationPreferenceChannel = (typeof NOTIFICATION_CHANNELS)[number];

export interface NotificationCategoryDefinition {
  label: string;
  description: string;
  defaults: Record<NotificationPreferenceChannel, boolean>;
  /** Commercial messages need explicit opt-in (ETK / IYS); default off. */
  marketing: boolean;
  /** Shown only to users who hold a trainer profile somewhere. */
  staffOnly: boolean;
}

export const NOTIFICATION_CATEGORIES = {
  BOOKING_REMINDER: {
    label: 'Seans hatırlatmaları',
    description: 'Rezervasyonunuz yaklaşırken hatırlatma',
    defaults: { push: true, sms: false },
    marketing: false,
    staffOnly: false,
  },
  BOOKING_CHANGE: {
    label: 'Rezervasyon değişiklikleri',
    description: 'Seans iptali, saat veya eğitmen değişikliği',
    defaults: { push: true, sms: true },
    marketing: false,
    staffOnly: false,
  },
  WAITLIST: {
    label: 'Bekleme listesi',
    description: 'Bekleme listesinden yer açıldığında',
    defaults: { push: true, sms: true },
    marketing: false,
    staffOnly: false,
  },
  PACKAGE: {
    label: 'Paket ve üyelik',
    description: 'Paket bitişi, kalan hak ve dondurma bildirimleri',
    defaults: { push: true, sms: false },
    marketing: false,
    staffOnly: false,
  },
  TRAINER_SCHEDULE: {
    label: 'Ders programım',
    description: 'Size atanan veya değişen dersler (eğitmenler için)',
    defaults: { push: true, sms: false },
    marketing: false,
    staffOnly: true,
  },
  MARKETING: {
    label: 'Kampanya ve duyurular',
    description: 'İşletmelerin kampanya ve duyuruları (açık rıza gerekir)',
    defaults: { push: false, sms: false },
    marketing: true,
    staffOnly: false,
  },
  FEEDBACK: {
    label: 'Üye geri bildirimleri',
    description: 'Düşük puanlı seans değerlendirmeleri (işletme sahibi ve yöneticiler için)',
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
  .refine((v) => Object.keys(v).length > 0, 'En az bir kategori gönderilmeli');

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
    token: z.string().regex(/^Expo(nent)?PushToken\[[A-Za-z0-9_-]{10,200}\]$/, 'Geçersiz push token'),
    platform: z.enum(['ios', 'android']),
    deviceName: z.string().max(100).optional(),
  })
  .strict();
export type RegisterPushDeviceInput = z.infer<typeof RegisterPushDeviceSchema>;

/** Effective settings: stored overrides on top of the category defaults. */
export function resolveNotificationPreferences(
  stored: { category: string; push: boolean; sms: boolean }[],
  options: { includeStaff: boolean },
): NotificationPreferenceItemDTO[] {
  return NOTIFICATION_CATEGORY_KEYS.filter((key) => options.includeStaff || !NOTIFICATION_CATEGORIES[key].staffOnly).map(
    (key) => {
      const def: NotificationCategoryDefinition = NOTIFICATION_CATEGORIES[key];
      const row = stored.find((s) => s.category === key);
      return {
        category: key,
        label: def.label,
        description: def.description,
        marketing: def.marketing,
        push: row ? row.push : def.defaults.push,
        sms: row ? row.sms : def.defaults.sms,
      };
    },
  );
}
