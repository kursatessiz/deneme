import { Prisma, VideoContentVisibility } from '@platform/database';
import { COMMUNITY_SHARE_TOKEN_PATTERN } from '@platform/shared';
import type { PermissionKey } from '@platform/shared';
import type { TenantContext } from '../auth/tenant-context';
import { CommunityAccessService } from './community-access.service';
import { CommunityPostsService } from './community-posts.service';
import { CommunityInteractionsService } from './community-interactions.service';
import { AccessTiersService } from './access-tiers.service';

/* eslint-disable @typescript-eslint/no-explicit-any -- hand-rolled Prisma mocks */

const STUDIO = '11111111-1111-4111-8111-111111111111';
const POST = '22222222-2222-4222-8222-222222222222';

function tenant(permissions: PermissionKey[] = [], overrides: Partial<TenantContext> = {}): TenantContext {
  return {
    studioId: STUDIO,
    membershipId: 'membership-1',
    isOwner: false,
    isSuperAdmin: false,
    permissions: new Set(permissions),
    memberProfileId: 'member-1',
    trainerProfileId: null,
    branchIds: null,
    ...overrides,
  };
}

function staffRow(overrides: Record<string, unknown> = {}) {
  const now = new Date('2026-09-01T10:00:00Z');
  return {
    id: POST,
    studioId: STUDIO,
    type: 'POST',
    status: 'DRAFT',
    title: 'Baslik',
    body: '',
    videoContentId: null,
    attachmentUrl: null,
    attachmentName: null,
    pinned: false,
    commentsEnabled: true,
    authorMembershipId: 'membership-1',
    shareToken: null,
    publishedAt: null,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
    tiers: [],
    videoContent: null,
    author: { user: { firstName: 'Ada', lastName: 'Kaya' } },
    _count: { reactions: 0 },
    ...overrides,
  };
}

function makePrisma() {
  const prisma: any = {
    memberPackage: { findMany: jest.fn().mockResolvedValue([]) },
    communityPost: { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
    communityPostTier: { deleteMany: jest.fn(), createMany: jest.fn() },
    communityComment: { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn(), groupBy: jest.fn().mockResolvedValue([]) },
    communityReaction: { create: jest.fn(), deleteMany: jest.fn(), count: jest.fn().mockResolvedValue(1) },
    accessTier: { count: jest.fn(), findFirst: jest.fn(), delete: jest.fn(), create: jest.fn() },
    packageDefinition: { count: jest.fn() },
    videoContent: { findFirst: jest.fn() },
    auditLog: { create: jest.fn() },
  };
  prisma.$transaction = jest.fn(async (cb: (tx: unknown) => unknown) => cb(prisma));
  return prisma;
}

describe('CommunityPostsService', () => {
  let prisma: any;
  let service: CommunityPostsService;

  beforeEach(() => {
    prisma = makePrisma();
    service = new CommunityPostsService(prisma, new CommunityAccessService(prisma));
  });

  it('creates a post in the tenant studio with the caller as author, after checking tiers belong to the studio', async () => {
    prisma.accessTier.count.mockResolvedValue(1);
    prisma.communityPost.create.mockResolvedValue(staffRow());
    await service.create(tenant(['community.manage']), 'user-1', {
      type: 'POST',
      title: 'Baslik',
      body: '',
      videoContentId: null,
      attachmentUrl: null,
      attachmentName: null,
      pinned: false,
      commentsEnabled: true,
      tierIds: ['t-1', 't-1'],
    });
    expect(prisma.accessTier.count).toHaveBeenCalledWith({ where: { id: { in: ['t-1'] }, studioId: STUDIO } });
    const data = prisma.communityPost.create.mock.calls[0][0].data;
    expect(data.studioId).toBe(STUDIO);
    expect(data.authorMembershipId).toBe('membership-1');
    expect(data.tiers.create).toEqual([{ tierId: 't-1', studioId: STUDIO }]);
  });

  it('refuses a tier of another studio', async () => {
    prisma.accessTier.count.mockResolvedValue(0);
    await expect(
      service.create(tenant(['community.manage']), 'user-1', {
        type: 'POST',
        title: 'x',
        body: '',
        videoContentId: null,
        attachmentUrl: null,
        attachmentName: null,
        pinned: false,
        commentsEnabled: true,
        tierIds: ['foreign'],
      }),
    ).rejects.toMatchObject({ response: { code: 'COMMUNITY_TIER_NOT_FOUND' } });
    expect(prisma.communityPost.create).not.toHaveBeenCalled();
  });

  it('rejects an update that leaves a VIDEO post without a video', async () => {
    prisma.communityPost.findFirst.mockResolvedValue(staffRow({ type: 'POST' }));
    await expect(service.update(tenant(['community.manage']), 'user-1', POST, { type: 'VIDEO' })).rejects.toMatchObject({
      response: { code: 'COMMUNITY_POST_INVALID' },
    });
  });

  it('only shares a published post, with a 256-bit base64url token, and keeps an existing token', async () => {
    prisma.communityPost.findFirst.mockResolvedValueOnce(staffRow({ status: 'DRAFT' }));
    await expect(service.enableShare(tenant(['community.manage']), 'user-1', POST)).rejects.toMatchObject({
      response: { code: 'COMMUNITY_POST_NOT_PUBLISHED' },
    });

    prisma.communityPost.findFirst.mockResolvedValueOnce(staffRow({ status: 'PUBLISHED' }));
    const first = await service.enableShare(tenant(['community.manage']), 'user-1', POST);
    expect(first.shareToken).toMatch(COMMUNITY_SHARE_TOKEN_PATTERN);
    expect(Buffer.from(first.shareToken as string, 'base64url')).toHaveLength(32);

    prisma.communityPost.findFirst.mockResolvedValueOnce(staffRow({ status: 'PUBLISHED', shareToken: first.shareToken }));
    const again = await service.enableShare(tenant(['community.manage']), 'user-1', POST);
    expect(again.shareToken).toBe(first.shareToken);
    expect(prisma.communityPost.update).toHaveBeenCalledTimes(1);
  });

  it('archiving turns the share link off', async () => {
    prisma.communityPost.findFirst.mockResolvedValue(staffRow({ status: 'PUBLISHED', shareToken: 'x'.repeat(43) }));
    prisma.communityPost.update.mockResolvedValue(staffRow({ status: 'ARCHIVED' }));
    await service.archive(tenant(['community.manage']), 'user-1', POST);
    expect(prisma.communityPost.update.mock.calls[0][0].data).toMatchObject({ status: 'ARCHIVED', shareToken: null });
  });

  it('a malformed share token never reaches the database', async () => {
    await expect(service.getPublic('short')).rejects.toMatchObject({ response: { code: 'COMMUNITY_POST_NOT_FOUND' } });
    await expect(service.getPublic('../'.repeat(15))).rejects.toMatchObject({ response: { code: 'COMMUNITY_POST_NOT_FOUND' } });
    expect(prisma.communityPost.findFirst).not.toHaveBeenCalled();
  });

  it('the public view only matches a PUBLISHED post of an active studio and never exposes the video source', async () => {
    const token = 'a'.repeat(43);
    prisma.communityPost.findFirst.mockResolvedValue({
      ...staffRow({ status: 'PUBLISHED', type: 'VIDEO', publishedAt: new Date('2026-09-02T10:00:00Z') }),
      studio: { name: 'Isletme' },
      videoContent: { id: 'v-1', title: 'Video', durationSeconds: 60, thumbnailUrl: null },
    });
    const dto = await service.getPublic(token);
    expect(prisma.communityPost.findFirst.mock.calls[0][0].where).toEqual({ shareToken: token, status: 'PUBLISHED', studio: { isActive: true } });
    expect(dto.video).toEqual({ id: 'v-1', title: 'Video', durationSeconds: 60, thumbnailUrl: null });
    expect(dto).not.toHaveProperty('shareToken');
  });

  it('the feed hides a locked video source and marks the caller like', async () => {
    prisma.communityPost.findMany.mockResolvedValue([
      {
        ...staffRow({ status: 'PUBLISHED', type: 'VIDEO', publishedAt: new Date('2026-09-02T10:00:00Z') }),
        videoContent: {
          id: 'v-1',
          title: 'Video',
          durationSeconds: 60,
          thumbnailUrl: null,
          sourceUrl: 'https://video.example.com/x',
          visibility: VideoContentVisibility.SPECIFIC_PACKAGES,
          isPublished: true,
          packages: [{ packageDefinitionId: 'pd-1' }],
        },
        reactions: [{ id: 'r-1' }],
        _count: { reactions: 3 },
      },
    ]);
    const [item] = await service.feed(tenant(), { page: 1, pageSize: 20 });
    expect(item.video).toMatchObject({ isLocked: true, sourceUrl: null });
    expect(item.likedByMe).toBe(true);
    expect(item.likeCount).toBe(3);
    const where = prisma.communityPost.findMany.mock.calls[0][0].where;
    expect(where.studioId).toBe(STUDIO);
    expect(where.status).toBe('PUBLISHED');
  });
});

describe('CommunityInteractionsService', () => {
  let prisma: any;
  let service: CommunityInteractionsService;

  beforeEach(() => {
    prisma = makePrisma();
    service = new CommunityInteractionsService(prisma, new CommunityAccessService(prisma));
  });

  it('cannot comment on a post the caller cannot see (same 404 as a missing post)', async () => {
    prisma.communityPost.findFirst.mockResolvedValue(null);
    await expect(service.addComment(tenant(), POST, { body: 'Merhaba' })).rejects.toMatchObject({ response: { code: 'COMMUNITY_POST_NOT_FOUND' } });
    expect(prisma.communityComment.create).not.toHaveBeenCalled();
  });

  it('refuses comments when the post turned them off', async () => {
    prisma.communityPost.findFirst.mockResolvedValue({ id: POST, commentsEnabled: false });
    await expect(service.addComment(tenant(), POST, { body: 'Merhaba' })).rejects.toMatchObject({ response: { code: 'COMMUNITY_COMMENTS_DISABLED' } });
  });

  it('shows other members as first name and last initial, the author and staff the full name', async () => {
    prisma.communityPost.findFirst.mockResolvedValue({ id: POST, commentsEnabled: true });
    const row = (authorMembershipId: string) => ({
      id: `c-${authorMembershipId}`,
      postId: POST,
      authorMembershipId,
      body: '<b>duz metin</b>',
      hiddenAt: null,
      createdAt: new Date(),
      author: { user: { firstName: 'Deniz', lastName: 'Arslan' } },
    });
    prisma.communityComment.findMany.mockResolvedValue([row('membership-2'), row('membership-1')]);
    const items = await service.listComments(tenant(), POST, { page: 1, pageSize: 50 });
    expect(items.map((c) => c.authorName)).toEqual(['Deniz A.', 'Deniz Arslan']);
    expect(items[0].body).toBe('<b>duz metin</b>');
    expect(prisma.communityComment.findMany.mock.calls[0][0].where).toMatchObject({ studioId: STUDIO, deletedAt: null, hiddenAt: null });

    const staff = await service.listComments(tenant(['community.view'], { memberProfileId: null }), POST, { page: 1, pageSize: 50 });
    expect(staff[0].authorName).toBe('Deniz Arslan');
    expect(prisma.communityComment.findMany.mock.calls[1][0].where).not.toHaveProperty('hiddenAt');
  });

  it('only the author deletes their own comment', async () => {
    prisma.communityComment.findFirst.mockResolvedValue({ id: 'c-1', postId: POST, authorMembershipId: 'membership-2' });
    prisma.communityPost.findFirst.mockResolvedValue({ id: POST, commentsEnabled: true });
    await expect(service.deleteOwnComment(tenant(), 'c-1')).rejects.toMatchObject({ response: { code: 'COMMUNITY_NOT_COMMENT_AUTHOR' } });
    expect(prisma.communityComment.update).not.toHaveBeenCalled();
  });

  it('liking twice is idempotent', async () => {
    prisma.communityPost.findFirst.mockResolvedValue({ id: POST, commentsEnabled: true });
    prisma.communityReaction.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'test' }));
    await expect(service.like(tenant(), POST)).resolves.toEqual({ liked: true, likeCount: 1 });
  });

  it('a super admin without a membership cannot like or comment', async () => {
    await expect(service.like(tenant([], { isSuperAdmin: true, membershipId: null, memberProfileId: null }), POST)).rejects.toMatchObject({
      response: { code: 'COMMUNITY_MEMBERS_ONLY' },
    });
  });
});

describe('AccessTiersService', () => {
  let prisma: any;
  let service: AccessTiersService;

  beforeEach(() => {
    prisma = makePrisma();
    service = new AccessTiersService(prisma);
  });

  it('refuses to delete a tier that a post still uses', async () => {
    prisma.accessTier.findFirst.mockResolvedValue({ id: 't-1', name: 'Katman', _count: { posts: 2 } });
    await expect(service.remove(tenant(['community.manage']), 'user-1', 't-1')).rejects.toMatchObject({ response: { code: 'COMMUNITY_TIER_IN_USE' } });
    expect(prisma.accessTier.delete).not.toHaveBeenCalled();
  });

  it('refuses a package definition of another studio', async () => {
    prisma.packageDefinition.count.mockResolvedValue(0);
    await expect(
      service.create(tenant(['community.manage']), 'user-1', {
        name: 'Katman',
        description: null,
        rules: [{ kind: 'PACKAGE_DEFINITION', packageDefinitionId: '33333333-3333-4333-8333-333333333333' }],
      }),
    ).rejects.toMatchObject({ response: { code: 'COMMUNITY_PACKAGE_NOT_FOUND' } });
  });
});
