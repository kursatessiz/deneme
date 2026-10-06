import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@platform/database';
import type { Segment } from '@platform/database';
import { SEGMENT_FIELD_GROUPS, SEGMENT_FIELDS, UNAVAILABLE_SEGMENT_FIELDS, contactDisplayName } from '@platform/shared';
import type {
  CreateSegmentInput,
  SegmentContactSampleDTO,
  SegmentContactsDTO,
  SegmentContactsQuery,
  SegmentDTO,
  SegmentFieldCatalogueDTO,
  SegmentFieldKind,
  SegmentGroup,
  SegmentMembersInput,
  SegmentPreviewDTO,
  UpdateSegmentInput,
} from '@platform/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { SegmentEvaluatorService } from './segment-evaluator.service';
import { apiError } from '../../../common/api-error';

const SAMPLE_SIZE = 10;
/** Dynamic segments are recomputed on the heartbeat when older than this. */
export const SEGMENT_REFRESH_INTERVAL_MS = 60 * 60 * 1000;
const REFRESH_BATCH = 20;

export interface SegmentEntry {
  studioId: string;
  segmentId: string;
  contactId: string;
  enteredAt: Date;
}

export type SegmentEntryHandler = (entries: SegmentEntry[]) => Promise<void>;

const SAMPLE_SELECT = { id: true, firstName: true, lastName: true, lifecycleStage: true, tags: true } satisfies Prisma.ContactSelect;

function toSample(c: Prisma.ContactGetPayload<{ select: typeof SAMPLE_SELECT }>): SegmentContactSampleDTO {
  return { id: c.id, fullName: contactDisplayName(c), lifecycleStage: c.lifecycleStage, tags: c.tags };
}

export function toSegmentDto(s: Segment): SegmentDTO {
  return {
    id: s.id,
    name: s.name,
    description: s.description,
    kind: s.kind,
    rules: (s.rules as SegmentGroup | null) ?? null,
    cachedCount: s.cachedCount,
    refreshedAt: s.refreshedAt?.toISOString() ?? null,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

/**
 * Segments (section 3.5). Every query is scoped by the studio from the
 * tenant guard; rule JSON is validated with the shared schema and the
 * tenant's custom field kinds before it is stored or evaluated. Dynamic
 * segments keep their current members in segment_members; the diff of each
 * refresh is what the journey engine's segment_entered trigger listens to.
 */
@Injectable()
export class SegmentsService {
  private readonly logger = new Logger(SegmentsService.name);
  private readonly entryHandlers: SegmentEntryHandler[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly evaluator: SegmentEvaluatorService,
  ) {}

  onEntries(handler: SegmentEntryHandler): void {
    this.entryHandlers.push(handler);
  }

  async list(studioId: string): Promise<SegmentDTO[]> {
    const rows = await this.prisma.segment.findMany({ where: { studioId, archivedAt: null }, orderBy: { createdAt: 'desc' } });
    return rows.map(toSegmentDto);
  }

  async get(studioId: string, id: string): Promise<Segment> {
    const row = await this.prisma.segment.findFirst({ where: { id, studioId, archivedAt: null } });
    if (!row) throw new NotFoundException(apiError('apiErrors.growth.segmentNotFound'));
    return row;
  }

  async fieldCatalogue(studioId: string): Promise<SegmentFieldCatalogueDTO> {
    const defs = await this.prisma.contactFieldDefinition.findMany({
      where: { studioId, isArchived: false },
      orderBy: [{ sortOrder: 'asc' }, { key: 'asc' }],
    });
    return {
      groups: SEGMENT_FIELD_GROUPS.map((g) => ({
        key: g.key,
        fields: g.fields.map((field) => ({
          field,
          kind: SEGMENT_FIELDS[field] as SegmentFieldKind,
          available: !(field in UNAVAILABLE_SEGMENT_FIELDS),
        })),
      })),
      custom: defs.map((d) => ({
        field: `custom.${d.key}`,
        kind: d.kind as SegmentFieldKind,
        label: (d.label ?? {}) as Record<string, string>,
        options: d.options,
      })),
    };
  }

  async preview(studioId: string, rawRules: unknown, now = new Date()): Promise<SegmentPreviewDTO> {
    const rules = await this.evaluator.validate(studioId, rawRules);
    const where = await this.evaluator.where(studioId, rules, now);
    const [count, sample] = await Promise.all([
      this.prisma.contact.count({ where }),
      this.prisma.contact.findMany({ where, select: SAMPLE_SELECT, orderBy: { createdAt: 'desc' }, take: SAMPLE_SIZE }),
    ]);
    return { count, sample: sample.map(toSample) };
  }

  async create(studioId: string, membershipId: string | null, input: CreateSegmentInput): Promise<SegmentDTO> {
    const rules = input.rules ? await this.evaluator.validate(studioId, input.rules) : null;
    const segment = await this.prisma.segment.create({
      data: {
        studioId,
        name: input.name,
        description: input.description ?? null,
        kind: input.kind,
        rules: rules ? (rules as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
        createdByMembershipId: membershipId,
      },
    });
    if (segment.kind === 'DYNAMIC' || (input.seedFromRules && rules)) {
      await this.refresh(segment, new Date(), { seedStatic: true });
    }
    return toSegmentDto(await this.get(studioId, segment.id));
  }

  async update(studioId: string, id: string, input: UpdateSegmentInput): Promise<SegmentDTO> {
    const segment = await this.get(studioId, id);
    const rules = input.rules ? await this.evaluator.validate(studioId, input.rules) : undefined;
    const updated = await this.prisma.segment.update({
      where: { id: segment.id },
      data: {
        name: input.name,
        description: input.description,
        ...(rules ? { rules: rules as unknown as Prisma.InputJsonValue } : {}),
      },
    });
    if (rules && updated.kind === 'DYNAMIC') await this.refresh(updated, new Date());
    return toSegmentDto(await this.get(studioId, id));
  }

  /** Archives the segment; refused while a draft, scheduled, sending, pending-approval or paused campaign or a live journey uses it. */
  async archive(studioId: string, id: string): Promise<{ archived: true }> {
    const segment = await this.get(studioId, id);
    const campaigns = await this.prisma.campaign.count({ where: { studioId, segmentId: segment.id, status: { in: ['DRAFT', 'SCHEDULED', 'SENDING', 'PENDING_APPROVAL', 'PAUSED'] } } });
    const journeys = await this.prisma.journey.findMany({ where: { studioId, status: { in: ['ACTIVE', 'PAUSED'] } }, select: { definition: true } });
    const usedByJourney = journeys.some((j) => JSON.stringify(j.definition).includes(segment.id));
    if (campaigns > 0 || usedByJourney) throw new ConflictException(apiError('apiErrors.growth.segmentUsedCampaignJourney'));
    await this.prisma.segment.update({ where: { id: segment.id }, data: { archivedAt: new Date() } });
    return { archived: true };
  }

  async contacts(studioId: string, id: string, query: SegmentContactsQuery): Promise<SegmentContactsDTO> {
    const segment = await this.get(studioId, id);
    const where: Prisma.ContactWhereInput = { studioId, mergedIntoId: null, segmentMemberships: { some: { segmentId: segment.id } } };
    const [total, items] = await Promise.all([
      this.prisma.contact.count({ where }),
      this.prisma.contact.findMany({
        where,
        select: SAMPLE_SELECT,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
    ]);
    return { items: items.map(toSample), total, page: query.page, limit: query.limit };
  }

  /** STATIC segments only: add or remove contacts of this studio by hand. */
  async updateMembers(studioId: string, id: string, input: SegmentMembersInput): Promise<SegmentDTO> {
    const segment = await this.get(studioId, id);
    if (segment.kind !== 'STATIC') throw new BadRequestException(apiError('apiErrors.growth.contactsCanOnlyAddedManuallyStatic'));
    const owned = input.add.length
      ? await this.prisma.contact.findMany({ where: { id: { in: input.add }, studioId, mergedIntoId: null }, select: { id: true } })
      : [];
    if (owned.length !== new Set(input.add).size) throw new BadRequestException(apiError('apiErrors.growth.contactsNotFoundBusiness'));
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.segmentMember.createMany({
        data: owned.map((c) => ({ segmentId: segment.id, contactId: c.id, studioId, enteredAt: now, addedManually: true })),
        skipDuplicates: true,
      }),
      this.prisma.segmentMember.deleteMany({ where: { segmentId: segment.id, studioId, contactId: { in: input.remove } } }),
    ]);
    const count = await this.prisma.segmentMember.count({ where: { segmentId: segment.id } });
    await this.prisma.segment.update({ where: { id: segment.id }, data: { cachedCount: count, refreshedAt: now } });
    const added = owned.map((c) => ({ studioId, segmentId: segment.id, contactId: c.id, enteredAt: now }));
    await this.notifyEntries(added);
    return toSegmentDto(await this.get(studioId, id));
  }

  async refreshById(studioId: string, id: string, now = new Date()): Promise<SegmentDTO> {
    const segment = await this.get(studioId, id);
    if (segment.kind === 'DYNAMIC') await this.refresh(segment, now);
    return toSegmentDto(await this.get(studioId, id));
  }

  /** Current member ids (campaign audience). Dynamic segments are recomputed first. */
  async memberIds(studioId: string, id: string, now = new Date()): Promise<string[]> {
    const segment = await this.get(studioId, id);
    if (segment.kind === 'DYNAMIC') await this.refresh(segment, now);
    const rows = await this.prisma.segmentMember.findMany({
      where: { segmentId: segment.id, studioId, contact: { mergedIntoId: null } },
      select: { contactId: true },
    });
    return rows.map((r) => r.contactId);
  }

  /** Heartbeat: recompute stale dynamic segments (every studio, bounded per run). */
  async refreshStale(now = new Date()): Promise<{ refreshed: number; entered: number }> {
    const stale = await this.prisma.segment.findMany({
      where: {
        kind: 'DYNAMIC',
        archivedAt: null,
        OR: [{ refreshedAt: null }, { refreshedAt: { lt: new Date(now.getTime() - SEGMENT_REFRESH_INTERVAL_MS) } }],
      },
      orderBy: { refreshedAt: { sort: 'asc', nulls: 'first' } },
      take: REFRESH_BATCH,
    });
    let entered = 0;
    for (const segment of stale) {
      try {
        entered += await this.refresh(segment, now);
      } catch (err) {
        this.logger.warn(`Segment ${segment.id} refresh failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return { refreshed: stale.length, entered };
  }

  /**
   * Recomputes one dynamic segment: inserts newcomers (enteredAt = now),
   * removes leavers, stores the count, and hands the newcomers to the
   * segment_entered listeners. Returns the number of newcomers.
   */
  async refresh(segment: Segment, now: Date, opts: { seedStatic?: boolean } = {}): Promise<number> {
    if (!segment.rules) return 0;
    if (segment.kind === 'STATIC' && !opts.seedStatic) return 0;
    const rules = await this.evaluator.validate(segment.studioId, segment.rules);
    const ids = await this.evaluator.contactIds(segment.studioId, rules, now);
    const current = new Set(
      (await this.prisma.segmentMember.findMany({ where: { segmentId: segment.id }, select: { contactId: true } })).map((m) => m.contactId),
    );
    const next = new Set(ids);
    const newcomers = ids.filter((id) => !current.has(id));
    const leavers = segment.kind === 'DYNAMIC' ? [...current].filter((id) => !next.has(id)) : [];
    await this.prisma.$transaction([
      this.prisma.segmentMember.createMany({
        data: newcomers.map((contactId) => ({ segmentId: segment.id, contactId, studioId: segment.studioId, enteredAt: now })),
        skipDuplicates: true,
      }),
      this.prisma.segmentMember.deleteMany({ where: { segmentId: segment.id, contactId: { in: leavers } } }),
      this.prisma.segment.update({
        where: { id: segment.id },
        data: { cachedCount: segment.kind === 'DYNAMIC' ? next.size : current.size + newcomers.length, refreshedAt: now },
      }),
    ]);
    await this.notifyEntries(newcomers.map((contactId) => ({ studioId: segment.studioId, segmentId: segment.id, contactId, enteredAt: now })));
    return newcomers.length;
  }

  private async notifyEntries(entries: SegmentEntry[]): Promise<void> {
    if (!entries.length) return;
    for (const handler of this.entryHandlers) {
      try {
        await handler(entries);
      } catch (err) {
        this.logger.warn(`Segment entry handler failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
}
