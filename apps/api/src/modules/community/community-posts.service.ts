import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@platform/database';
import { COMMUNITY_SHARE_TOKEN_BYTES, COMMUNITY_SHARE_TOKEN_PATTERN, communityPostShapeIssue } from '@platform/shared';
import type {
  CommunityFeedItemDTO,
  CommunityFeedQuery,
  CommunityPostDTO,
  CommunityPostListQuery,
  CommunityPostStatus,
  CommunityPostType,
  CommunityShareResultDTO,
  CreateCommunityPostInput,
  PublicCommunityPostDTO,
  UpdateCommunityPostInput,
} from '@platform/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { TenantContext } from '../auth/tenant-context';
import { CommunityAccessService } from './community-access.service';
import type { CommunityAccess } from './community-access.service';
import { communityError } from './community.errors';

const STAFF_INCLUDE = {
  tiers: { include: { tier: { select: { id: true, name: true } } } },
  videoContent: { select: { id: true, title: true, durationSeconds: true, thumbnailUrl: true } },
  author: { select: { user: { select: { firstName: true, lastName: true } } } },
  _count: { select: { reactions: true } },
} satisfies Prisma.CommunityPostInclude;

type StaffRow = Prisma.CommunityPostGetPayload<{ include: typeof STAFF_INCLUDE }>;

const FEED_ORDER: Prisma.CommunityPostOrderByWithRelationInput[] = [{ pinned: 'desc' }, { publishedAt: 'desc' }, { id: 'desc' }];

/** A comment members see: neither deleted nor hidden by a moderator. */
export const VISIBLE_COMMENT: Prisma.CommunityCommentWhereInput = { deletedAt: null, hiddenAt: null };

/** Feed rows: the video with what its lock needs, and only the caller's own like (for likedByMe). */
function feedInclude(access: CommunityAccess) {
  return {
    videoContent: {
      select: {
        id: true,
        title: true,
        durationSeconds: true,
        thumbnailUrl: true,
        sourceUrl: true,
        visibility: true,
        isPublished: true,
        packages: { select: { packageDefinitionId: true } },
      },
    },
    author: { select: { user: { select: { firstName: true, lastName: true } } } },
    _count: { select: { reactions: true } },
    reactions: {
      where: access.membershipId ? { membershipId: access.membershipId } : {},
      select: { id: true },
      take: access.membershipId ? 1 : 0,
    },
  } satisfies Prisma.CommunityPostInclude;
}

function fullName(user: { firstName: string; lastName: string } | undefined | null): string | null {
  if (!user) return null;
  return `${user.firstName} ${user.lastName}`.trim();
}

/**
 * Community posts (G5b, docs/TOPLULUK.md): staff authoring, the member
 * feed and the public share link. Who may read which post is decided only
 * by CommunityAccessService; every query is scoped to the tenant's studio.
 */
@Injectable()
export class CommunityPostsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: CommunityAccessService,
  ) {}

  // ---------------------------------------------------------------------------
  // Staff
  // ---------------------------------------------------------------------------

  async listForStaff(tenant: TenantContext, query: CommunityPostListQuery): Promise<CommunityPostDTO[]> {
    const rows = await this.prisma.communityPost.findMany({
      where: {
        studioId: tenant.studioId,
        ...(query.status ? { status: query.status } : {}),
        ...(query.type ? { type: query.type } : {}),
      },
      include: STAFF_INCLUDE,
      orderBy: [{ pinned: 'desc' }, { updatedAt: 'desc' }, { id: 'desc' }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    });
    return this.toStaffDTOs(tenant.studioId, rows);
  }

  async getForStaff(tenant: TenantContext, postId: string): Promise<CommunityPostDTO> {
    const row = await this.prisma.communityPost.findFirst({ where: { id: postId, studioId: tenant.studioId }, include: STAFF_INCLUDE });
    if (!row) throw communityError('COMMUNITY_POST_NOT_FOUND');
    return (await this.toStaffDTOs(tenant.studioId, [row]))[0];
  }

  async create(tenant: TenantContext, userId: string, input: CreateCommunityPostInput): Promise<CommunityPostDTO> {
    const studioId = tenant.studioId;
    await this.assertReferences(studioId, input.videoContentId, input.tierIds);
    const row = await this.prisma.communityPost.create({
      data: {
        studioId,
        type: input.type,
        title: input.title,
        body: input.body,
        videoContentId: input.videoContentId,
        attachmentUrl: input.attachmentUrl,
        attachmentName: input.attachmentUrl ? input.attachmentName || null : null,
        pinned: input.pinned,
        commentsEnabled: input.commentsEnabled,
        authorMembershipId: tenant.membershipId,
        tiers: { create: [...new Set(input.tierIds)].map((tierId) => ({ tierId, studioId })) },
      },
      include: STAFF_INCLUDE,
    });
    await this.audit(tenant, userId, 'community.post.create', row.id, { type: row.type });
    return (await this.toStaffDTOs(studioId, [row]))[0];
  }

  async update(tenant: TenantContext, userId: string, postId: string, input: UpdateCommunityPostInput): Promise<CommunityPostDTO> {
    const studioId = tenant.studioId;
    const existing = await this.prisma.communityPost.findFirst({ where: { id: postId, studioId } });
    if (!existing) throw communityError('COMMUNITY_POST_NOT_FOUND');

    const merged = {
      type: (input.type ?? existing.type) as CommunityPostType,
      videoContentId: input.videoContentId !== undefined ? input.videoContentId : existing.videoContentId,
      attachmentUrl: input.attachmentUrl !== undefined ? input.attachmentUrl : existing.attachmentUrl,
    };
    if (communityPostShapeIssue(merged)) throw communityError('COMMUNITY_POST_INVALID');
    await this.assertReferences(studioId, input.videoContentId ?? null, input.tierIds ?? []);

    const row = await this.prisma.$transaction(async (tx) => {
      if (input.tierIds) {
        await tx.communityPostTier.deleteMany({ where: { postId, studioId } });
        await tx.communityPostTier.createMany({ data: [...new Set(input.tierIds)].map((tierId) => ({ postId, tierId, studioId })) });
      }
      return tx.communityPost.update({
        where: { id: postId },
        data: {
          ...(input.type !== undefined ? { type: input.type } : {}),
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.body !== undefined ? { body: input.body } : {}),
          ...(input.videoContentId !== undefined ? { videoContentId: input.videoContentId } : {}),
          ...(input.attachmentUrl !== undefined ? { attachmentUrl: input.attachmentUrl } : {}),
          ...(input.attachmentName !== undefined ? { attachmentName: input.attachmentName || null } : {}),
          ...(merged.attachmentUrl === null ? { attachmentName: null } : {}),
          ...(input.pinned !== undefined ? { pinned: input.pinned } : {}),
          ...(input.commentsEnabled !== undefined ? { commentsEnabled: input.commentsEnabled } : {}),
        },
        include: STAFF_INCLUDE,
      });
    });
    await this.audit(tenant, userId, 'community.post.update', postId, { fields: Object.keys(input) });
    return (await this.toStaffDTOs(studioId, [row]))[0];
  }

  /** DRAFT or ARCHIVED -> PUBLISHED. The first publication date is kept on a re-publish. */
  async publish(tenant: TenantContext, userId: string, postId: string): Promise<CommunityPostDTO> {
    const existing = await this.findOwn(tenant, postId);
    const row = await this.prisma.communityPost.update({
      where: { id: existing.id },
      data: { status: 'PUBLISHED' satisfies CommunityPostStatus, publishedAt: existing.publishedAt ?? new Date(), archivedAt: null },
      include: STAFF_INCLUDE,
    });
    await this.audit(tenant, userId, 'community.post.publish', postId, {});
    return (await this.toStaffDTOs(tenant.studioId, [row]))[0];
  }

  /** Hides the post from every member and turns its share link off. */
  async archive(tenant: TenantContext, userId: string, postId: string): Promise<CommunityPostDTO> {
    const existing = await this.findOwn(tenant, postId);
    const row = await this.prisma.communityPost.update({
      where: { id: existing.id },
      data: { status: 'ARCHIVED' satisfies CommunityPostStatus, archivedAt: new Date(), shareToken: null },
      include: STAFF_INCLUDE,
    });
    await this.audit(tenant, userId, 'community.post.archive', postId, {});
    return (await this.toStaffDTOs(tenant.studioId, [row]))[0];
  }

  /**
   * Turns the public share link on for a published post. Idempotent: an
   * existing token is kept (revoke first to get a new one). The token is
   * 256 bits from the CSPRNG, base64url.
   */
  async enableShare(tenant: TenantContext, userId: string, postId: string): Promise<CommunityShareResultDTO> {
    const existing = await this.findOwn(tenant, postId);
    if (existing.status !== 'PUBLISHED') throw communityError('COMMUNITY_POST_NOT_PUBLISHED');
    if (existing.shareToken) return { shareToken: existing.shareToken };
    const shareToken = randomBytes(COMMUNITY_SHARE_TOKEN_BYTES).toString('base64url');
    await this.prisma.communityPost.update({ where: { id: existing.id }, data: { shareToken } });
    await this.audit(tenant, userId, 'community.post.share', postId, {});
    return { shareToken };
  }

  async revokeShare(tenant: TenantContext, userId: string, postId: string): Promise<CommunityShareResultDTO> {
    const existing = await this.findOwn(tenant, postId);
    if (existing.shareToken) {
      await this.prisma.communityPost.update({ where: { id: existing.id }, data: { shareToken: null } });
      await this.audit(tenant, userId, 'community.post.unshare', postId, {});
    }
    return { shareToken: null };
  }

  // ---------------------------------------------------------------------------
  // Feed (members, and staff who see everything)
  // ---------------------------------------------------------------------------

  async feed(tenant: TenantContext, query: CommunityFeedQuery): Promise<CommunityFeedItemDTO[]> {
    const access = await this.access.resolve(tenant);
    const rows = await this.prisma.communityPost.findMany({
      where: { ...this.access.visiblePostsWhere(access), ...(query.type ? { type: query.type } : {}) },
      include: feedInclude(access),
      orderBy: FEED_ORDER,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    });
    return this.toFeedDTOs(access, rows);
  }

  async getForFeed(tenant: TenantContext, postId: string): Promise<CommunityFeedItemDTO> {
    const access = await this.access.resolve(tenant);
    const row = await this.prisma.communityPost.findFirst({
      where: { AND: [{ id: postId }, this.access.visiblePostsWhere(access)] },
      include: feedInclude(access),
    });
    // Same 404 for "does not exist" and "not in your tier", so posts cannot be probed.
    if (!row) throw communityError('COMMUNITY_POST_NOT_FOUND');
    return (await this.toFeedDTOs(access, [row]))[0];
  }

  // ---------------------------------------------------------------------------
  // Public share link
  // ---------------------------------------------------------------------------

  async getPublic(token: string): Promise<PublicCommunityPostDTO> {
    if (!COMMUNITY_SHARE_TOKEN_PATTERN.test(token)) throw communityError('COMMUNITY_POST_NOT_FOUND');
    const row = await this.prisma.communityPost.findFirst({
      where: { shareToken: token, status: 'PUBLISHED', studio: { isActive: true } },
      include: {
        studio: { select: { name: true } },
        videoContent: { select: { id: true, title: true, durationSeconds: true, thumbnailUrl: true } },
      },
    });
    if (!row || !row.publishedAt) throw communityError('COMMUNITY_POST_NOT_FOUND');
    return {
      studioName: row.studio.name,
      type: row.type as CommunityPostType,
      title: row.title,
      body: row.body,
      // Summary only: the video's source link stays behind the library's own access rules.
      video: row.videoContent,
      attachmentUrl: row.attachmentUrl,
      attachmentName: row.attachmentName,
      publishedAt: row.publishedAt.toISOString(),
    };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async findOwn(tenant: TenantContext, postId: string) {
    const existing = await this.prisma.communityPost.findFirst({ where: { id: postId, studioId: tenant.studioId } });
    if (!existing) throw communityError('COMMUNITY_POST_NOT_FOUND');
    return existing;
  }

  private async assertReferences(studioId: string, videoContentId: string | null, tierIds: string[]): Promise<void> {
    if (videoContentId) {
      const video = await this.prisma.videoContent.findFirst({ where: { id: videoContentId, studioId }, select: { id: true } });
      if (!video) throw communityError('COMMUNITY_VIDEO_NOT_FOUND');
    }
    const ids = [...new Set(tierIds)];
    if (ids.length > 0) {
      const count = await this.prisma.accessTier.count({ where: { id: { in: ids }, studioId } });
      if (count !== ids.length) throw communityError('COMMUNITY_TIER_NOT_FOUND');
    }
  }

  private async toFeedDTOs(
    access: CommunityAccess,
    rows: Prisma.CommunityPostGetPayload<{ include: ReturnType<typeof feedInclude> }>[],
  ): Promise<CommunityFeedItemDTO[]> {
    const commentCounts = await this.commentCounts(access.studioId, rows.map((r) => r.id), VISIBLE_COMMENT);
    return rows.map((row) => {
      const video = row.videoContent;
      let videoDto: CommunityFeedItemDTO['video'] = null;
      if (video) {
        // An unpublished library item is treated as locked; otherwise the W19 rules decide.
        const locked = !video.isPublished || this.access.videoLock(video, access.activePackageDefinitionIds).locked;
        videoDto = {
          id: video.id,
          title: video.title,
          durationSeconds: video.durationSeconds,
          thumbnailUrl: video.thumbnailUrl,
          isLocked: locked,
          sourceUrl: locked ? null : video.sourceUrl,
        };
      }
      return {
        id: row.id,
        type: row.type as CommunityPostType,
        title: row.title,
        body: row.body,
        pinned: row.pinned,
        commentsEnabled: row.commentsEnabled,
        video: videoDto,
        attachmentUrl: row.attachmentUrl,
        attachmentName: row.attachmentName,
        authorName: fullName(row.author?.user),
        likeCount: row._count.reactions,
        commentCount: commentCounts.get(row.id) ?? 0,
        likedByMe: row.reactions.length > 0,
        publishedAt: (row.publishedAt ?? row.createdAt).toISOString(),
      };
    });
  }

  private async toStaffDTOs(studioId: string, rows: StaffRow[]): Promise<CommunityPostDTO[]> {
    const ids = rows.map((r) => r.id);
    const [visible, hidden] = await Promise.all([
      this.commentCounts(studioId, ids, VISIBLE_COMMENT),
      this.commentCounts(studioId, ids, { deletedAt: null, hiddenAt: { not: null } }),
    ]);
    return rows.map((row) => ({
      id: row.id,
      type: row.type as CommunityPostType,
      status: row.status as CommunityPostStatus,
      title: row.title,
      body: row.body,
      pinned: row.pinned,
      commentsEnabled: row.commentsEnabled,
      video: row.videoContent,
      attachmentUrl: row.attachmentUrl,
      attachmentName: row.attachmentName,
      tiers: row.tiers.map((t) => t.tier).sort((a, b) => a.name.localeCompare(b.name)),
      authorName: fullName(row.author?.user),
      shareToken: row.shareToken,
      likeCount: row._count.reactions,
      commentCount: visible.get(row.id) ?? 0,
      hiddenCommentCount: hidden.get(row.id) ?? 0,
      publishedAt: row.publishedAt?.toISOString() ?? null,
      archivedAt: row.archivedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));
  }

  private async commentCounts(studioId: string, postIds: string[], filter: Prisma.CommunityCommentWhereInput): Promise<Map<string, number>> {
    if (postIds.length === 0) return new Map();
    const groups = await this.prisma.communityComment.groupBy({
      by: ['postId'],
      where: { studioId, postId: { in: postIds }, ...filter },
      _count: { _all: true },
    });
    return new Map(groups.map((g) => [g.postId, g._count._all]));
  }

  private audit(tenant: TenantContext, userId: string, action: string, entityId: string, metadata: Prisma.InputJsonObject) {
    return this.prisma.auditLog.create({ data: { studioId: tenant.studioId, userId, action, entityType: 'CommunityPost', entityId, metadata } });
  }
}
