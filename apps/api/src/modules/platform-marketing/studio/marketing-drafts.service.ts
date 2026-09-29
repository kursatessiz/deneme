import { randomBytes } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@platform/database';
import type { MarketingDraft, MarketingDraftVariant } from '@platform/database';
import {
  AbTestSetupSchema,
  CAMPAIGN_EXPORTABLE_KINDS,
  GENERATABLE_DRAFT_KINDS,
  MarketingBriefSchema,
  TenantTemplateUpsertSchema,
  hasBlockingIssues,
  parseMarketingContent,
  resolvePlatformTenantPermissions,
  runMarketingChecks,
  type AbTestSetupDTO,
  type AbTestSetupInput,
  type CampaignExportableKind,
  type DraftListQuery,
  type EmailBlock,
  type ExportToCampaignInput,
  type ExportToCampaignResultDTO,
  type MarketingCheckContext,
  type MarketingCheckIssue,
  type MarketingContent,
  type MarketingDraftDTO,
  type MarketingDraftKind,
  type MarketingDraftListDTO,
  type MarketingDraftVariantDTO,
  type UpdateDraftInput,
  type UpdateVariantInput,
} from '@platform/shared';
import { PrismaService } from '../../prisma/prisma.service';
import type { PlatformContext, TenantContext } from '../../auth/tenant-context';
import { CampaignsService } from '../../growth/campaigns/campaigns.service';
import { SegmentsService } from '../../growth/segments/segments.service';
import { MessageTemplatesService } from '../../messaging/settings/message-templates.service';
import { BrandKitService } from './brand-kit.service';

type DraftRow = MarketingDraft & { variants: MarketingDraftVariant[] };

/** Letters given to variants in order (A, B, C, ...). */
export const VARIANT_KEYS = 'ABCDEFGHIJ';
/** Most variants one draft can hold, however many times more are requested. */
export const MAX_VARIANTS_PER_DRAFT = VARIANT_KEYS.length;

export interface NewVariant {
  content: MarketingContent;
  issues: MarketingCheckIssue[];
}

export interface NewDraft {
  kind: MarketingDraftKind;
  locale: string;
  title: string;
  brief: Prisma.InputJsonValue | null;
  factKeys: string[];
  brandKitVersion: number | null;
  model: string | null;
  costMicroUsd: number;
  variants: NewVariant[];
}

function issuesOf(value: Prisma.JsonValue): MarketingCheckIssue[] {
  return Array.isArray(value) ? (value as unknown as MarketingCheckIssue[]) : [];
}

function toVariantDto(row: MarketingDraftVariant): MarketingDraftVariantDTO {
  return {
    id: row.id,
    key: row.key,
    position: row.position,
    content: (row.content ?? {}) as MarketingContent,
    issues: issuesOf(row.issues),
    editedAt: row.editedAt?.toISOString() ?? null,
  };
}

function toAbTest(value: Prisma.JsonValue | null): AbTestSetupDTO | null {
  if (!value) return null;
  const parsed = AbTestSetupSchema.safeParse(value);
  return parsed.success ? { ...parsed.data, storedOnly: true } : null;
}

export function toDraftDto(row: DraftRow): MarketingDraftDTO {
  const brief = MarketingBriefSchema.safeParse(row.brief);
  return {
    id: row.id,
    kind: row.kind as MarketingDraftKind,
    locale: row.locale,
    title: row.title,
    status: row.status,
    brief: brief.success ? brief.data : null,
    notes: row.notes,
    factKeys: Array.isArray(row.factKeys) ? row.factKeys.filter((k): k is string => typeof k === 'string') : [],
    brandKitVersion: row.brandKitVersion,
    abTest: toAbTest(row.abTest),
    exportedCampaignId: row.exportedCampaignId,
    variants: [...row.variants].sort((a, b) => a.position - b.position).map(toVariantDto),
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const include = { variants: true } as const;

/**
 * Persistence and editing of AI studio drafts (M2b): every draft is a
 * MarketingDraft with variants, always DRAFT/REVIEWED/ARCHIVED, editable,
 * and never sent or published from here. "Kampanyaya aktar" creates a
 * message template and a DRAFT campaign through the existing services and
 * stops there. Every write is audit logged on the platform tenant.
 */
@Injectable()
export class MarketingDraftsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly brandKit: BrandKitService,
    private readonly templates: MessageTemplatesService,
    private readonly campaigns: CampaignsService,
    private readonly segments: SegmentsService,
  ) {}

  async create(platform: PlatformContext, data: NewDraft, tx?: Prisma.TransactionClient): Promise<MarketingDraftDTO> {
    const run = async (client: Prisma.TransactionClient) => {
      const draft = await client.marketingDraft.create({
        data: {
          studioId: platform.platformStudioId,
          kind: data.kind,
          locale: data.locale,
          title: data.title.slice(0, 160),
          brief: data.brief ?? Prisma.DbNull,
          factKeys: data.factKeys as Prisma.InputJsonValue,
          brandKitVersion: data.brandKitVersion,
          aiModel: data.model,
          aiCostMicroUsd: data.costMicroUsd,
          createdByUserId: platform.userId,
          updatedByUserId: platform.userId,
          variants: {
            create: data.variants.map((v, index) => ({
              studioId: platform.platformStudioId,
              position: index,
              key: VARIANT_KEYS[index],
              content: v.content as Prisma.InputJsonValue,
              issues: v.issues as unknown as Prisma.InputJsonValue,
            })),
          },
        },
        include,
      });
      await client.auditLog.create({
        data: {
          studioId: platform.platformStudioId,
          userId: platform.userId,
          action: 'marketing.draft.create',
          entityType: 'MarketingDraft',
          entityId: draft.id,
          metadata: { kind: data.kind, locale: data.locale, variants: data.variants.length, costMicroUsd: data.costMicroUsd } as Prisma.InputJsonValue,
        },
      });
      return draft;
    };
    return toDraftDto(tx ? await run(tx) : await this.prisma.$transaction(run));
  }

  /** Appends variants to an existing draft (keys continue after the last one); returns the updated draft. */
  async appendVariants(platform: PlatformContext, draftId: string, variants: NewVariant[], costMicroUsd: number): Promise<MarketingDraftDTO> {
    const draft = await this.load(platform, draftId);
    const room = MAX_VARIANTS_PER_DRAFT - draft.variants.length;
    const take = variants.slice(0, Math.max(0, room));
    if (take.length === 0) throw new ConflictException({ statusCode: 409, code: 'DRAFT_VARIANT_LIMIT', message: 'Bir taslakta en fazla 10 varyant olabilir' });
    const start = draft.variants.length;
    const row = await this.prisma.$transaction(async (tx) => {
      await tx.marketingDraftVariant.createMany({
        data: take.map((v, i) => ({
          studioId: platform.platformStudioId,
          draftId,
          position: start + i,
          key: VARIANT_KEYS[start + i],
          content: v.content as Prisma.InputJsonValue,
          issues: v.issues as unknown as Prisma.InputJsonValue,
        })),
      });
      const updated = await tx.marketingDraft.update({
        where: { id: draftId },
        data: { aiCostMicroUsd: { increment: costMicroUsd }, updatedByUserId: platform.userId, status: draft.status === 'REVIEWED' ? 'DRAFT' : undefined },
        include,
      });
      await tx.auditLog.create({
        data: {
          studioId: platform.platformStudioId,
          userId: platform.userId,
          action: 'marketing.draft.add_variants',
          entityType: 'MarketingDraft',
          entityId: draftId,
          metadata: { added: take.length } as Prisma.InputJsonValue,
        },
      });
      return updated;
    });
    return toDraftDto(row);
  }

  async list(platform: PlatformContext, query: DraftListQuery): Promise<MarketingDraftListDTO> {
    const where: Prisma.MarketingDraftWhereInput = {
      studioId: platform.platformStudioId,
      ...(query.kind ? { kind: query.kind } : {}),
      // Archived drafts are hidden unless asked for.
      ...(query.status ? { status: query.status } : { status: { not: 'ARCHIVED' } }),
    };
    const [total, rows] = await Promise.all([
      this.prisma.marketingDraft.count({ where }),
      this.prisma.marketingDraft.findMany({
        where,
        include,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
    ]);
    return { items: rows.map(toDraftDto), total, page: query.page, limit: query.limit };
  }

  async get(platform: PlatformContext, id: string): Promise<MarketingDraftDTO> {
    return toDraftDto(await this.load(platform, id));
  }

  async update(platform: PlatformContext, id: string, input: UpdateDraftInput): Promise<MarketingDraftDTO> {
    const draft = await this.load(platform, id);
    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.marketingDraft.update({
        where: { id },
        data: {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
          updatedByUserId: platform.userId,
        },
        include,
      });
      await tx.auditLog.create({
        data: {
          studioId: platform.platformStudioId,
          userId: platform.userId,
          action: 'marketing.draft.update',
          entityType: 'MarketingDraft',
          entityId: id,
          metadata: { status: input.status ?? draft.status, titleChanged: input.title !== undefined } as Prisma.InputJsonValue,
        },
      });
      return updated;
    });
    return toDraftDto(row);
  }

  async updateVariant(platform: PlatformContext, draftId: string, variantId: string, input: UpdateVariantInput): Promise<MarketingDraftDTO> {
    const draft = await this.load(platform, draftId);
    if (draft.status === 'ARCHIVED') throw new ConflictException({ statusCode: 409, code: 'DRAFT_ARCHIVED', message: 'Arşivlenmiş taslak düzenlenemez' });
    const kind = draft.kind as MarketingDraftKind;
    if (!(GENERATABLE_DRAFT_KINDS as readonly string[]).includes(kind)) {
      throw new BadRequestException({ statusCode: 400, code: 'DRAFT_KIND_NOT_EDITABLE', message: 'Bu tür taslak metin olarak düzenlenemez' });
    }
    const variant = draft.variants.find((v) => v.id === variantId);
    if (!variant) throw new NotFoundException('Varyant bulunamadı');
    const parsed = parseMarketingContent(kind, input.content);
    if (!parsed.ok) throw new BadRequestException({ statusCode: 400, message: 'Geçersiz içerik', errors: parsed.issues.map((message) => ({ path: '', message })) });
    const ctx = await this.brandKit.loadCheckContext(platform.platformStudioId, draft.locale, kind);
    const issues = runMarketingChecks(kind, parsed.content, ctx);
    const row = await this.prisma.$transaction(async (tx) => {
      await tx.marketingDraftVariant.update({
        where: { id: variantId },
        data: { content: parsed.content as Prisma.InputJsonValue, issues: issues as unknown as Prisma.InputJsonValue, editedAt: new Date() },
      });
      // An edit invalidates an earlier review.
      const updated = await tx.marketingDraft.update({
        where: { id: draftId },
        data: { updatedByUserId: platform.userId, ...(draft.status === 'REVIEWED' ? { status: 'DRAFT' as const } : {}) },
        include,
      });
      await tx.auditLog.create({
        data: {
          studioId: platform.platformStudioId,
          userId: platform.userId,
          action: 'marketing.draft.edit_variant',
          entityType: 'MarketingDraft',
          entityId: draftId,
          metadata: { variantId, issues: issues.length } as Prisma.InputJsonValue,
        },
      });
      return updated;
    });
    return toDraftDto(row);
  }

  /** A/B setup stub: the choice is stored on the draft; nothing is sent (M3 owns test sends). */
  async setAbTest(platform: PlatformContext, draftId: string, input: AbTestSetupInput): Promise<MarketingDraftDTO> {
    const draft = await this.load(platform, draftId);
    if (!(GENERATABLE_DRAFT_KINDS as readonly string[]).includes(draft.kind)) {
      throw new BadRequestException({ statusCode: 400, code: 'DRAFT_KIND_NOT_EDITABLE', message: 'Bu tür taslak için A/B testi kurulamaz' });
    }
    const ids = new Set(draft.variants.map((v) => v.id));
    if (!input.variantIds.every((id) => ids.has(id))) throw new BadRequestException('Varyantlar bu taslağa ait olmalı');
    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.marketingDraft.update({
        where: { id: draftId },
        data: { abTest: input as unknown as Prisma.InputJsonValue, updatedByUserId: platform.userId },
        include,
      });
      await tx.auditLog.create({
        data: {
          studioId: platform.platformStudioId,
          userId: platform.userId,
          action: 'marketing.draft.ab_setup',
          entityType: 'MarketingDraft',
          entityId: draftId,
          metadata: { enabled: input.enabled, variants: input.variantIds.length, storedOnly: true } as Prisma.InputJsonValue,
        },
      });
      return updated;
    });
    return toDraftDto(row);
  }

  /**
   * "Kampanyaya aktar": copies one variant into a message template of the
   * platform tenant and creates a DRAFT campaign for a segment through
   * CampaignsService. Nothing is scheduled or sent. A variant with blocking
   * brand issues is refused; the check is re-run with the current kit.
   */
  async exportToCampaign(platform: PlatformContext, draftId: string, input: ExportToCampaignInput): Promise<ExportToCampaignResultDTO> {
    const draft = await this.load(platform, draftId);
    const kind = draft.kind as MarketingDraftKind;
    if (!(CAMPAIGN_EXPORTABLE_KINDS as readonly string[]).includes(kind)) {
      throw new BadRequestException({ statusCode: 400, code: 'DRAFT_KIND_NOT_EXPORTABLE', message: 'Bu tür taslak kampanyaya aktarılamaz' });
    }
    if (draft.status === 'ARCHIVED') throw new ConflictException({ statusCode: 409, code: 'DRAFT_ARCHIVED', message: 'Arşivlenmiş taslak aktarılamaz' });
    const variant = draft.variants.find((v) => v.id === input.variantId);
    if (!variant) throw new NotFoundException('Varyant bulunamadı');
    const parsed = parseMarketingContent(kind, variant.content);
    if (!parsed.ok) throw new BadRequestException({ statusCode: 400, message: 'Geçersiz içerik' });
    const ctx: MarketingCheckContext = await this.brandKit.loadCheckContext(platform.platformStudioId, draft.locale, kind);
    const issues = runMarketingChecks(kind, parsed.content, ctx);
    if (hasBlockingIssues(issues)) {
      throw new ConflictException({ statusCode: 409, code: 'DRAFT_HAS_BLOCKING_ISSUES', message: 'Taslakta engelleyici marka kontrolü sorunları var', issues });
    }

    const studioId = platform.platformStudioId;
    await this.segments.get(studioId, input.segmentId);
    const templateKey = `MKT_${randomBytes(6).toString('hex').toUpperCase()}`;
    const upsert = this.templateInput(kind as CampaignExportableKind, templateKey, draft.locale, parsed.content);
    const tenant = this.tenantFor(platform);
    await this.templates.upsert(studioId, upsert);
    const campaign = await this.campaigns.create(tenant, {
      name: (input.name ?? draft.title).slice(0, 120),
      segmentId: input.segmentId,
      channel: kind as CampaignExportableKind,
      templateKey,
    });
    await this.prisma.$transaction([
      this.prisma.marketingDraft.update({ where: { id: draftId }, data: { exportedCampaignId: campaign.id, updatedByUserId: platform.userId } }),
      this.prisma.auditLog.create({
        data: {
          studioId,
          userId: platform.userId,
          action: 'marketing.draft.export_campaign',
          entityType: 'MarketingDraft',
          entityId: draftId,
          metadata: { campaignId: campaign.id, templateKey, variantId: variant.id, segmentId: input.segmentId } as Prisma.InputJsonValue,
        },
      }),
    ]);
    return { campaignId: campaign.id, templateKey, campaignStatus: 'DRAFT' };
  }

  private templateInput(kind: CampaignExportableKind, key: string, locale: string, content: MarketingContent) {
    if (kind === 'EMAIL') {
      const body = String(content.body ?? '');
      const blocks: EmailBlock[] = body
        .split(/\n{2,}/)
        .map((p) => p.trim())
        .filter((p) => p !== '')
        .map((text) => ({ type: 'paragraph' as const, text }));
      return TenantTemplateUpsertSchema.parse({
        key,
        channel: 'EMAIL',
        locale,
        body,
        subject: String(content.subject ?? ''),
        blocks: blocks.length > 0 ? blocks : null,
        isTransactional: false,
        isActive: true,
      });
    }
    if (kind === 'SMS') {
      return TenantTemplateUpsertSchema.parse({ key, channel: 'SMS', locale, body: String(content.text ?? ''), isTransactional: false, isActive: true });
    }
    return TenantTemplateUpsertSchema.parse({
      key,
      channel: 'WHATSAPP',
      locale,
      body: String(content.body ?? ''),
      whatsappTemplateName: String(content.templateName ?? key.toLowerCase()),
      isTransactional: false,
      isActive: true,
    });
  }

  private tenantFor(platform: PlatformContext): TenantContext {
    return {
      studioId: platform.platformStudioId,
      membershipId: null,
      isOwner: false,
      isSuperAdmin: platform.isSuperAdmin,
      permissions: new Set(resolvePlatformTenantPermissions([...platform.permissions])),
      memberProfileId: null,
      trainerProfileId: null,
      branchIds: null,
    };
  }

  /** Loads a draft of the platform tenant; another tenant's id is indistinguishable from a missing one. */
  async load(platform: PlatformContext, id: string): Promise<DraftRow> {
    const row = await this.prisma.marketingDraft.findFirst({ where: { id, studioId: platform.platformStudioId }, include });
    if (!row) throw new NotFoundException('Taslak bulunamadı');
    return row;
  }
}
