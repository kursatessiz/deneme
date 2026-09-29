import { z } from 'zod';
import { LocaleCodeSchema } from '../i18n/locales';

/**
 * Brand kit and product facts of the platform tenant (docs/PAZARLAMA_MODULU.md
 * 4.2 and 7.3). The kit is what the AI studio stays within: per-locale voice
 * and banned phrases, short verified product facts, audience descriptions,
 * links and the default sender identity per channel. Served by
 * `/platform/marketing/brand-kit` (permission platform.brand.manage to edit,
 * platform.marketing.view to read).
 */

/** Channels a sender identity and a required disclaimer are defined for. */
export const BRAND_CHANNELS = ['EMAIL', 'SMS', 'WHATSAPP'] as const;
export type BrandChannel = (typeof BRAND_CHANNELS)[number];
export const BrandChannelSchema = z.enum(BRAND_CHANNELS);

export const BRAND_MAX_LOCALES = 10;
export const BRAND_MAX_FACTS = 200;

const ShortText = (max: number) => z.string().trim().min(1).max(max);
const HttpsUrl = z
  .string()
  .trim()
  .url()
  .max(300)
  .refine((v) => /^https:\/\//i.test(v), 'Bağlantı https ile başlamalı');
const PhraseList = (maxItems: number, maxLength: number) =>
  z
    .array(ShortText(maxLength))
    .max(maxItems)
    .transform((items) => [...new Set(items)]);

export const BrandLinksSchema = z
  .object({
    website: HttpsUrl.nullable().optional(),
    linkedin: HttpsUrl.nullable().optional(),
    instagram: HttpsUrl.nullable().optional(),
    facebook: HttpsUrl.nullable().optional(),
    x: HttpsUrl.nullable().optional(),
    youtube: HttpsUrl.nullable().optional(),
  })
  .strict();
export type BrandLinks = z.infer<typeof BrandLinksSchema>;

/** Default sender identity of one channel: a display name plus the address, sender id or number it goes out from. */
export const SenderIdentitySchema = z
  .object({
    displayName: z.string().trim().max(80).optional(),
    /** E-mail address (EMAIL), alphanumeric sender id (SMS) or business number (WHATSAPP). */
    address: z.string().trim().max(254).optional(),
    replyTo: z.string().trim().email().max(254).optional(),
  })
  .strict();
export type SenderIdentity = z.infer<typeof SenderIdentitySchema>;

export const SenderIdentitiesSchema = z
  .object({
    EMAIL: SenderIdentitySchema.optional(),
    SMS: SenderIdentitySchema.optional(),
    WHATSAPP: SenderIdentitySchema.optional(),
  })
  .strict();
export type SenderIdentities = z.infer<typeof SenderIdentitiesSchema>;

export const IcpSchema = z
  .object({
    key: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9_]{1,39}$/, 'Anahtar küçük harf, rakam ve alt çizgiden oluşmalı'),
    name: ShortText(80),
    description: z.string().trim().max(600).default(''),
  })
  .strict();
export type Icp = z.infer<typeof IcpSchema>;

export const RequiredDisclaimersSchema = z
  .object({
    EMAIL: z.string().trim().max(300).optional(),
    SMS: z.string().trim().max(160).optional(),
    WHATSAPP: z.string().trim().max(300).optional(),
  })
  .strict();
export type RequiredDisclaimers = z.infer<typeof RequiredDisclaimersSchema>;

export const BrandKitLocaleInputSchema = z
  .object({
    locale: LocaleCodeSchema,
    toneNotes: z.string().trim().max(2000).default(''),
    doList: PhraseList(20, 200).default([]),
    dontList: PhraseList(20, 200).default([]),
    bannedPhrases: PhraseList(50, 80).default([]),
    requiredDisclaimers: RequiredDisclaimersSchema.default({}),
  })
  .strict();
export type BrandKitLocaleInput = z.infer<typeof BrandKitLocaleInputSchema>;

/** PUT /platform/marketing/brand-kit: replaces the kit and its locale rows. */
export const UpsertBrandKitSchema = z
  .object({
    brandName: ShortText(80),
    positioning: z.string().trim().max(400).default(''),
    defaultLocale: LocaleCodeSchema,
    links: BrandLinksSchema.default({}),
    senderIdentities: SenderIdentitiesSchema.default({}),
    icps: z.array(IcpSchema).max(10).default([]),
    locales: z.array(BrandKitLocaleInputSchema).min(1).max(BRAND_MAX_LOCALES),
  })
  .strict()
  .refine((v) => new Set(v.locales.map((l) => l.locale)).size === v.locales.length, { message: 'Aynı dil iki kez girilemez', path: ['locales'] })
  .refine((v) => new Set(v.icps.map((i) => i.key)).size === v.icps.length, { message: 'Hedef kitle anahtarları benzersiz olmalı', path: ['icps'] })
  .refine((v) => v.locales.some((l) => l.locale === v.defaultLocale), { message: 'Varsayılan dil için üslup satırı gerekli', path: ['defaultLocale'] });
export type UpsertBrandKitInput = z.infer<typeof UpsertBrandKitSchema>;

const FACT_KEY = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9_.]{1,59}$/, 'Anahtar küçük harf, rakam, nokta ve alt çizgiden oluşmalı');

export const ProductFactInputSchema = z
  .object({
    key: FACT_KEY,
    category: z.string().trim().min(1).max(40).default('general'),
    /** Locale code to the statement in that language; at least one language. */
    statements: z
      .record(LocaleCodeSchema, ShortText(300))
      .refine((v) => Object.keys(v).length >= 1 && Object.keys(v).length <= BRAND_MAX_LOCALES, 'En az bir dilde ifade gerekli'),
    sourceUrl: HttpsUrl.nullable().optional(),
    /** ISO date (YYYY-MM-DD); an expired fact is left out of the prompt. */
    validUntil: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .optional(),
    isActive: z.boolean().default(true),
  })
  .strict();
export type ProductFactInput = z.infer<typeof ProductFactInputSchema>;

export const UpdateProductFactSchema = ProductFactInputSchema.partial().strict();
export type UpdateProductFactInput = z.infer<typeof UpdateProductFactSchema>;

export interface BrandKitLocaleDTO {
  locale: string;
  toneNotes: string;
  doList: string[];
  dontList: string[];
  bannedPhrases: string[];
  requiredDisclaimers: RequiredDisclaimers;
}

export interface ProductFactDTO {
  id: string;
  key: string;
  category: string;
  statements: Record<string, string>;
  sourceUrl: string | null;
  validUntil: string | null;
  isActive: boolean;
  updatedAt: string;
}

export interface BrandKitDTO {
  id: string;
  /** Increases on every save; the AI prompt cache is keyed by it. */
  version: number;
  brandName: string;
  positioning: string;
  defaultLocale: string;
  links: BrandLinks;
  senderIdentities: SenderIdentities;
  icps: Icp[];
  locales: BrandKitLocaleDTO[];
  updatedByUserId: string | null;
  updatedAt: string;
}

/** GET /platform/marketing/brand-kit; `kit` is null until the first save. */
export interface BrandKitViewDTO {
  kit: BrandKitDTO | null;
  facts: ProductFactDTO[];
  canEdit: boolean;
}

/** True when the fact may be used in a prompt today (active and not expired). */
export function isFactUsable(fact: { isActive: boolean; validUntil: string | null }, today: string): boolean {
  return fact.isActive && (fact.validUntil === null || fact.validUntil >= today);
}
