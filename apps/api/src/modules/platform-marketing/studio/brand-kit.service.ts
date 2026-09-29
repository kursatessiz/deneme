import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@platform/database';
import type { BrandKit, BrandKitLocale, ProductFact } from '@platform/database';
import {
  BrandLinksSchema,
  IcpSchema,
  RequiredDisclaimersSchema,
  SenderIdentitiesSchema,
  disclaimerChannelOf,
  isFactUsable,
  toDateOnly,
  type BrandKitDTO,
  type BrandKitLocaleDTO,
  type BrandKitViewDTO,
  type MarketingCheckContext,
  type MarketingCheckKind,
  type ProductFactDTO,
  type ProductFactInput,
  type UpdateProductFactInput,
  type UpsertBrandKitInput,
} from '@platform/shared';
import { PrismaService } from '../../prisma/prisma.service';
import type { PlatformContext } from '../../auth/tenant-context';
import type { BrandFactPrompt, BrandPromptInput } from '../../ai/marketing-prompts';

type KitWithLocales = BrandKit & { locales: BrandKitLocale[] };

function stringList(value: Prisma.JsonValue): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

function toLocaleDto(row: BrandKitLocale): BrandKitLocaleDTO {
  const disclaimers = RequiredDisclaimersSchema.safeParse(row.requiredDisclaimers);
  return {
    locale: row.locale,
    toneNotes: row.toneNotes,
    doList: stringList(row.doList),
    dontList: stringList(row.dontList),
    bannedPhrases: stringList(row.bannedPhrases),
    requiredDisclaimers: disclaimers.success ? disclaimers.data : {},
  };
}

function toKitDto(kit: KitWithLocales): BrandKitDTO {
  const links = BrandLinksSchema.safeParse(kit.links);
  const senders = SenderIdentitiesSchema.safeParse(kit.senderIdentities);
  const icps = Array.isArray(kit.icps) ? kit.icps.flatMap((i) => { const r = IcpSchema.safeParse(i); return r.success ? [r.data] : []; }) : [];
  return {
    id: kit.id,
    version: kit.version,
    brandName: kit.brandName,
    positioning: kit.positioning,
    defaultLocale: kit.defaultLocale,
    links: links.success ? links.data : {},
    senderIdentities: senders.success ? senders.data : {},
    icps,
    locales: [...kit.locales].sort((a, b) => (a.locale < b.locale ? -1 : 1)).map(toLocaleDto),
    updatedByUserId: kit.updatedByUserId,
    updatedAt: kit.updatedAt.toISOString(),
  };
}

function toFactDto(row: ProductFact): ProductFactDTO {
  const statements: Record<string, string> = {};
  if (row.statements && typeof row.statements === 'object' && !Array.isArray(row.statements)) {
    for (const [locale, text] of Object.entries(row.statements as Record<string, unknown>)) {
      if (typeof text === 'string') statements[locale] = text;
    }
  }
  return {
    id: row.id,
    key: row.key,
    category: row.category,
    statements,
    sourceUrl: row.sourceUrl,
    validUntil: row.validUntil ? toDateOnly(row.validUntil) : null,
    isActive: row.isActive,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Everything the AI studio needs from the kit for one locale. */
export interface BrandContext {
  kit: BrandKitDTO;
  facts: ProductFactDTO[];
}

/**
 * Brand kit and product facts of the platform tenant (M2a). One row per
 * studio, replaced as a whole on every save (locale rows included) and
 * versioned: `version` grows on each save, also when a fact changes,
 * because the AI prompt block that carries kit and facts is cached by it.
 * Every write is audit logged on the platform tenant.
 */
@Injectable()
export class BrandKitService {
  constructor(private readonly prisma: PrismaService) {}

  async view(platform: PlatformContext): Promise<BrandKitViewDTO> {
    const studioId = platform.platformStudioId;
    const [kit, facts] = await Promise.all([
      this.prisma.brandKit.findUnique({ where: { studioId }, include: { locales: true } }),
      this.prisma.productFact.findMany({ where: { studioId }, orderBy: [{ category: 'asc' }, { key: 'asc' }] }),
    ]);
    return {
      kit: kit ? toKitDto(kit) : null,
      facts: facts.map(toFactDto),
      canEdit: platform.isSuperAdmin || platform.permissions.has('platform.brand.manage'),
    };
  }

  /** The kit alone (no facts), for the AI studio: readable with platform.ai.use. */
  async kitOnly(platform: PlatformContext): Promise<{ kit: BrandKitDTO | null }> {
    const kit = await this.prisma.brandKit.findUnique({ where: { studioId: platform.platformStudioId }, include: { locales: true } });
    return { kit: kit ? toKitDto(kit) : null };
  }

  async upsert(platform: PlatformContext, input: UpsertBrandKitInput): Promise<BrandKitViewDTO> {
    const studioId = platform.platformStudioId;
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.brandKit.findUnique({ where: { studioId }, select: { id: true, version: true } });
      const data = {
        brandName: input.brandName,
        positioning: input.positioning,
        defaultLocale: input.defaultLocale,
        links: input.links as Prisma.InputJsonValue,
        senderIdentities: input.senderIdentities as Prisma.InputJsonValue,
        icps: input.icps as unknown as Prisma.InputJsonValue,
        updatedByUserId: platform.userId,
      };
      const kit = existing
        ? await tx.brandKit.update({ where: { id: existing.id }, data: { ...data, version: { increment: 1 } } })
        : await tx.brandKit.create({ data: { studioId, ...data } });
      const locales = input.locales.map((l) => l.locale);
      await tx.brandKitLocale.deleteMany({ where: { brandKitId: kit.id, locale: { notIn: locales } } });
      for (const l of input.locales) {
        const row = {
          toneNotes: l.toneNotes,
          doList: l.doList as Prisma.InputJsonValue,
          dontList: l.dontList as Prisma.InputJsonValue,
          bannedPhrases: l.bannedPhrases as Prisma.InputJsonValue,
          requiredDisclaimers: l.requiredDisclaimers as Prisma.InputJsonValue,
        };
        await tx.brandKitLocale.upsert({
          where: { brandKitId_locale: { brandKitId: kit.id, locale: l.locale } },
          create: { studioId, brandKitId: kit.id, locale: l.locale, ...row },
          update: row,
        });
      }
      await tx.auditLog.create({
        data: {
          studioId,
          userId: platform.userId,
          action: 'marketing.brand_kit.update',
          entityType: 'BrandKit',
          entityId: kit.id,
          metadata: { version: kit.version, locales } as Prisma.InputJsonValue,
        },
      });
    });
    return this.view(platform);
  }

  async createFact(platform: PlatformContext, input: ProductFactInput): Promise<ProductFactDTO> {
    const studioId = platform.platformStudioId;
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        const created = await tx.productFact.create({
          data: {
            studioId,
            key: input.key,
            category: input.category,
            statements: input.statements as Prisma.InputJsonValue,
            sourceUrl: input.sourceUrl ?? null,
            validUntil: input.validUntil ? new Date(`${input.validUntil}T00:00:00.000Z`) : null,
            isActive: input.isActive,
            updatedByUserId: platform.userId,
          },
        });
        await this.bumpVersion(tx, studioId);
        await this.audit(tx, platform, 'marketing.product_fact.create', created.id, { key: created.key });
        return created;
      });
      return toFactDto(row);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException({ statusCode: 409, code: 'FACT_KEY_EXISTS', message: 'Bu anahtarla bir ürün gerçeği zaten var' });
      }
      throw err;
    }
  }

  async updateFact(platform: PlatformContext, id: string, input: UpdateProductFactInput): Promise<ProductFactDTO> {
    const studioId = platform.platformStudioId;
    const existing = await this.prisma.productFact.findFirst({ where: { id, studioId } });
    if (!existing) throw new NotFoundException('Ürün gerçeği bulunamadı');
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        const updated = await tx.productFact.update({
          where: { id },
          data: {
            ...(input.key !== undefined ? { key: input.key } : {}),
            ...(input.category !== undefined ? { category: input.category } : {}),
            ...(input.statements !== undefined ? { statements: input.statements as Prisma.InputJsonValue } : {}),
            ...(input.sourceUrl !== undefined ? { sourceUrl: input.sourceUrl } : {}),
            ...(input.validUntil !== undefined ? { validUntil: input.validUntil ? new Date(`${input.validUntil}T00:00:00.000Z`) : null } : {}),
            ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
            updatedByUserId: platform.userId,
          },
        });
        await this.bumpVersion(tx, studioId);
        await this.audit(tx, platform, 'marketing.product_fact.update', id, { key: updated.key });
        return updated;
      });
      return toFactDto(row);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException({ statusCode: 409, code: 'FACT_KEY_EXISTS', message: 'Bu anahtarla bir ürün gerçeği zaten var' });
      }
      throw err;
    }
  }

  async removeFact(platform: PlatformContext, id: string): Promise<{ deleted: true }> {
    const studioId = platform.platformStudioId;
    const existing = await this.prisma.productFact.findFirst({ where: { id, studioId } });
    if (!existing) throw new NotFoundException('Ürün gerçeği bulunamadı');
    await this.prisma.$transaction(async (tx) => {
      await tx.productFact.delete({ where: { id } });
      await this.bumpVersion(tx, studioId);
      await this.audit(tx, platform, 'marketing.product_fact.delete', id, { key: existing.key });
    });
    return { deleted: true };
  }

  /** The kit and usable facts, or 409 BRAND_KIT_REQUIRED: the studio never writes without a kit to stay within. */
  async requireContext(studioId: string, today = toDateOnly(new Date())): Promise<BrandContext> {
    const [kit, facts] = await Promise.all([
      this.prisma.brandKit.findUnique({ where: { studioId }, include: { locales: true } }),
      this.prisma.productFact.findMany({ where: { studioId }, orderBy: { key: 'asc' } }),
    ]);
    if (!kit) {
      throw new ConflictException({ statusCode: 409, code: 'BRAND_KIT_REQUIRED', message: 'Önce marka kitini oluşturun' });
    }
    return { kit: toKitDto(kit), facts: facts.map(toFactDto).filter((f) => isFactUsable(f, today)) };
  }

  /** Locale row to use: the exact language, else the kit's default language. */
  localeRowFor(kit: BrandKitDTO, locale: string): BrandKitLocaleDTO | null {
    return kit.locales.find((l) => l.locale === locale) ?? kit.locales.find((l) => l.locale === kit.defaultLocale) ?? null;
  }

  /** Statement of a fact in `locale`, else in the default language, else in any language. */
  factStatement(fact: ProductFactDTO, locale: string, defaultLocale: string): string | null {
    return fact.statements[locale] ?? fact.statements[defaultLocale] ?? Object.values(fact.statements)[0] ?? null;
  }

  promptInput(context: BrandContext, locale: string): { input: BrandPromptInput; facts: BrandFactPrompt[] } {
    const { kit } = context;
    const facts: BrandFactPrompt[] = context.facts.flatMap((f) => {
      const statement = this.factStatement(f, locale, kit.defaultLocale);
      return statement ? [{ key: f.key, statement }] : [];
    });
    return {
      facts,
      input: {
        version: kit.version,
        brandName: kit.brandName,
        positioning: kit.positioning,
        defaultLocale: kit.defaultLocale,
        links: { ...kit.links },
        icps: kit.icps,
        locale,
        localeRow: this.localeRowFor(kit, locale),
        facts,
      },
    };
  }

  checkContext(kit: BrandKitDTO, locale: string, kind: MarketingCheckKind): MarketingCheckContext {
    const row = this.localeRowFor(kit, locale);
    const channel = disclaimerChannelOf(kind);
    return {
      locale,
      bannedPhrases: row?.bannedPhrases ?? [],
      requiredDisclaimer: channel ? (row?.requiredDisclaimers[channel] ?? null) : null,
    };
  }

  /** Check context straight from the database (used when a variant is edited). A missing kit checks nothing. */
  async loadCheckContext(studioId: string, locale: string, kind: MarketingCheckKind): Promise<MarketingCheckContext> {
    const kit = await this.prisma.brandKit.findUnique({ where: { studioId }, include: { locales: true } });
    if (!kit) return { locale, bannedPhrases: [], requiredDisclaimer: null };
    return this.checkContext(toKitDto(kit), locale, kind);
  }

  private async bumpVersion(tx: Prisma.TransactionClient, studioId: string): Promise<void> {
    await tx.brandKit.updateMany({ where: { studioId }, data: { version: { increment: 1 } } });
  }

  private async audit(tx: Prisma.TransactionClient, platform: PlatformContext, action: string, entityId: string, metadata: Record<string, unknown>) {
    await tx.auditLog.create({
      data: {
        studioId: platform.platformStudioId,
        userId: platform.userId,
        action,
        entityType: action.startsWith('marketing.product_fact') ? 'ProductFact' : 'BrandKit',
        entityId,
        metadata: metadata as Prisma.InputJsonValue,
      },
    });
  }
}
