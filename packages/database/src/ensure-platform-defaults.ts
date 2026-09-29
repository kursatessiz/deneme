import { Prisma } from '@prisma/client';
import type { BadgeKind as PrismaBadgeKind, DocumentType } from '@prisma/client';
import { DEFAULT_PIPELINE_STAGES } from '@platform/shared';
import {
  BUSINESS_TYPE_TEMPLATE_DEFAULTS,
  GLOBAL_BADGE_DEFAULTS,
  GLOBAL_DOCUMENT_DEFAULTS,
  PLAN_DEFAULTS,
  PLATFORM_HOME_PAGE_DEFAULT,
  PLATFORM_SITE_DEFAULTS,
  PLATFORM_TENANT_DEFAULTS,
  SMS_PACKAGE_DEFAULTS,
  createPublishedPage,
  globalMessageTemplateRows,
  planPriceRows,
} from './platform-defaults';
import type { PlatformDefaultsDb } from './platform-defaults';

/**
 * Idempotent writers for the platform defaults in ./platform-defaults.ts.
 * Every step matches existing rows by natural key and only creates what is
 * missing; nothing is ever updated or deleted, so edits the super admin
 * made later (prices, texts, newer document versions) always survive a
 * re-run.
 */

export interface CatalogDefaultsResult {
  businessTypeTemplateIds: Record<string, string>;
  planIds: Record<string, string>;
  documentIds: Partial<Record<DocumentType, string>>;
}

export interface PlatformTenantResult {
  platformStudioId: string;
  platformSiteId: string;
}

export interface PlatformDefaultsResult extends CatalogDefaultsResult, PlatformTenantResult {
  /** Rows created by this run, per table. Empty on a re-run. */
  created: Record<string, number>;
}

/** Records how many rows of a table a run created. */
export type CreatedCounter = (table: string, n?: number) => void;

const noCount: CreatedCounter = () => undefined;

/** Platform catalogue rows (no tenant): business types, plans, SMS packages, documents, message templates, badges. */
export async function ensureCatalogDefaults(db: PlatformDefaultsDb, bump: CreatedCounter = noCount): Promise<CatalogDefaultsResult> {
  const businessTypeTemplateIds: Record<string, string> = {};
  for (const t of BUSINESS_TYPE_TEMPLATE_DEFAULTS) {
    const existing = await db.businessTypeTemplate.findUnique({ where: { key: t.key }, select: { id: true } });
    if (existing) {
      businessTypeTemplateIds[t.key] = existing.id;
      continue;
    }
    const row = await db.businessTypeTemplate.create({
      data: { key: t.key, name: t.name, vocabulary: t.vocabulary, defaults: t.defaults, enabledModules: t.enabledModules },
    });
    businessTypeTemplateIds[t.key] = row.id;
    bump('business_type_templates');
  }

  const planIds: Record<string, string> = {};
  for (const p of PLAN_DEFAULTS) {
    const existing = await db.plan.findUnique({ where: { key: p.key }, select: { id: true } });
    if (existing) {
      planIds[p.key] = existing.id;
      continue;
    }
    // Prices are written only together with a new plan: a currency the super
    // admin removed from an existing plan later is never brought back.
    const { rows, mirror } = planPriceRows(p);
    const row = await db.plan.create({
      data: {
        key: p.key,
        name: p.name,
        priceMonthly: mirror.priceMonthly,
        currency: mirror.currency,
        trialDays: p.trialDays,
        limits: p.limits,
        prices: { create: rows },
      },
    });
    planIds[p.key] = row.id;
    bump('plans');
    bump('plan_prices', rows.length);
  }

  for (const p of SMS_PACKAGE_DEFAULTS) {
    const existing = await db.smsPackage.findUnique({ where: { key: p.key }, select: { id: true } });
    if (existing) continue;
    await db.smsPackage.create({ data: p });
    bump('sms_packages');
  }

  // One global document per type: once any version exists the super admin
  // owns it (a newer version is never overwritten by a default).
  const documentIds: Partial<Record<DocumentType, string>> = {};
  for (const d of GLOBAL_DOCUMENT_DEFAULTS) {
    const existing = await db.documentVersion.findFirst({
      where: { studioId: null, type: d.type },
      orderBy: { version: 'asc' },
      select: { id: true },
    });
    if (existing) {
      documentIds[d.type] = existing.id;
      continue;
    }
    const row = await db.documentVersion.create({
      data: { studioId: null, type: d.type, version: 1, title: d.title, body: d.body, publishedAt: new Date() },
    });
    documentIds[d.type] = row.id;
    bump('document_versions');
  }

  // Unique (studio_id, key, channel, locale) NULLS NOT DISTINCT: existing
  // rows are skipped, built-in templates added by a later release are added.
  const templates = await db.messageTemplate.createMany({ data: globalMessageTemplateRows(), skipDuplicates: true });
  if (templates.count > 0) bump('message_templates', templates.count);

  for (const badge of GLOBAL_BADGE_DEFAULTS) {
    // (studio_id, key) is unique but NULLs are distinct there, so look up first.
    const existing = await db.badgeDefinition.findFirst({ where: { studioId: null, key: badge.key }, select: { id: true } });
    if (existing) continue;
    await db.badgeDefinition.create({
      data: {
        studioId: null,
        key: badge.key,
        name: badge.name,
        description: badge.description,
        // Prisma's generated BadgeKind is structurally identical to the shared
        // one but a distinct nominal type; cast once at this boundary.
        kind: badge.kind as unknown as PrismaBadgeKind,
        threshold: badge.threshold as unknown as Prisma.InputJsonValue,
        isActive: true,
      },
    });
    bump('badge_definitions');
  }

  return { businessTypeTemplateIds, planIds, documentIds };
}

/** The platform tenant, its default pipeline stages and its site (with a home page when the site is new). */
export async function ensurePlatformTenant(db: PlatformDefaultsDb, bump: CreatedCounter = noCount): Promise<PlatformTenantResult> {
  // The crm_attribution migration already inserts it on a migrated
  // database; this covers a truncated one.
  let platform = await db.studio.findFirst({ where: { isPlatform: true }, select: { id: true } });
  if (!platform) {
    const slugTaken = await db.studio.findUnique({ where: { slug: PLATFORM_TENANT_DEFAULTS.slug }, select: { id: true } });
    if (slugTaken) {
      throw new Error(`Slug "${PLATFORM_TENANT_DEFAULTS.slug}" belongs to a tenant that is not the platform tenant; resolve it by hand.`);
    }
    platform = await db.studio.create({ data: { ...PLATFORM_TENANT_DEFAULTS, isPlatform: true }, select: { id: true } });
    bump('studios');
  }
  const platformStudioId = platform.id;

  const stages = await db.pipelineStage.createMany({
    data: DEFAULT_PIPELINE_STAGES.map((s) => ({ studioId: platformStudioId, key: s.key, kind: s.kind, sortOrder: s.sortOrder, isSystem: true })),
    skipDuplicates: true,
  });
  if (stages.count > 0) bump('pipeline_stages', stages.count);

  // The home page is created only together with the site, so a page the
  // super admin deletes later is never brought back by a re-run.
  let site = await db.site.findUnique({ where: { studioId: platformStudioId }, select: { id: true } });
  if (!site) {
    site = await db.site.create({
      data: {
        studioId: platformStudioId,
        kind: PLATFORM_SITE_DEFAULTS.kind,
        defaultLocale: PLATFORM_SITE_DEFAULTS.defaultLocale,
        enabledLocales: [...PLATFORM_SITE_DEFAULTS.enabledLocales],
      },
      select: { id: true },
    });
    bump('sites');
    await createPublishedPage(db, site.id, PLATFORM_HOME_PAGE_DEFAULT);
    bump('pages');
    bump('page_locales', PLATFORM_HOME_PAGE_DEFAULT.locales.length);
    bump('blocks', PLATFORM_HOME_PAGE_DEFAULT.blocks.length);
    bump('page_versions');
  }

  return { platformStudioId, platformSiteId: site.id };
}

/**
 * Creates every missing platform default. Pass a transaction client to make
 * the whole run atomic. Never touches users, memberships or any tenant other
 * than the platform tenant.
 */
export async function ensurePlatformDefaults(db: PlatformDefaultsDb): Promise<PlatformDefaultsResult> {
  const created: Record<string, number> = {};
  const bump: CreatedCounter = (table, n = 1) => {
    created[table] = (created[table] ?? 0) + n;
  };
  const catalog = await ensureCatalogDefaults(db, bump);
  const tenant = await ensurePlatformTenant(db, bump);
  return { ...catalog, ...tenant, created };
}
