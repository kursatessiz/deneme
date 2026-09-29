import { Injectable } from '@nestjs/common';
import { Prisma } from '@platform/database';
import { communityDisplayName } from '@platform/shared';
import type { CommunityCommentDTO, CommunityCommentListQuery, CommunityLikeResultDTO, CreateCommunityCommentInput } from '@platform/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { TenantContext } from '../auth/tenant-context';
import { CommunityAccessService } from './community-access.service';
import type { CommunityAccess } from './community-access.service';
import { VISIBLE_COMMENT } from './community-posts.service';
import { communityError } from './community.errors';

const COMMENT_INCLUDE = {
  author: { select: { user: { select: { firstName: true, lastName: true } } } },
} satisfies Prisma.CommunityCommentInclude;

type CommentRow = Prisma.CommunityCommentGetPayload<{ include: typeof COMMENT_INCLUDE }>;

/**
 * Comments and likes (G5b, docs/TOPLULUK.md). A caller can only read,
 * comment on and like posts the access resolver lets them see. Comment
 * bodies are stored and returned as plain text; clients render them as
 * text, never as HTML.
 */
@Injectable()
export class CommunityInteractionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: CommunityAccessService,
  ) {}

  // ---------------------------------------------------------------------------
  // Self service
  // ---------------------------------------------------------------------------

  async listComments(tenant: TenantContext, postId: string, query: CommunityCommentListQuery): Promise<CommunityCommentDTO[]> {
    const access = await this.access.resolve(tenant);
    await this.visiblePost(access, postId);
    const rows = await this.prisma.communityComment.findMany({
      where: { studioId: access.studioId, postId, ...(access.seesEverything ? { deletedAt: null } : VISIBLE_COMMENT) },
      include: COMMENT_INCLUDE,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    });
    return rows.map((row) => toCommentDTO(row, access.membershipId, access.seesEverything));
  }

  async addComment(tenant: TenantContext, postId: string, input: CreateCommunityCommentInput): Promise<CommunityCommentDTO> {
    const access = await this.access.resolve(tenant);
    const membershipId = requireMembership(access);
    const post = await this.visiblePost(access, postId);
    if (!post.commentsEnabled) throw communityError('COMMUNITY_COMMENTS_DISABLED');
    const row = await this.prisma.communityComment.create({
      data: { studioId: access.studioId, postId, authorMembershipId: membershipId, body: input.body },
      include: COMMENT_INCLUDE,
    });
    return toCommentDTO(row, membershipId, access.seesEverything);
  }

  /** The author removes their own comment (soft delete). */
  async deleteOwnComment(tenant: TenantContext, commentId: string): Promise<void> {
    const access = await this.access.resolve(tenant);
    const membershipId = requireMembership(access);
    const comment = await this.prisma.communityComment.findFirst({ where: { id: commentId, studioId: access.studioId, deletedAt: null } });
    if (!comment) throw communityError('COMMUNITY_COMMENT_NOT_FOUND');
    await this.visiblePost(access, comment.postId, 'COMMUNITY_COMMENT_NOT_FOUND');
    if (comment.authorMembershipId !== membershipId) throw communityError('COMMUNITY_NOT_COMMENT_AUTHOR');
    await this.prisma.communityComment.update({ where: { id: comment.id }, data: { deletedAt: new Date() } });
  }

  /** Idempotent: liking twice keeps one like. */
  async like(tenant: TenantContext, postId: string): Promise<CommunityLikeResultDTO> {
    const access = await this.access.resolve(tenant);
    const membershipId = requireMembership(access);
    await this.visiblePost(access, postId);
    try {
      await this.prisma.communityReaction.create({ data: { studioId: access.studioId, postId, membershipId } });
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err;
    }
    return { liked: true, likeCount: await this.likeCount(access.studioId, postId) };
  }

  async unlike(tenant: TenantContext, postId: string): Promise<CommunityLikeResultDTO> {
    const access = await this.access.resolve(tenant);
    const membershipId = requireMembership(access);
    await this.visiblePost(access, postId);
    await this.prisma.communityReaction.deleteMany({ where: { studioId: access.studioId, postId, membershipId } });
    return { liked: false, likeCount: await this.likeCount(access.studioId, postId) };
  }

  // ---------------------------------------------------------------------------
  // Staff moderation
  // ---------------------------------------------------------------------------

  /** Every comment of a post in any status, hidden ones included (community.view). */
  async listForStaff(tenant: TenantContext, postId: string, query: CommunityCommentListQuery): Promise<CommunityCommentDTO[]> {
    const post = await this.prisma.communityPost.findFirst({ where: { id: postId, studioId: tenant.studioId }, select: { id: true } });
    if (!post) throw communityError('COMMUNITY_POST_NOT_FOUND');
    const rows = await this.prisma.communityComment.findMany({
      where: { studioId: tenant.studioId, postId, deletedAt: null },
      include: COMMENT_INCLUDE,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    });
    return rows.map((row) => toCommentDTO(row, tenant.membershipId, true));
  }

  async setHidden(tenant: TenantContext, userId: string, commentId: string, hidden: boolean): Promise<CommunityCommentDTO> {
    const comment = await this.prisma.communityComment.findFirst({ where: { id: commentId, studioId: tenant.studioId, deletedAt: null } });
    if (!comment) throw communityError('COMMUNITY_COMMENT_NOT_FOUND');
    const row = await this.prisma.communityComment.update({
      where: { id: comment.id },
      data: hidden ? { hiddenAt: comment.hiddenAt ?? new Date(), hiddenByMembershipId: tenant.membershipId } : { hiddenAt: null, hiddenByMembershipId: null },
      include: COMMENT_INCLUDE,
    });
    await this.audit(tenant, userId, hidden ? 'community.comment.hide' : 'community.comment.unhide', comment.id, { postId: comment.postId });
    return toCommentDTO(row, tenant.membershipId, true);
  }

  async moderatorDelete(tenant: TenantContext, userId: string, commentId: string): Promise<void> {
    const comment = await this.prisma.communityComment.findFirst({ where: { id: commentId, studioId: tenant.studioId, deletedAt: null } });
    if (!comment) throw communityError('COMMUNITY_COMMENT_NOT_FOUND');
    await this.prisma.communityComment.update({ where: { id: comment.id }, data: { deletedAt: new Date() } });
    await this.audit(tenant, userId, 'community.comment.delete', comment.id, { postId: comment.postId });
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /** The post if the caller may see it; otherwise the same 404 as a missing post. */
  private async visiblePost(access: CommunityAccess, postId: string, notFound: 'COMMUNITY_POST_NOT_FOUND' | 'COMMUNITY_COMMENT_NOT_FOUND' = 'COMMUNITY_POST_NOT_FOUND') {
    const post = await this.prisma.communityPost.findFirst({
      where: { AND: [{ id: postId }, this.access.visiblePostsWhere(access)] },
      select: { id: true, commentsEnabled: true },
    });
    if (!post) throw communityError(notFound);
    return post;
  }

  private likeCount(studioId: string, postId: string): Promise<number> {
    return this.prisma.communityReaction.count({ where: { studioId, postId } });
  }

  private audit(tenant: TenantContext, userId: string, action: string, entityId: string, metadata: Prisma.InputJsonObject) {
    return this.prisma.auditLog.create({ data: { studioId: tenant.studioId, userId, action, entityType: 'CommunityComment', entityId, metadata } });
  }
}

/** Comments and likes belong to a membership; a super admin acting on a studio has none. */
function requireMembership(access: CommunityAccess): string {
  if (!access.membershipId) throw communityError('COMMUNITY_MEMBERS_ONLY');
  return access.membershipId;
}

/** Staff see full names; members see other people as first name and last initial. */
function toCommentDTO(row: CommentRow, viewerMembershipId: string | null, staffView: boolean): CommunityCommentDTO {
  const user = row.author?.user;
  const isMine = viewerMembershipId !== null && row.authorMembershipId === viewerMembershipId;
  let authorName = '';
  if (user) authorName = staffView || isMine ? `${user.firstName} ${user.lastName}`.trim() : communityDisplayName(user.firstName, user.lastName);
  return {
    id: row.id,
    postId: row.postId,
    body: row.body,
    authorName,
    isMine,
    isHidden: row.hiddenAt !== null,
    createdAt: row.createdAt.toISOString(),
  };
}
