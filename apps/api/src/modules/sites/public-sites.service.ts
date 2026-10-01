import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@platform/database';
import { DEFAULT_TENANT_THEME, originForPlatformHost, pickCanonicalHost, studioBillingCurrency } from '@platform/shared';
import type { PublicPageDTO, PublicPageContext, PageLocaleDTO, BlockDTO, PublicSiteSettingsDTO, SitemapPageEntry, TenantThemeView, VariantPagesDTO } from '@platform/shared';
import { PrismaService } from '../prisma/prisma.service';
import { sitesBaseDomain } from './sites.service';
import { loadAllowedThemeFamiliesForStudio } from '../appearance/theme-families';
import { loadPoweredBy } from './powered-by';

function toLocaleDto(l: { locale: string; slug: string; seoTitle: string | null; seoDescription: string | null; ogImageUrl: string | null; legalApproved: boolean; legalApprovedAt: Date | null }): PageLocaleDTO {
  return {
    locale: l.locale,
    slug: l.slug,
    seoTitle: l.seoTitle,
    seoDescription: l.seoDescription,
    ogImageUrl: l.ogImageUrl,
    legalApproved: l.legalApproved,
    legalApprovedAt: l.legalApprovedAt?.toISOString() ?? null,
  };
}

function toBlockDto(b: { id: string; type: string; position: number; abVariantKey: string | null; data: Prisma.JsonValue }): BlockDTO {
  return { id: b.id, type: b.type as BlockDTO['type'], position: b.position, abVariantKey: b.abVariantKey, data: b.data };
}

export interface ResolvedHost {
  studioSlug: string;
  siteId: string;
}

@Injectable()
export class PublicSitesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Host -> site, for the web app's middleware (platform domain, `<slug>.<base>`, or a verified custom domain). */
  async resolveHost(host: string): Promise<ResolvedHost | null> {
    const cleanHost = host.split(':')[0].toLowerCase();
    const base = sitesBaseDomain();

    if (cleanHost === base) {
      const platform = await this.prisma.studio.findFirst({ where: { isPlatform: true }, select: { slug: true, site: { select: { id: true } } } });
      if (!platform?.site) return null;
      return { studioSlug: platform.slug, siteId: platform.site.id };
    }

    if (cleanHost.endsWith(`.${base}`)) {
      const slug = cleanHost.slice(0, -`.${base}`.length);
      const studio = await this.prisma.studio.findFirst({ where: { slug, isActive: true }, select: { slug: true, site: { select: { id: true } } } });
      if (!studio?.site) return null;
      return { studioSlug: studio.slug, siteId: studio.site.id };
    }

    const domain = await this.prisma.siteDomain.findFirst({
      where: { domain: cleanHost, status: 'VERIFIED' },
      include: { site: { include: { studio: { select: { slug: true, isActive: true } } } } },
    });
    if (!domain || !domain.site.studio.isActive) return null;
    return { studioSlug: domain.site.studio.slug, siteId: domain.site.id };
  }

  async getPage(studioSlug: string, locale: string, slug: string): Promise<PublicPageDTO> {
    const studio = await this.prisma.studio.findFirst({ where: { slug: studioSlug, isActive: true }, include: { site: true } });
    if (!studio?.site) throw new NotFoundException('Site bulunamadı');

    const localeRow = await this.prisma.pageLocale.findFirst({
      where: { siteId: studio.site.id, locale, slug, page: { status: 'PUBLISHED' } },
      include: { page: { include: { locales: true, blocks: { orderBy: { position: 'asc' } } } } },
    });
    if (!localeRow) throw new NotFoundException('Sayfa bulunamadı');
    const page = localeRow.page;

    const context = await this.buildContext(studio, page.blocks.map((b) => b.type));
    const theme: TenantThemeView =
      studio.site.kind === 'PLATFORM'
        ? DEFAULT_TENANT_THEME
        : {
            logoUrl: studio.logoUrl,
            themeFamily: studio.themeFamily as TenantThemeView['themeFamily'],
            themePrimary: studio.themePrimary,
            gradientPresetKey: studio.gradientPresetKey as TenantThemeView['gradientPresetKey'],
            allowedThemeFamilies: await loadAllowedThemeFamiliesForStudio(this.prisma, studio.id),
          };

    return {
      siteKind: studio.site.kind,
      theme,
      studioSlug: studio.slug,
      defaultLocale: studio.site.defaultLocale,
      enabledLocales: studio.site.enabledLocales,
      locale,
      page: { kind: page.kind, sectorKey: page.sectorKey, offerKey: page.offerKey },
      localeMeta: toLocaleDto(localeRow),
      allLocales: page.locales.map(toLocaleDto),
      blocks: page.blocks.map(toBlockDto),
      context,
    };
  }

  /**
   * Per-site presentation settings for the public renderer: the "Powered by" badge and the canonical origin.
   * 404 when the site does not exist. The canonical origin does not depend on the request host, so the web
   * app can cache a page for every host that serves it (docs/SEO.md "ISR").
   */
  async getSettings(studioSlug: string): Promise<PublicSiteSettingsDTO> {
    const studio = await this.prisma.studio.findFirst({
      where: { slug: studioSlug, isActive: true },
      select: { id: true, slug: true, isPlatform: true, site: { select: { id: true, primaryDomain: true, domains: { where: { status: 'VERIFIED' }, select: { domain: true, verifiedAt: true } } } } },
    });
    if (!studio?.site) throw new NotFoundException('Site bulunamadı');
    const base = sitesBaseDomain();
    const host = pickCanonicalHost({
      isPlatform: studio.isPlatform,
      slug: studio.slug,
      baseDomain: base,
      primaryDomain: studio.site.primaryDomain,
      verifiedDomains: studio.site.domains.map((d) => ({ domain: d.domain, verifiedAt: d.verifiedAt?.getTime() ?? 0 })),
    });
    return { ...(await loadPoweredBy(this.prisma, studio)), canonicalOrigin: originForPlatformHost(host) };
  }

  /**
   * Published page paths with two or more A/B variants. The web middleware sends exactly these to the
   * per-request renderer; every other page is served from the ISR cache (docs/SEO.md "ISR").
   */
  async variantPages(studioSlug: string): Promise<VariantPagesDTO> {
    const studio = await this.prisma.studio.findFirst({ where: { slug: studioSlug, isActive: true }, select: { site: { select: { id: true } } } });
    if (!studio?.site) return { items: [] };
    const blocks = await this.prisma.block.findMany({
      where: { abVariantKey: { not: null }, page: { siteId: studio.site.id, status: 'PUBLISHED' } },
      select: { pageId: true, abVariantKey: true },
    });
    const keysByPage = new Map<string, Set<string>>();
    for (const b of blocks) {
      if (!b.abVariantKey) continue;
      const keys = keysByPage.get(b.pageId) ?? new Set<string>();
      keys.add(b.abVariantKey);
      keysByPage.set(b.pageId, keys);
    }
    const pageIds = [...keysByPage.entries()].filter(([, keys]) => keys.size >= 2).map(([id]) => id);
    if (pageIds.length === 0) return { items: [] };
    const locales = await this.prisma.pageLocale.findMany({ where: { siteId: studio.site.id, pageId: { in: pageIds } }, select: { locale: true, slug: true } });
    return { items: locales.map((l) => ({ locale: l.locale, slug: l.slug })) };
  }

  /** The site's default locale, for the sitemap's x-default alternates; null when the studio has no site. */
  async siteDefaultLocale(studioSlug: string): Promise<string | null> {
    const studio = await this.prisma.studio.findFirst({ where: { slug: studioSlug, isActive: true }, select: { site: { select: { defaultLocale: true } } } });
    return studio?.site?.defaultLocale ?? null;
  }

  async sitemapEntries(studioSlug: string): Promise<SitemapPageEntry[]> {
    const studio = await this.prisma.studio.findFirst({ where: { slug: studioSlug, isActive: true }, select: { site: { select: { id: true } } } });
    if (!studio?.site) return [];
    const rows = await this.prisma.pageLocale.findMany({
      where: { siteId: studio.site.id, page: { status: 'PUBLISHED' } },
      include: { page: { select: { id: true, updatedAt: true } } },
    });
    return rows.map((r) => ({ pageId: r.page.id, locale: r.locale, slug: r.slug, updatedAt: r.page.updatedAt.toISOString() }));
  }

  private async buildContext(
    studio: { id: string; name: string; address: string | null; email: string | null; phone: string | null; currency: string; site: { kind: string } | null },
    blockTypes: string[],
  ): Promise<PublicPageContext> {
    const context: PublicPageContext = {};
    const needs = new Set(blockTypes);

    if (needs.has('pricing')) {
      if (studio.site?.kind === 'PLATFORM') {
        // G5c-1b: prices in the platform tenant's billing currency (plan_prices);
        // a plan without a price in it is not listed.
        const platform = await this.prisma.studio.findUnique({ where: { id: studio.id }, select: { countryCode: true, billingCurrency: true } });
        const currency = studioBillingCurrency({ countryCode: platform?.countryCode, billingCurrency: platform?.billingCurrency });
        const plans = await this.prisma.plan.findMany({ where: { isActive: true, prices: { some: { currency } } }, include: { prices: { where: { currency } } } });
        context.plans = plans
          .map((p) => ({ key: p.key, name: p.name, priceMonthly: p.prices[0].priceMonthly.toString(), currency, limits: p.limits }))
          .sort((a, b) => Number(a.priceMonthly) - Number(b.priceMonthly));
      } else {
        const packages = await this.prisma.packageDefinition.findMany({ where: { studioId: studio.id, isActive: true }, orderBy: { price: 'asc' } });
        context.packages = packages.map((p) => ({ id: p.id, name: p.name, price: p.price.toString(), currency: studio.currency }));
      }
    }

    if (needs.has('sector_cards')) {
      const businessTypes = await this.prisma.businessTypeTemplate.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } });
      context.businessTypes = businessTypes.map((b) => ({ key: b.key, name: b.name, vocabulary: (b.vocabulary as Record<string, string>) ?? {} }));
    }

    if (needs.has('contact')) {
      if (studio.site?.kind === 'PLATFORM') {
        const company = await this.prisma.companyInfo.findUnique({ where: { id: 'platform' } });
        if (company) {
          context.companyInfo = {
            legalName: company.legalName,
            address: company.address,
            email: company.email,
            phone: company.phone,
            socialLinks: (company.socialLinks as Record<string, string>) ?? {},
          };
        }
      } else {
        context.studioContact = { name: studio.name, address: studio.address, email: studio.email, phone: studio.phone };
      }
    }

    return context;
  }
}
