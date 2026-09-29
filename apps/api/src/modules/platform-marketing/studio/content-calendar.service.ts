import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@platform/database';
import type { ContentCalendarItem } from '@platform/database';
import {
  isCalendarItemMovable,
  toDateOnly,
  type CalendarChannel,
  type CalendarOwnerDTO,
  type CalendarStatus,
  type ContentCalendarViewDTO,
  type ContentItemDTO,
  type ContentItemsQuery,
  type CreateContentItemInput,
  type UpdateContentItemInput,
} from '@platform/shared';
import { PrismaService } from '../../prisma/prisma.service';
import type { PlatformContext } from '../../auth/tenant-context';

const dayStart = (date: string) => new Date(`${date}T00:00:00.000Z`);

function fullName(user: { firstName: string; lastName: string }): string {
  return `${user.firstName} ${user.lastName}`.trim();
}

/**
 * Content calendar of the platform tenant (M2c): planned pieces of content on
 * a date, optionally linked to an AI studio draft and a campaign. Campaigns
 * of the platform tenant appear in the same view read-only. Only PLANNED,
 * DRAFTED and APPROVED items can be moved; nothing is ever sent or published
 * from the calendar.
 */
@Injectable()
export class ContentCalendarService {
  constructor(private readonly prisma: PrismaService) {}

  async list(platform: PlatformContext, query: ContentItemsQuery): Promise<ContentCalendarViewDTO> {
    const studioId = platform.platformStudioId;
    const from = dayStart(query.from);
    const toExclusive = new Date(dayStart(query.to).getTime() + 86_400_000);
    const [rows, campaigns] = await Promise.all([
      this.prisma.contentCalendarItem.findMany({
        where: {
          studioId,
          scheduledDate: { gte: from, lte: dayStart(query.to) },
          ...(query.status ? { status: query.status } : {}),
          ...(query.channel ? { channel: query.channel } : {}),
        },
        orderBy: [{ scheduledDate: 'asc' }, { createdAt: 'asc' }],
        take: 500,
      }),
      this.prisma.campaign.findMany({
        where: { studioId, scheduledAt: { gte: from, lt: toExclusive } },
        select: { id: true, name: true, status: true, channel: true, scheduledAt: true },
        orderBy: { scheduledAt: 'asc' },
        take: 200,
      }),
    ]);
    const owners = await this.ownerNames(rows.map((r) => r.ownerUserId));
    const posts = await this.socialPostIds(studioId, rows.map((r) => r.id));
    return {
      items: rows.map((r) => this.toDto(r, owners, posts.get(r.id) ?? null)),
      campaigns: campaigns.flatMap((c) =>
        c.scheduledAt ? [{ id: c.id, name: c.name, status: c.status, channel: c.channel, scheduledDate: toDateOnly(c.scheduledAt) }] : [],
      ),
    };
  }

  /** People who can own an item: the super admins and active platform members. */
  async owners(): Promise<CalendarOwnerDTO[]> {
    const users = await this.prisma.user.findMany({
      where: { OR: [{ isSuperAdmin: true }, { platformMembership: { is: { status: 'ACTIVE' } } }] },
      select: { id: true, firstName: true, lastName: true },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      take: 100,
    });
    return users.map((u) => ({ id: u.id, name: fullName(u) }));
  }

  async create(platform: PlatformContext, input: CreateContentItemInput): Promise<ContentItemDTO> {
    const studioId = platform.platformStudioId;
    await this.assertLinks(studioId, input);
    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.contentCalendarItem.create({
        data: {
          studioId,
          title: input.title,
          channel: input.channel,
          scheduledDate: dayStart(input.scheduledDate),
          status: input.status,
          draftId: input.draftId ?? null,
          campaignId: input.campaignId ?? null,
          ownerUserId: input.ownerUserId ?? null,
          notes: input.notes ?? null,
          createdByUserId: platform.userId,
        },
      });
      await this.audit(tx, platform, 'marketing.calendar.create', created.id, { channel: created.channel, date: input.scheduledDate });
      return created;
    });
    return this.toDto(row, await this.ownerNames([row.ownerUserId]), (await this.socialPostIds(studioId, [row.id])).get(row.id) ?? null);
  }

  async update(platform: PlatformContext, id: string, input: UpdateContentItemInput): Promise<ContentItemDTO> {
    const studioId = platform.platformStudioId;
    const existing = await this.prisma.contentCalendarItem.findFirst({ where: { id, studioId } });
    if (!existing) throw new NotFoundException('Takvim öğesi bulunamadı');
    const movesDate = input.scheduledDate !== undefined && input.scheduledDate !== toDateOnly(existing.scheduledDate);
    if (movesDate && !isCalendarItemMovable(existing.status as CalendarStatus)) {
      throw new ConflictException({ statusCode: 409, code: 'CALENDAR_ITEM_LOCKED', message: 'Gönderilmiş veya iptal edilmiş öğenin tarihi değiştirilemez' });
    }
    await this.assertLinks(studioId, input);
    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.contentCalendarItem.update({
        where: { id },
        data: {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.channel !== undefined ? { channel: input.channel } : {}),
          ...(input.scheduledDate !== undefined ? { scheduledDate: dayStart(input.scheduledDate) } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.draftId !== undefined ? { draftId: input.draftId } : {}),
          ...(input.campaignId !== undefined ? { campaignId: input.campaignId } : {}),
          ...(input.ownerUserId !== undefined ? { ownerUserId: input.ownerUserId } : {}),
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
        },
      });
      await this.audit(tx, platform, movesDate ? 'marketing.calendar.move' : 'marketing.calendar.update', id, {
        from: toDateOnly(existing.scheduledDate),
        to: toDateOnly(updated.scheduledDate),
        status: updated.status,
      });
      return updated;
    });
    return this.toDto(row, await this.ownerNames([row.ownerUserId]), (await this.socialPostIds(studioId, [row.id])).get(row.id) ?? null);
  }

  async remove(platform: PlatformContext, id: string): Promise<{ deleted: true }> {
    const studioId = platform.platformStudioId;
    const existing = await this.prisma.contentCalendarItem.findFirst({ where: { id, studioId } });
    if (!existing) throw new NotFoundException('Takvim öğesi bulunamadı');
    await this.prisma.$transaction(async (tx) => {
      await tx.contentCalendarItem.delete({ where: { id } });
      await this.audit(tx, platform, 'marketing.calendar.delete', id, { title: existing.title });
    });
    return { deleted: true };
  }

  /** Drafts, campaigns and owners must belong to the platform tenant / the platform team. */
  private async assertLinks(studioId: string, input: { draftId?: string | null; campaignId?: string | null; ownerUserId?: string | null }): Promise<void> {
    if (input.draftId) {
      const draft = await this.prisma.marketingDraft.findFirst({ where: { id: input.draftId, studioId }, select: { id: true } });
      if (!draft) throw new BadRequestException({ statusCode: 400, code: 'CALENDAR_DRAFT_NOT_FOUND', message: 'Taslak bulunamadı' });
    }
    if (input.campaignId) {
      const campaign = await this.prisma.campaign.findFirst({ where: { id: input.campaignId, studioId }, select: { id: true } });
      if (!campaign) throw new BadRequestException({ statusCode: 400, code: 'CALENDAR_CAMPAIGN_NOT_FOUND', message: 'Kampanya bulunamadı' });
    }
    if (input.ownerUserId) {
      const owner = await this.prisma.user.findFirst({
        where: { id: input.ownerUserId, OR: [{ isSuperAdmin: true }, { platformMembership: { is: { status: 'ACTIVE' } } }] },
        select: { id: true },
      });
      if (!owner) throw new BadRequestException({ statusCode: 400, code: 'CALENDAR_OWNER_NOT_FOUND', message: 'Sorumlu kullanıcı bulunamadı' });
    }
  }

  private async ownerNames(ids: Array<string | null>): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((id): id is string => id !== null))];
    if (unique.length === 0) return new Map();
    const users = await this.prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, firstName: true, lastName: true } });
    return new Map(users.map((u) => [u.id, fullName(u)]));
  }

  /** The newest social post of each item (M4b); items without one are absent from the map. */
  private async socialPostIds(studioId: string, itemIds: string[]): Promise<Map<string, string>> {
    if (itemIds.length === 0) return new Map();
    const posts = await this.prisma.socialPost.findMany({
      where: { studioId, calendarItemId: { in: itemIds } },
      select: { id: true, calendarItemId: true },
      orderBy: { createdAt: 'asc' },
    });
    const map = new Map<string, string>();
    for (const post of posts) if (post.calendarItemId) map.set(post.calendarItemId, post.id);
    return map;
  }

  private toDto(row: ContentCalendarItem, owners: Map<string, string>, socialPostId: string | null): ContentItemDTO {
    return {
      id: row.id,
      title: row.title,
      channel: row.channel as CalendarChannel,
      scheduledDate: toDateOnly(row.scheduledDate),
      status: row.status,
      draftId: row.draftId,
      campaignId: row.campaignId,
      socialPostId,
      ownerUserId: row.ownerUserId,
      ownerName: row.ownerUserId ? (owners.get(row.ownerUserId) ?? null) : null,
      notes: row.notes,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private async audit(tx: Prisma.TransactionClient, platform: PlatformContext, action: string, entityId: string, metadata: Record<string, unknown>) {
    await tx.auditLog.create({
      data: {
        studioId: platform.platformStudioId,
        userId: platform.userId,
        action,
        entityType: 'ContentCalendarItem',
        entityId,
        metadata: metadata as Prisma.InputJsonValue,
      },
    });
  }
}
