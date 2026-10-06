import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@platform/database';
import { ZodError } from 'zod';
import {
  isBlockType,
  validateBlockData,
  TENANT_ONLY_BLOCK_TYPES,
  type CreatePageInput,
  type UpsertPageLocaleInput,
  type UpsertBlockInput,
  type CreateSectorLandingWizardInput,
  type PageSummaryDTO,
  type PageLocaleDTO,
  type PageVersionSummaryDTO,
  type BlockDTO,
} from '@platform/shared';
import { PrismaService } from '../prisma/prisma.service';
import { SiteCacheService } from './site-cache.service';
import { IndexNowService } from './indexnow/indexnow.service';
import { apiError, fieldError } from '../../common/api-error';
import { pickBundledLocale, requestLocale, serverT } from '../../common/server-i18n';

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

const PAGE_INCLUDE = { locales: true } satisfies Prisma.PageInclude;

function toPageSummary(page: Prisma.PageGetPayload<{ include: typeof PAGE_INCLUDE }>): PageSummaryDTO {
  return {
    id: page.id,
    kind: page.kind,
    sectorKey: page.sectorKey,
    offerKey: page.offerKey,
    internalLabel: page.internalLabel,
    status: page.status,
    publishedAt: page.publishedAt?.toISOString() ?? null,
    locales: page.locales.map(toLocaleDto),
  };
}

@Injectable()
export class PagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly siteCache: SiteCacheService,
    private readonly indexNow: IndexNowService,
  ) {}

  /** The web app caches published pages (ISR, docs/SEO.md): a change to live content drops the site's cache. */
  private purgeWhenLive(studioId: string, status: string): void {
    if (status === 'PUBLISHED') void this.siteCache.purgeStudio(studioId);
  }

  async listPages(studioId: string): Promise<PageSummaryDTO[]> {
    const siteId = await this.siteIdOf(studioId);
    const pages = await this.prisma.page.findMany({ where: { siteId }, include: PAGE_INCLUDE, orderBy: { createdAt: 'asc' } });
    return pages.map(toPageSummary);
  }

  async getPageDetail(studioId: string, pageId: string) {
    const page = await this.pageOrThrow(studioId, pageId, { locales: true, blocks: { orderBy: { position: 'asc' } } });
    return { ...toPageSummary(page), blocks: page.blocks.map(toBlockDto) };
  }

  async createPage(studioId: string, input: CreatePageInput): Promise<PageSummaryDTO> {
    const siteId = await this.siteIdOf(studioId);
    const page = await this.prisma.page.create({
      data: { siteId, kind: input.kind, sectorKey: input.sectorKey ?? null, offerKey: input.offerKey ?? null, internalLabel: input.internalLabel },
      include: PAGE_INCLUDE,
    });
    return toPageSummary(page);
  }

  async deletePage(studioId: string, pageId: string): Promise<void> {
    const page = await this.pageOrThrow(studioId, pageId, {});
    if (page.status !== 'DRAFT') throw new BadRequestException(apiError('apiErrors.sites.publishedPageCannotDeletedUnpublish'));
    await this.prisma.page.delete({ where: { id: page.id } });
  }

  async upsertLocale(studioId: string, pageId: string, locale: string, input: UpsertPageLocaleInput): Promise<PageLocaleDTO> {
    const page = await this.pageOrThrow(studioId, pageId, {});
    try {
      const row = await this.prisma.pageLocale.upsert({
        where: { pageId_locale: { pageId: page.id, locale } },
        create: { pageId: page.id, siteId: page.siteId, locale, slug: input.slug, seoTitle: input.seoTitle ?? null, seoDescription: input.seoDescription ?? null, ogImageUrl: input.ogImageUrl ?? null },
        update: { slug: input.slug, seoTitle: input.seoTitle ?? null, seoDescription: input.seoDescription ?? null, ogImageUrl: input.ogImageUrl ?? null },
      });
      this.purgeWhenLive(studioId, page.status);
      return toLocaleDto(row);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException(apiError('apiErrors.sites.slugAlreadyUsedAnotherPageLanguage'));
      }
      throw err;
    }
  }

  async removeLocale(studioId: string, pageId: string, locale: string): Promise<void> {
    const page = await this.pageOrThrow(studioId, pageId, {});
    await this.prisma.pageLocale.deleteMany({ where: { pageId: page.id, locale } });
    this.purgeWhenLive(studioId, page.status);
  }

  async setLegalApproval(studioId: string, pageId: string, locale: string, approved: boolean): Promise<PageLocaleDTO> {
    const page = await this.pageOrThrow(studioId, pageId, {});
    if (page.kind !== 'LEGAL') throw new BadRequestException(apiError('apiErrors.sites.legalConsentOnlyLegalPages'));
    const row = await this.prisma.pageLocale.update({
      where: { pageId_locale: { pageId: page.id, locale } },
      data: { legalApproved: approved, legalApprovedAt: approved ? new Date() : null },
    });
    this.purgeWhenLive(studioId, page.status);
    return toLocaleDto(row);
  }

  async replaceBlocks(studioId: string, pageId: string, blocks: UpsertBlockInput[]): Promise<BlockDTO[]> {
    const page = await this.pageOrThrow(studioId, pageId, { site: true });
    const validated = blocks.map((b, index) => {
      if (!isBlockType(b.type)) throw new BadRequestException(apiError('apiErrors.sites.unknownBlockType', { type: b.type }));
      if (page.site.kind === 'PLATFORM' && (TENANT_ONLY_BLOCK_TYPES as readonly string[]).includes(b.type)) {
        throw new BadRequestException(apiError('apiErrors.sites.blockBusinessOnly', { type: b.type }));
      }
      let data: unknown;
      try {
        data = validateBlockData(b.type, b.data);
      } catch (err) {
        if (err instanceof ZodError) {
          throw new BadRequestException({ ...apiError('apiErrors.sites.invalidBlockContent', { type: b.type }), errors: err.issues.map((i) => fieldError(i.path.join('.'), i.message)) });
        }
        throw err;
      }
      return { type: b.type, position: index, abVariantKey: b.abVariantKey ?? null, data: data as Prisma.InputJsonValue };
    });
    await this.prisma.$transaction([
      this.prisma.block.deleteMany({ where: { pageId: page.id } }),
      ...validated.map((b) => this.prisma.block.create({ data: { pageId: page.id, ...b } })),
    ]);
    this.purgeWhenLive(studioId, page.status);
    const rows = await this.prisma.block.findMany({ where: { pageId: page.id }, orderBy: { position: 'asc' } });
    return rows.map(toBlockDto);
  }

  async publish(studioId: string, pageId: string, userId: string | null): Promise<PageSummaryDTO> {
    const page = await this.pageOrThrow(studioId, pageId, { locales: true, blocks: { orderBy: { position: 'asc' } } });
    if (page.locales.length === 0) throw new BadRequestException(apiError('apiErrors.sites.addContentLeastLanguageBeforePublishing'));
    const nextVersion = await this.nextVersionNumber(page.id);
    const snapshot = { locales: page.locales.map(toLocaleDto), blocks: page.blocks.map(toBlockDto) } as unknown as Prisma.InputJsonValue;
    const [, updated] = await this.prisma.$transaction([
      this.prisma.pageVersion.create({ data: { pageId: page.id, version: nextVersion, snapshot, publishedByUserId: userId } }),
      this.prisma.page.update({ where: { id: page.id }, data: { status: 'PUBLISHED', publishedAt: new Date() }, include: PAGE_INCLUDE }),
    ]);
    void this.siteCache.purgeStudio(studioId);
    void this.indexNow.notifyPage(studioId, page.id);
    return toPageSummary(updated);
  }

  async unpublish(studioId: string, pageId: string): Promise<PageSummaryDTO> {
    const page = await this.pageOrThrow(studioId, pageId, {});
    const updated = await this.prisma.page.update({ where: { id: page.id }, data: { status: 'DRAFT' }, include: PAGE_INCLUDE });
    void this.siteCache.purgeStudio(studioId);
    void this.indexNow.notifyPage(studioId, page.id);
    return toPageSummary(updated);
  }

  async listVersions(studioId: string, pageId: string): Promise<PageVersionSummaryDTO[]> {
    const page = await this.pageOrThrow(studioId, pageId, {});
    const rows = await this.prisma.pageVersion.findMany({
      where: { pageId: page.id },
      orderBy: { version: 'desc' },
      include: { publishedByUser: { select: { firstName: true, lastName: true } } },
    });
    return rows.map((r) => ({
      id: r.id,
      version: r.version,
      publishedAt: r.publishedAt.toISOString(),
      publishedByName: r.publishedByUser ? `${r.publishedByUser.firstName} ${r.publishedByUser.lastName}` : null,
    }));
  }

  /** Restores a page's live locales and blocks from a past version, then publishes that state as a new version. */
  async rollback(studioId: string, pageId: string, versionId: string, userId: string | null): Promise<PageSummaryDTO> {
    const page = await this.pageOrThrow(studioId, pageId, {});
    const version = await this.prisma.pageVersion.findFirst({ where: { id: versionId, pageId: page.id } });
    if (!version) throw new NotFoundException(apiError('apiErrors.sites.versionNotFound'));
    const snapshot = version.snapshot as unknown as { locales: PageLocaleDTO[]; blocks: BlockDTO[] };

    await this.prisma.$transaction([
      this.prisma.pageLocale.deleteMany({ where: { pageId: page.id } }),
      ...snapshot.locales.map((l) =>
        this.prisma.pageLocale.create({
          data: {
            pageId: page.id,
            siteId: page.siteId,
            locale: l.locale,
            slug: l.slug,
            seoTitle: l.seoTitle,
            seoDescription: l.seoDescription,
            ogImageUrl: l.ogImageUrl,
            legalApproved: l.legalApproved,
            legalApprovedAt: l.legalApprovedAt ? new Date(l.legalApprovedAt) : null,
          },
        }),
      ),
      this.prisma.block.deleteMany({ where: { pageId: page.id } }),
      ...snapshot.blocks.map((b) =>
        this.prisma.block.create({
          data: { pageId: page.id, type: b.type, position: b.position, abVariantKey: b.abVariantKey, data: b.data as Prisma.InputJsonValue },
        }),
      ),
    ]);
    return this.publish(studioId, pageId, userId);
  }

  /** Super admin wizard: creates a sector landing page pre-filled from BusinessTypeTemplate vocabulary. */
  async createSectorLandingWizard(studioId: string, input: CreateSectorLandingWizardInput): Promise<PageSummaryDTO> {
    const businessType = await this.prisma.businessTypeTemplate.findUnique({ where: { key: input.sectorKey } });
    if (!businessType) throw new NotFoundException(apiError('apiErrors.sites.industryNotFound'));
    const vocabulary = (businessType.vocabulary as Record<string, string>) ?? {};
    const memberWord = vocabulary.member ?? serverT(requestLocale())('apiTexts.sites.wizard.defaultMemberWord');

    const siteId = await this.siteIdOf(studioId);
    const internalLabel = input.offerKey ? `${businessType.name} - ${input.offerKey}` : businessType.name;
    const page = await this.prisma.page.create({
      data: { siteId, kind: 'LANDING', sectorKey: input.sectorKey, offerKey: input.offerKey ?? null, internalLabel },
    });

    const slugBase = input.sectorKey.replace(/_/g, '-');
    for (const locale of input.locales) {
      const slug = input.offerKey ? `${slugBase}/${input.offerKey}` : slugBase;
      await this.prisma.pageLocale.upsert({
        where: { pageId_locale: { pageId: page.id, locale } },
        create: { pageId: page.id, siteId, locale, slug, seoTitle: `${businessType.name} | Platform`, seoDescription: null },
        update: {},
      });
    }

    // Starter copy per locale from the catalogue; a locale without bundled messages gets English.
    const copyFor = (locale: string) => serverT(pickBundledLocale([locale, 'en']));
    const heroText = Object.fromEntries(
      input.locales.map((locale) => {
        const t = copyFor(locale);
        return [
          locale,
          {
            title: t('apiTexts.sites.wizard.heroTitle', { sector: businessType.name }),
            subtitle: t('apiTexts.sites.wizard.heroSubtitle', { member: memberWord }),
            primaryCtaLabel: t('apiTexts.sites.wizard.heroCta'),
            primaryCtaHref: locale === 'tr' ? '#iletisim' : '#contact',
          },
        ];
      }),
    );
    const ctaText = Object.fromEntries(
      input.locales.map((locale) => {
        const t = copyFor(locale);
        return [locale, { title: t('apiTexts.sites.wizard.ctaTitle'), buttonLabel: t('apiTexts.sites.wizard.ctaButton'), buttonHref: locale === 'tr' ? '#iletisim' : '#contact' }];
      }),
    );
    const leadFormText = Object.fromEntries(
      input.locales.map((locale) => {
        const t = copyFor(locale);
        return [
          locale,
          { title: t('apiTexts.sites.wizard.formTitle'), submitLabel: t('apiTexts.sites.wizard.formSubmit'), consentText: t('apiTexts.sites.wizard.formConsent') },
        ];
      }),
    );

    await this.prisma.$transaction([
      this.prisma.block.create({ data: { pageId: page.id, type: 'hero', position: 0, data: { config: {}, text: heroText } } }),
      this.prisma.block.create({ data: { pageId: page.id, type: 'cta', position: 1, data: { config: {}, text: ctaText } } }),
      this.prisma.block.create({ data: { pageId: page.id, type: 'lead_form', position: 2, data: { config: { fields: ['fullName', 'phone'] }, text: leadFormText } } }),
    ]);

    const created = await this.prisma.page.findUniqueOrThrow({ where: { id: page.id }, include: PAGE_INCLUDE });
    return toPageSummary(created);
  }

  private async siteIdOf(studioId: string): Promise<string> {
    const site = await this.prisma.site.findUnique({ where: { studioId }, select: { id: true } });
    if (!site) throw new NotFoundException(apiError('apiErrors.sites.businessNotWebsiteYet'));
    return site.id;
  }

  private async nextVersionNumber(pageId: string): Promise<number> {
    const last = await this.prisma.pageVersion.findFirst({ where: { pageId }, orderBy: { version: 'desc' }, select: { version: true } });
    return (last?.version ?? 0) + 1;
  }

  private async pageOrThrow<T extends Prisma.PageInclude>(studioId: string, pageId: string, include: T) {
    const siteId = await this.siteIdOf(studioId);
    const page = await this.prisma.page.findFirst({ where: { id: pageId, siteId }, include });
    if (!page) throw new NotFoundException(apiError('apiErrors.sites.pageNotFound'));
    return page as Prisma.PageGetPayload<{ include: T }> & { siteId: string };
  }
}
