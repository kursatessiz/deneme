import { z } from 'zod';
import { CONVERSION_EVENT_TYPES } from './conversions';
import type { ConversionEventType } from './conversions';

/**
 * Ad platform connections, conversion delivery and spend sync (G2b). See
 * docs/BUYUME_VE_GLOBAL_MIMARI.md sections 3.3, 3.4 and docs/REKLAM_ENTEGRASYONU.md.
 */

/** Platforms a tenant can connect for server-side conversion delivery and spend sync. */
export const AD_CONNECTION_PLATFORMS = ['META', 'GOOGLE', 'TIKTOK'] as const;
export type AdConnectionPlatform = (typeof AD_CONNECTION_PLATFORMS)[number];

export const AD_CONNECTION_STATUSES = ['DISCONNECTED', 'CONNECTED', 'ERROR'] as const;
export type AdConnectionStatus = (typeof AD_CONNECTION_STATUSES)[number];

/** Pinned API versions: bump in one place when a platform deprecates the old one. */
export const META_GRAPH_API_VERSION = 'v21.0';
export const GOOGLE_ADS_API_VERSION = 'v17';
export const TIKTOK_EVENTS_API_VERSION = 'v1.3';

export const META_CAPI_HOST = 'graph.facebook.com';
export const GOOGLE_ADS_HOST = 'googleads.googleapis.com';
export const GOOGLE_OAUTH_HOST = 'oauth2.googleapis.com';
export const TIKTOK_EVENTS_HOST = 'business-api.tiktok.com';

/** The fixed set of outbound hosts every ad adapter is allowed to call (rule 7 security). */
export const AD_PLATFORM_ALLOWED_HOSTS: Readonly<Record<AdConnectionPlatform, readonly string[]>> = {
  META: [META_CAPI_HOST],
  GOOGLE: [GOOGLE_ADS_HOST, GOOGLE_OAUTH_HOST],
  TIKTOK: [TIKTOK_EVENTS_HOST],
};

const last4 = z.string().trim().min(1).max(4000);

/** Credential shapes per platform. Write-only: never echoed back by the API. */
export const MetaCredentialsSchema = z
  .object({
    accessToken: last4,
    pixelId: z.string().trim().min(1).max(60),
    /** For test-mode events, shown in Meta Events Manager's test events tab. */
    testEventCode: z.string().trim().max(40).optional(),
  })
  .strict();
export type MetaCredentials = z.infer<typeof MetaCredentialsSchema>;

export const GoogleCredentialsSchema = z
  .object({
    clientId: last4,
    clientSecret: last4,
    refreshToken: last4,
    developerToken: last4,
    loginCustomerId: z.string().trim().regex(/^\d{10}$/, '10 haneli müşteri kimliği bekleniyor'),
    customerId: z.string().trim().regex(/^\d{10}$/, '10 haneli müşteri kimliği bekleniyor'),
    /** Not a secret: the account's public "AW-XXXXXXXXX" tag id, needed to load the browser gtag on public pages (Consent Mode v2). */
    conversionId: z.string().trim().regex(/^AW-\d+$/, "AW-XXXXXXXXX biçiminde olmalı"),
  })
  .strict();
export type GoogleCredentials = z.infer<typeof GoogleCredentialsSchema>;

export const TikTokCredentialsSchema = z
  .object({
    accessToken: last4,
    pixelCode: z.string().trim().min(1).max(60),
  })
  .strict();
export type TikTokCredentials = z.infer<typeof TikTokCredentialsSchema>;

export type AdConnectionCredentials = MetaCredentials | GoogleCredentials | TikTokCredentials;

/** Maps ConversionEventType -> the platform's own conversion action id, where the platform needs one. */
export const ConversionActionMapSchema = z.record(z.enum(CONVERSION_EVENT_TYPES), z.string().trim().min(1).max(200));
export type ConversionActionMap = z.infer<typeof ConversionActionMapSchema>;

const credentialsByPlatform = (platform: AdConnectionPlatform) => {
  switch (platform) {
    case 'META':
      return MetaCredentialsSchema;
    case 'GOOGLE':
      return GoogleCredentialsSchema;
    case 'TIKTOK':
      return TikTokCredentialsSchema;
  }
};

export const CreateAdConnectionSchema = z
  .object({
    platform: z.enum(AD_CONNECTION_PLATFORMS),
    label: z.string().trim().min(1).max(80),
    externalAccountId: z.string().trim().min(1).max(80),
    credentials: z.record(z.string(), z.unknown()),
    conversionActionIds: ConversionActionMapSchema.optional(),
    isTestMode: z.boolean().default(false),
  })
  .strict()
  .superRefine((v, ctx) => {
    const schema = credentialsByPlatform(v.platform);
    const parsed = schema.safeParse(v.credentials);
    if (!parsed.success) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Bu platform için kimlik bilgileri eksik veya geçersiz', path: ['credentials'] });
    }
  });
export type CreateAdConnectionInput = z.infer<typeof CreateAdConnectionSchema>;

export const UpdateAdConnectionSchema = z
  .object({
    label: z.string().trim().min(1).max(80).optional(),
    externalAccountId: z.string().trim().min(1).max(80).optional(),
    credentials: z.record(z.string(), z.unknown()).optional(),
    conversionActionIds: ConversionActionMapSchema.optional(),
    isTestMode: z.boolean().optional(),
  })
  .strict();
export type UpdateAdConnectionInput = z.infer<typeof UpdateAdConnectionSchema>;

/** Never carries secrets: at most the last 4 characters of the primary token. */
export interface AdConnectionDTO {
  id: string;
  platform: AdConnectionPlatform;
  label: string;
  status: AdConnectionStatus;
  externalAccountId: string;
  pixelOrDatasetId: string | null;
  conversionActionIds: Partial<Record<ConversionEventType, string>>;
  isTestMode: boolean;
  credentialLast4: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export function validateCredentialsFor(platform: AdConnectionPlatform, credentials: unknown) {
  return credentialsByPlatform(platform).safeParse(credentials);
}

/** Last 4 characters of the credential that identifies the connection (access/refresh token), for display only. */
export function credentialLast4Of(platform: AdConnectionPlatform, credentials: AdConnectionCredentials): string {
  const token = platform === 'GOOGLE' ? (credentials as GoogleCredentials).refreshToken : (credentials as MetaCredentials | TikTokCredentials).accessToken;
  return token.slice(-4);
}

// ---------------------------------------------------------------------------
// Ad structure and spend sync (section 3.4)
// ---------------------------------------------------------------------------

export const AD_ENTITY_LEVELS = ['CAMPAIGN', 'ADSET', 'AD'] as const;
export type AdEntityLevel = (typeof AD_ENTITY_LEVELS)[number];

export interface AdEntityDTO {
  id: string;
  platform: AdConnectionPlatform;
  level: AdEntityLevel;
  externalId: string;
  name: string;
  status: string;
  parentExternalId: string | null;
  updatedAt: string;
}

export const AdSpendSyncQuerySchema = z
  .object({
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
  })
  .strict();
export type AdSpendSyncQuery = z.infer<typeof AdSpendSyncQuerySchema>;

// ---------------------------------------------------------------------------
// UTM builder (section 4)
// ---------------------------------------------------------------------------

export const UtmBuilderInputSchema = z
  .object({
    market: z.string().trim().min(2).max(2),
    language: z.string().trim().min(2).max(3),
    sector: z.string().trim().min(1).max(40),
    objective: z.string().trim().min(1).max(20),
    yearMonth: z.string().trim().regex(/^\d{6}$/),
    platform: z.enum(['META', 'GOOGLE', 'TIKTOK']),
    /** Path segment(s) after the landing page host, e.g. "tr/pilates" or "<slug>/book". */
    landingPath: z.string().trim().min(1).max(200),
  })
  .strict();
export type UtmBuilderInput = z.infer<typeof UtmBuilderInputSchema>;

export interface UtmBuilderResultDTO {
  campaignName: string;
  urlParams: string;
  exampleUrl: string;
}

// ---------------------------------------------------------------------------
// Report math: CPL, CAC, ROAS (section 3.4)
// ---------------------------------------------------------------------------

/**
 * Cost per lead: spend divided by the number of `lead` conversions credited
 * to the same report key. Null when there is no spend or no lead.
 */
export function computeCpl(spend: number, leadConversions: number): number | null {
  if (!(spend > 0) || !(leadConversions > 0)) return null;
  return spend / leadConversions;
}

/**
 * Customer acquisition cost: spend divided by the number of conversions
 * that represent a newly paying customer (`purchase` + `subscription_started`
 * credited to this key; renewals are excluded since they are not a new
 * acquisition).
 */
export function computeCac(spend: number, acquiredCustomers: number): number | null {
  if (!(spend > 0) || !(acquiredCustomers > 0)) return null;
  return spend / acquiredCustomers;
}

/** Return on ad spend: revenue divided by spend, in the same currency. Null without spend. */
export function computeRoas(revenue: number, spend: number): number | null {
  if (!(spend > 0)) return null;
  return revenue / spend;
}

/** Conversion types counted as a new paying customer for CAC (see computeCac). */
export const CAC_ACQUISITION_EVENT_TYPES: readonly ConversionEventType[] = ['purchase', 'subscription_started', 'studio_paid'];
