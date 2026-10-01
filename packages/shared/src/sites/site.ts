import { z } from 'zod';

/**
 * Page engine core contracts (docs/SAYFA_MOTORU.md). `Site` -> `Page` ->
 * `Block`, with immutable `PageVersion` snapshots for rollback. The platform
 * tenant has one PLATFORM site; every other tenant may create one TENANT
 * site through the same engine.
 */

export const SITE_KINDS = ['PLATFORM', 'TENANT'] as const;
export type SiteKind = (typeof SITE_KINDS)[number];

export const PAGE_KINDS = ['HOME', 'LANDING', 'CORPORATE', 'LEGAL', 'CUSTOM'] as const;
export type PageKind = (typeof PAGE_KINDS)[number];

export const PAGE_STATUSES = ['DRAFT', 'PUBLISHED'] as const;
export type PageStatus = (typeof PAGE_STATUSES)[number];

export const DOMAIN_VERIFICATION_STATUSES = ['PENDING', 'VERIFIED', 'FAILED'] as const;
export type DomainVerificationStatus = (typeof DOMAIN_VERIFICATION_STATUSES)[number];

const Slug = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(160)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*(\/[a-z0-9]+(-[a-z0-9]+)*)*$/, 'Geçersiz yol (slug)');
const LocaleCode = z.string().trim().min(2).max(10);

// ---------------------------------------------------------------------------
export const UpdateSiteSchema = z
  .object({
    defaultLocale: LocaleCode.optional(),
    enabledLocales: z.array(LocaleCode).min(1).max(20).optional(),
    primaryDomain: z.string().trim().max(190).optional().nullable(),
  })
  .strict();
export type UpdateSiteInput = z.infer<typeof UpdateSiteSchema>;

export const AddSiteDomainSchema = z.object({
  domain: z
    .string()
    .trim()
    .toLowerCase()
    .max(190)
    .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/, 'Geçersiz alan adı'),
});
export type AddSiteDomainInput = z.infer<typeof AddSiteDomainSchema>;

// ---------------------------------------------------------------------------
export const CreatePageSchema = z.object({
  kind: z.enum(PAGE_KINDS),
  sectorKey: z.string().trim().max(60).optional().nullable(),
  offerKey: z.string().trim().max(60).optional().nullable(),
  internalLabel: z.string().trim().min(1).max(150),
});
export type CreatePageInput = z.infer<typeof CreatePageSchema>;

export const UpsertPageLocaleSchema = z.object({
  slug: Slug,
  seoTitle: z.string().trim().max(200).optional().nullable(),
  seoDescription: z.string().trim().max(400).optional().nullable(),
  ogImageUrl: z.string().trim().url().max(2000).optional().nullable(),
});
export type UpsertPageLocaleInput = z.infer<typeof UpsertPageLocaleSchema>;

export const ApproveLegalSchema = z.object({ approved: z.boolean() });
export type ApproveLegalInput = z.infer<typeof ApproveLegalSchema>;

export const UpsertBlockSchema = z.object({
  type: z.string().trim().max(40),
  position: z.number().int().min(0),
  abVariantKey: z.string().trim().max(40).optional().nullable(),
  data: z.unknown(),
});
export type UpsertBlockInput = z.infer<typeof UpsertBlockSchema>;

export const ReorderBlocksSchema = z.object({ blockIds: z.array(z.string().uuid()).min(1) });
export type ReorderBlocksInput = z.infer<typeof ReorderBlocksSchema>;

// ---------------------------------------------------------------------------
export const CreateSectorLandingWizardSchema = z.object({
  sectorKey: z.string().trim().min(1).max(60),
  offerKey: z.string().trim().max(60).optional().nullable(),
  locales: z.array(LocaleCode).min(1).max(20),
});
export type CreateSectorLandingWizardInput = z.infer<typeof CreateSectorLandingWizardSchema>;

// ---------------------------------------------------------------------------
export const UpdateCompanyInfoSchema = z.object({
  legalName: z.string().trim().min(1).max(200),
  address: z.string().trim().max(1000).optional().nullable(),
  tradeRegistryNo: z.string().trim().max(60).optional().nullable(),
  mersisNo: z.string().trim().max(60).optional().nullable(),
  taxOffice: z.string().trim().max(100).optional().nullable(),
  taxNumber: z.string().trim().max(30).optional().nullable(),
  email: z.string().trim().email().max(120).optional().nullable(),
  phone: z.string().trim().max(30).optional().nullable(),
  socialLinks: z.record(z.string().max(40), z.string().trim().url().max(500)).default({}),
});
export type UpdateCompanyInfoInput = z.infer<typeof UpdateCompanyInfoSchema>;

// ---------------------------------------------------------------------------
// DTOs (API responses)
// ---------------------------------------------------------------------------
export interface PageLocaleDTO {
  locale: string;
  slug: string;
  seoTitle: string | null;
  seoDescription: string | null;
  ogImageUrl: string | null;
  legalApproved: boolean;
  legalApprovedAt: string | null;
}

export interface PageSummaryDTO {
  id: string;
  kind: PageKind;
  sectorKey: string | null;
  offerKey: string | null;
  internalLabel: string;
  status: PageStatus;
  publishedAt: string | null;
  locales: PageLocaleDTO[];
}

export interface PageVersionSummaryDTO {
  id: string;
  version: number;
  publishedAt: string;
  publishedByName: string | null;
}

export interface SiteDomainDTO {
  id: string;
  domain: string;
  status: DomainVerificationStatus;
  verificationToken: string;
  verifiedAt: string | null;
}

export interface SiteDTO {
  id: string;
  kind: SiteKind;
  primaryDomain: string | null;
  defaultLocale: string;
  enabledLocales: string[];
  domains: SiteDomainDTO[];
}

// ---------------------------------------------------------------------------
// Locale fallback (shared by web rendering and unit tests)
// ---------------------------------------------------------------------------

/**
 * Which locale to render a page in, given the site's enabled/default locales
 * and the locales the page actually has content for. Returns null when
 * nothing can be served (page has no locale variant at all in this set).
 */
export function resolvePageLocale(requested: string, availableLocales: readonly string[], siteDefaultLocale: string): string | null {
  if (availableLocales.includes(requested)) return requested;
  return null; // an unpublished/unknown locale for this page is a 404, not a fallback (docs/SAYFA_MOTORU.md)
}

export interface PublicPageContext {
  plans?: Array<{ key: string; name: string; priceMonthly: string; currency: string; limits: unknown }>;
  packages?: Array<{ id: string; name: string; price: string; currency: string }>;
  businessTypes?: Array<{ key: string; name: string; vocabulary: Record<string, string> }>;
  companyInfo?: { legalName: string; address: string | null; email: string | null; phone: string | null; socialLinks: Record<string, string> };
  studioContact?: { name: string; address: string | null; email: string | null; phone: string | null };
}

/** What GET /public/sites/:slug/pages returns: everything the web app needs to render one page. */
export interface PublicPageDTO {
  siteKind: SiteKind;
  studioSlug: string;
  defaultLocale: string;
  enabledLocales: string[];
  locale: string;
  page: { kind: PageKind; sectorKey: string | null; offerKey: string | null };
  localeMeta: PageLocaleDTO;
  allLocales: PageLocaleDTO[];
  blocks: import('./blocks').BlockDTO[];
  context: PublicPageContext;
  /** The platform's default theme for the platform site, the tenant's own brand theme for a tenant site (CLAUDE.md rule 10). */
  theme: import('../design').TenantThemeView;
}

export interface SitemapPageEntry {
  pageId: string;
  locale: string;
  slug: string;
  updatedAt: string;
}

/** What GET /public/sites/:slug/sitemap-entries returns. `defaultLocale` is null when the site does not exist. */
export interface SitemapResponseDTO {
  items: SitemapPageEntry[];
  defaultLocale: string | null;
}

/** hreflang value for the fallback variant (docs/SEO.md). */
export const HREFLANG_X_DEFAULT = 'x-default';

/**
 * hreflang alternates: only locales that actually have a published variant of the page.
 * With `defaultLocale`, `x-default` points at that locale's variant, or at the first
 * available variant when the page has none in the site default locale. `xDefaultUrl`
 * overrides that: the platform home page points x-default at the origin root, which
 * redirects to the visitor's locale (docs/SEO.md).
 */
export function buildHreflangAlternates<T extends { locale: string; slug: string }>(
  pageLocales: readonly T[],
  basePath: (locale: string, slug: string) => string,
  defaultLocale?: string | null,
  xDefaultUrl?: string | null,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pl of pageLocales) out[pl.locale] = basePath(pl.locale, pl.slug);
  if (xDefaultUrl && pageLocales.length > 0) {
    // An explicit x-default (the origin root, which negotiates the locale) wins over the default locale variant.
    out[HREFLANG_X_DEFAULT] = xDefaultUrl;
  } else if (defaultLocale !== undefined && pageLocales.length > 0) {
    const fallback = pageLocales.find((pl) => pl.locale === defaultLocale) ?? pageLocales[0];
    out[HREFLANG_X_DEFAULT] = basePath(fallback.locale, fallback.slug);
  }
  return out;
}
