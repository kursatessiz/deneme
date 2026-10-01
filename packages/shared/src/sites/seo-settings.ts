import { z } from 'zod';

/**
 * Per-site search settings (S3, docs/SEO.md). Stored in `Site.seoSettings` (JSON) so a new setting needs no
 * migration; the platform site is a Site like any other, so these are also the platform's settings.
 */

/**
 * A Search Console `google-site-verification` or Bing `msvalidate.01` token: letters, digits, dash and
 * underscore only, so it can never carry markup into the meta tag. An empty string clears the value.
 */
export const SearchVerificationTokenSchema = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
  z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]{8,100}$/, 'Doğrulama kodu 8-100 karakter olmalı; yalnızca harf, rakam, tire ve alt çizgi')
    .nullable(),
);

/** IndexNow key (generated per site on first use): 32 lowercase hex characters, served at `/<key>.txt`. */
export const INDEXNOW_KEY_PATTERN = /^[a-f0-9]{32}$/;

/** Feature flag that turns IndexNow notifications on for a tenant (default off). */
export const SEO_INDEXNOW_FLAG = 'seo.indexnow';

export interface SiteSeoSettings {
  googleSiteVerification: string | null;
  bingSiteVerification: string | null;
  /** Generated on first IndexNow use; never edited by hand. */
  indexNowKey: string | null;
}

export const DEFAULT_SITE_SEO_SETTINGS: SiteSeoSettings = {
  googleSiteVerification: null,
  bingSiteVerification: null,
  indexNowKey: null,
};

/** What an owner or the super admin may change; omitted fields keep their stored value. */
export const UpdateSiteSeoSettingsSchema = z
  .object({
    googleSiteVerification: SearchVerificationTokenSchema.optional(),
    bingSiteVerification: SearchVerificationTokenSchema.optional(),
  })
  .strict();
export type UpdateSiteSeoSettingsInput = z.infer<typeof UpdateSiteSeoSettingsSchema>;

const TokenOrNull = z.string().regex(/^[A-Za-z0-9_-]{8,100}$/).nullable().catch(null);
const IndexNowKeyOrNull = z.string().regex(INDEXNOW_KEY_PATTERN).nullable().catch(null);

/** Reads the stored JSON; a missing, malformed or hand-edited value falls back to the default for that field only. */
export function parseSiteSeoSettings(raw: unknown): SiteSeoSettings {
  const source = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return {
    googleSiteVerification: TokenOrNull.parse(source.googleSiteVerification ?? null),
    bingSiteVerification: TokenOrNull.parse(source.bingSiteVerification ?? null),
    indexNowKey: IndexNowKeyOrNull.parse(source.indexNowKey ?? null),
  };
}

/** The stored JSON after applying an update: only the given fields change. */
export function mergeSiteSeoSettings(current: SiteSeoSettings, update: UpdateSiteSeoSettingsInput): SiteSeoSettings {
  return {
    ...current,
    ...(update.googleSiteVerification !== undefined ? { googleSiteVerification: update.googleSiteVerification } : {}),
    ...(update.bingSiteVerification !== undefined ? { bingSiteVerification: update.bingSiteVerification } : {}),
  };
}
