import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import * as bcrypt from 'bcrypt';
import { PrismaClient } from '@platform/database';
import { COMMUNITY_SHARE_TOKEN_PATTERN, DEFAULT_ROLE_TEMPLATES, resolvePermissions } from '@platform/shared';
import { AppModule } from '../../src/app.module';

/**
 * G5b community feed and access tiers end to end (docs/TOPLULUK.md):
 * tier enforcement against real package states (active, frozen, expired,
 * none), staff permissions, comments, likes and moderation, the public
 * share link, tenant isolation and restricted mode.
 *
 * Everything lives in rows named "E2E topluluk"/"E2E katman", users with
 * the +90539444 prefix and a throwaway studio e2e-community-*; afterAll
 * removes them, so the suite passes twice in a row on the same database.
 */

const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Demo1234!';
const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.now();
const OWNER_PHONE = '+905321000002';
const RECEPTION_PHONE = '+905321000003';
const TRAINER_PHONE = '+905321000004';
const FLOW_OWNER_PHONE = '+905321000022';
const PREFIX = '+90539444';
const SLUG = 'e2e-community-';
const POST_PREFIX = 'E2E topluluk';
const TIER_PREFIX = 'E2E katman';

interface FeedItem {
  id: string;
  title: string;
  likedByMe: boolean;
  likeCount: number;
  commentCount: number;
  video: { isLocked: boolean; sourceUrl: string | null } | null;
}

describe('Community G5b (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let server: Parameters<typeof request>[0];

  let ZEN: string;
  let FLOW: string;
  let T: string;
  let ownerToken: string;
  let receptionToken: string;
  let trainerToken: string;
  let flowOwnerToken: string;
  let withPkgToken: string;
  let noPkgToken: string;
  let frozenToken: string;
  let expiredToken: string;
  let tOwnerToken: string;
  let tMemberToken: string;

  let packageDefinitionId: string;
  let tierId: string;
  let openPostId: string;
  let tierPostId: string;
  let draftPostId: string;
  let videoId: string;
  let tPostId: string;

  const login = async (p: string) => {
    const res = await request(server).post('/auth/login').send({ emailOrPhone: p, password: DEMO_PASSWORD });
    expect(res.status).toBe(200);
    return res.body.accessToken as string;
  };
  const as = (token: string, studioId: string) => ({
    get: (url: string) => request(server).get(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId),
    post: (url: string) => request(server).post(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId),
    put: (url: string) => request(server).put(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId),
    patch: (url: string) => request(server).patch(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId),
    delete: (url: string) => request(server).delete(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId),
  });
  const staff = (studioId: string) => `/studios/${studioId}/community`;
  const self = (studioId: string) => `/studios/${studioId}/community/self`;
  const feedTitles = async (token: string) => {
    const res = await as(token, ZEN).get(`${self(ZEN)}/feed?pageSize=50`);
    expect(res.status).toBe(200);
    return (res.body.items as FeedItem[]).filter((p) => p.title.startsWith(POST_PREFIX)).map((p) => p.title);
  };
  const feedItem = async (token: string, id: string) => {
    const res = await as(token, ZEN).get(`${self(ZEN)}/feed?pageSize=50`);
    return (res.body.items as FeedItem[]).find((p) => p.id === id);
  };

  let phoneSeq = 0;
  const phone = () => `${PREFIX}${String(++phoneSeq).padStart(4, '0')}`;

  async function addUser(studioId: string, roleKey: string, passwordHash: string, withProfile: boolean) {
    const p = phone();
    const role = await prisma.roleTemplate.findUniqueOrThrow({ where: { studioId_key: { studioId, key: roleKey } } });
    const user = await prisma.user.create({ data: { phone: p, firstName: 'Topluluk', lastName: `Uye${phoneSeq}`, passwordHash, phoneVerifiedAt: new Date() } });
    const membership = await prisma.membership.create({ data: { userId: user.id, studioId, roleTemplateId: role.id, status: 'ACTIVE', joinedAt: new Date() } });
    const profile = withProfile ? await prisma.memberProfile.create({ data: { membershipId: membership.id, studioId } }) : null;
    return { phone: p, membershipId: membership.id, memberProfileId: profile?.id ?? null };
  }

  async function sellPackage(memberId: string, status: 'ACTIVE' | 'FROZEN', endDate: Date) {
    await prisma.memberPackage.create({
      data: { studioId: ZEN, memberId, packageDefinitionId, entitlementKind: 'TIME_UNLIMITED', status, endDate, frozenUntil: status === 'FROZEN' ? endDate : null },
    });
  }

  async function cleanup() {
    const zenAndFlow = { studioId: { in: [ZEN, FLOW] } };
    await prisma.communityPost.deleteMany({ where: { ...zenAndFlow, title: { startsWith: POST_PREFIX } } });
    await prisma.accessTier.deleteMany({ where: { ...zenAndFlow, name: { startsWith: TIER_PREFIX } } });
    await prisma.auditLog.deleteMany({ where: { ...zenAndFlow, action: { startsWith: 'community.' } } });
    await prisma.videoContent.deleteMany({ where: { studioId: ZEN, title: { startsWith: POST_PREFIX } } });
    await prisma.memberPackage.deleteMany({ where: { studioId: ZEN, packageDefinition: { name: { startsWith: POST_PREFIX } } } });
    await prisma.packageDefinition.deleteMany({ where: { studioId: ZEN, name: { startsWith: POST_PREFIX } } });
    await prisma.studio.deleteMany({ where: { slug: { startsWith: SLUG } } });
    await prisma.membership.deleteMany({ where: { user: { phone: { startsWith: PREFIX } } } });
    await prisma.user.deleteMany({ where: { phone: { startsWith: PREFIX } } });
  }

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer();
    prisma = new PrismaClient();

    ZEN = (await prisma.studio.findUniqueOrThrow({ where: { slug: 'zen-reformer-pilates' } })).id;
    FLOW = (await prisma.studio.findUniqueOrThrow({ where: { slug: 'flow-pilates-wellness' } })).id;
    await cleanup();

    const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 4);
    packageDefinitionId = (
      await prisma.packageDefinition.create({
        data: { studioId: ZEN, name: `${POST_PREFIX} paketi`, entitlementKind: 'TIME_UNLIMITED', validityDays: 30, price: 1 },
      })
    ).id;

    const withPkg = await addUser(ZEN, 'member', passwordHash, true);
    const noPkg = await addUser(ZEN, 'member', passwordHash, true);
    const frozen = await addUser(ZEN, 'member', passwordHash, true);
    const expired = await addUser(ZEN, 'member', passwordHash, true);
    await sellPackage(withPkg.memberProfileId as string, 'ACTIVE', new Date(NOW + 30 * DAY));
    await sellPackage(frozen.memberProfileId as string, 'FROZEN', new Date(NOW + 30 * DAY));
    await sellPackage(expired.memberProfileId as string, 'ACTIVE', new Date(NOW - DAY));

    // A throwaway tenant for restricted mode, with the default role templates.
    T = (await prisma.studio.create({ data: { name: 'E2E Topluluk', slug: `${SLUG}${NOW}` } })).id;
    for (const role of DEFAULT_ROLE_TEMPLATES) {
      await prisma.roleTemplate.create({
        data: {
          studioId: T,
          key: role.key,
          name: role.name,
          isOwner: role.isOwner,
          isSystem: true,
          permissions: { create: resolvePermissions(role).map((permissionKey) => ({ permissionKey })) },
        },
      });
    }
    const tOwner = await addUser(T, 'owner', passwordHash, false);
    const tMember = await addUser(T, 'member', passwordHash, true);
    tPostId = (
      await prisma.communityPost.create({
        data: { studioId: T, type: 'POST', status: 'PUBLISHED', title: `${POST_PREFIX} kisitli`, publishedAt: new Date() },
      })
    ).id;

    [ownerToken, receptionToken, trainerToken, flowOwnerToken] = await Promise.all([
      login(OWNER_PHONE),
      login(RECEPTION_PHONE),
      login(TRAINER_PHONE),
      login(FLOW_OWNER_PHONE),
    ]);
    [withPkgToken, noPkgToken, frozenToken, expiredToken, tOwnerToken, tMemberToken] = await Promise.all([
      login(withPkg.phone),
      login(noPkg.phone),
      login(frozen.phone),
      login(expired.phone),
      login(tOwner.phone),
      login(tMember.phone),
    ]);
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
    await app.close();
  });

  describe('access tiers', () => {
    it('the owner creates a tier from a package definition of the studio', async () => {
      const res = await as(ownerToken, ZEN)
        .post(`${staff(ZEN)}/tiers`)
        .send({ name: `${TIER_PREFIX} paket`, rules: [{ kind: 'PACKAGE_DEFINITION', packageDefinitionId }] });
      expect(res.status).toBe(201);
      expect(res.body.rules).toEqual([{ kind: 'PACKAGE_DEFINITION', packageDefinitionId, packageDefinitionName: `${POST_PREFIX} paketi` }]);
      tierId = res.body.id;
    });

    it('refuses a package of another studio and a package rule without a package', async () => {
      const flowPackage = await prisma.packageDefinition.findFirstOrThrow({ where: { studioId: FLOW } });
      const foreign = await as(ownerToken, ZEN)
        .post(`${staff(ZEN)}/tiers`)
        .send({ name: `${TIER_PREFIX} yabanci`, rules: [{ kind: 'PACKAGE_DEFINITION', packageDefinitionId: flowPackage.id }] });
      expect(foreign.status).toBe(400);
      expect(foreign.body.code).toBe('COMMUNITY_PACKAGE_NOT_FOUND');
      const missing = await as(ownerToken, ZEN).post(`${staff(ZEN)}/tiers`).send({ name: `${TIER_PREFIX} eksik`, rules: [{ kind: 'PACKAGE_DEFINITION' }] });
      expect(missing.status).toBe(400);
    });

    it('reception and trainers can list tiers but not create them', async () => {
      expect((await as(receptionToken, ZEN).get(`${staff(ZEN)}/tiers`)).status).toBe(200);
      expect((await as(trainerToken, ZEN).get(`${staff(ZEN)}/tiers`)).status).toBe(200);
      const denied = await as(receptionToken, ZEN).post(`${staff(ZEN)}/tiers`).send({ name: `${TIER_PREFIX} x`, rules: [{ kind: 'ACTIVE_MEMBER' }] });
      expect(denied.status).toBe(403);
    });
  });

  describe('posts and tier enforcement', () => {
    it('the owner creates and publishes posts; reception and trainers cannot write', async () => {
      const open = await as(ownerToken, ZEN).post(`${staff(ZEN)}/posts`).send({ type: 'ANNOUNCEMENT', title: `${POST_PREFIX} herkese`, body: 'Duyuru metni' });
      expect(open.status).toBe(201);
      expect(open.body).toMatchObject({ status: 'DRAFT', tiers: [], shareToken: null });
      openPostId = open.body.id;
      const tiered = await as(ownerToken, ZEN).post(`${staff(ZEN)}/posts`).send({ type: 'POST', title: `${POST_PREFIX} paketliler`, tierIds: [tierId] });
      expect(tiered.status).toBe(201);
      expect(tiered.body.tiers).toEqual([{ id: tierId, name: `${TIER_PREFIX} paket` }]);
      tierPostId = tiered.body.id;
      const draft = await as(ownerToken, ZEN).post(`${staff(ZEN)}/posts`).send({ type: 'POST', title: `${POST_PREFIX} taslak` });
      draftPostId = draft.body.id;

      for (const id of [openPostId, tierPostId]) {
        const res = await as(ownerToken, ZEN).post(`${staff(ZEN)}/posts/${id}/publish`);
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('PUBLISHED');
        expect(res.body.publishedAt).toBeTruthy();
      }

      expect((await as(receptionToken, ZEN).post(`${staff(ZEN)}/posts`).send({ type: 'POST', title: `${POST_PREFIX} r` })).status).toBe(403);
      expect((await as(trainerToken, ZEN).post(`${staff(ZEN)}/posts`).send({ type: 'POST', title: `${POST_PREFIX} t` })).status).toBe(403);
      expect((await as(trainerToken, ZEN).post(`${staff(ZEN)}/posts/${draftPostId}/publish`)).status).toBe(403);
      expect((await as(withPkgToken, ZEN).get(`${staff(ZEN)}/posts`)).status).toBe(403);
    });

    it('staff with community.view list every post, drafts included', async () => {
      for (const token of [ownerToken, receptionToken, trainerToken]) {
        const res = await as(token, ZEN).get(`${staff(ZEN)}/posts?pageSize=50`);
        expect(res.status).toBe(200);
        const ids = (res.body.items as { id: string }[]).map((p) => p.id);
        expect(ids).toEqual(expect.arrayContaining([openPostId, tierPostId, draftPostId]));
      }
    });

    it('a member only sees the tiered post with an ACTIVE, unexpired package of the tier', async () => {
      expect(await feedTitles(withPkgToken)).toEqual(expect.arrayContaining([`${POST_PREFIX} herkese`, `${POST_PREFIX} paketliler`]));
      for (const token of [noPkgToken, frozenToken, expiredToken]) {
        const titles = await feedTitles(token);
        expect(titles).toContain(`${POST_PREFIX} herkese`);
        expect(titles).not.toContain(`${POST_PREFIX} paketliler`);
      }
      // Drafts never reach any feed.
      for (const token of [withPkgToken, ownerToken]) expect(await feedTitles(token)).not.toContain(`${POST_PREFIX} taslak`);
    });

    it('a post outside the tier is a 404 for every direct read and write', async () => {
      expect((await as(noPkgToken, ZEN).get(`${self(ZEN)}/posts/${tierPostId}`)).status).toBe(404);
      expect((await as(noPkgToken, ZEN).get(`${self(ZEN)}/posts/${tierPostId}/comments`)).status).toBe(404);
      expect((await as(noPkgToken, ZEN).post(`${self(ZEN)}/posts/${tierPostId}/comments`).send({ body: 'Merhaba' })).status).toBe(404);
      expect((await as(noPkgToken, ZEN).put(`${self(ZEN)}/posts/${tierPostId}/like`)).status).toBe(404);
      expect((await as(withPkgToken, ZEN).get(`${self(ZEN)}/posts/${draftPostId}`)).status).toBe(404);
      expect((await as(withPkgToken, ZEN).get(`${self(ZEN)}/posts/${tierPostId}`)).status).toBe(200);
    });

    it('staff with community.view read every published post in the feed without a package', async () => {
      expect(await feedTitles(ownerToken)).toEqual(expect.arrayContaining([`${POST_PREFIX} herkese`, `${POST_PREFIX} paketliler`]));
      expect(await feedTitles(trainerToken)).toContain(`${POST_PREFIX} paketliler`);
    });

    it('a tier still used by a post cannot be deleted', async () => {
      const inUse = await as(ownerToken, ZEN).delete(`${staff(ZEN)}/tiers/${tierId}`);
      expect(inUse.status).toBe(409);
      expect(inUse.body.code).toBe('COMMUNITY_TIER_IN_USE');
    });

    it('a VIDEO post needs a video of the studio, and the video library rules still apply', async () => {
      const bad = await as(ownerToken, ZEN).post(`${staff(ZEN)}/posts`).send({ type: 'VIDEO', title: `${POST_PREFIX} video eksik` });
      expect(bad.status).toBe(400);
      videoId = (
        await prisma.videoContent.create({
          data: {
            studioId: ZEN,
            title: `${POST_PREFIX} video`,
            durationSeconds: 60,
            sourceUrl: 'https://video.example.com/e2e',
            visibility: 'SPECIFIC_PACKAGES',
            isPublished: true,
            publishedAt: new Date(),
            packages: { create: [{ packageDefinitionId }] },
          },
        })
      ).id;
      const post = await as(ownerToken, ZEN).post(`${staff(ZEN)}/posts`).send({ type: 'VIDEO', title: `${POST_PREFIX} video`, videoContentId: videoId });
      expect(post.status).toBe(201);
      await as(ownerToken, ZEN).post(`${staff(ZEN)}/posts/${post.body.id}/publish`).expect(200);

      const locked = await feedItem(noPkgToken, post.body.id);
      expect(locked?.video).toMatchObject({ isLocked: true, sourceUrl: null });
      const unlocked = await feedItem(withPkgToken, post.body.id);
      expect(unlocked?.video).toMatchObject({ isLocked: false, sourceUrl: 'https://video.example.com/e2e' });
    });
  });

  describe('comments and likes', () => {
    let memberCommentId: string;

    it('members like idempotently and unlike', async () => {
      const like = await as(withPkgToken, ZEN).put(`${self(ZEN)}/posts/${openPostId}/like`);
      expect(like.status).toBe(200);
      expect(like.body).toEqual({ liked: true, likeCount: 1 });
      expect((await as(withPkgToken, ZEN).put(`${self(ZEN)}/posts/${openPostId}/like`)).body).toEqual({ liked: true, likeCount: 1 });
      expect((await as(noPkgToken, ZEN).put(`${self(ZEN)}/posts/${openPostId}/like`)).body).toEqual({ liked: true, likeCount: 2 });
      expect((await feedItem(withPkgToken, openPostId))?.likedByMe).toBe(true);
      expect((await as(noPkgToken, ZEN).delete(`${self(ZEN)}/posts/${openPostId}/like`)).body).toEqual({ liked: false, likeCount: 1 });
    });

    it('members comment in plain text within the length limit', async () => {
      const res = await as(withPkgToken, ZEN).post(`${self(ZEN)}/posts/${openPostId}/comments`).send({ body: '  <b>Tesekkurler</b>  ' });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ body: '<b>Tesekkurler</b>', isMine: true, isHidden: false });
      memberCommentId = res.body.id;
      expect((await as(withPkgToken, ZEN).post(`${self(ZEN)}/posts/${openPostId}/comments`).send({ body: 'x'.repeat(1001) })).status).toBe(400);
      expect((await as(withPkgToken, ZEN).post(`${self(ZEN)}/posts/${openPostId}/comments`).send({ body: '   ' })).status).toBe(400);

      const others = await as(noPkgToken, ZEN).get(`${self(ZEN)}/posts/${openPostId}/comments`);
      const seen = (others.body.items as { id: string; authorName: string; isMine: boolean }[]).find((c) => c.id === memberCommentId);
      expect(seen?.isMine).toBe(false);
      // Other members see a first name and last initial only.
      expect(seen?.authorName).toMatch(/^Topluluk U\.$/);
      expect((await feedItem(noPkgToken, openPostId))?.commentCount).toBe(1);
    });

    it('only the author deletes a comment through the member endpoint', async () => {
      const other = await as(noPkgToken, ZEN).post(`${self(ZEN)}/posts/${openPostId}/comments`).send({ body: 'Silinecek yorum' });
      expect((await as(withPkgToken, ZEN).delete(`${self(ZEN)}/comments/${other.body.id}`)).status).toBe(403);
      expect((await as(noPkgToken, ZEN).delete(`${self(ZEN)}/comments/${other.body.id}`)).status).toBe(204);
      expect((await as(noPkgToken, ZEN).delete(`${self(ZEN)}/comments/${other.body.id}`)).status).toBe(404);
    });

    it('reception hides and shows a comment; trainers cannot moderate', async () => {
      expect((await as(trainerToken, ZEN).post(`${staff(ZEN)}/comments/${memberCommentId}/hide`)).status).toBe(403);
      const hidden = await as(receptionToken, ZEN).post(`${staff(ZEN)}/comments/${memberCommentId}/hide`);
      expect(hidden.status).toBe(200);
      expect(hidden.body.isHidden).toBe(true);

      const memberView = await as(withPkgToken, ZEN).get(`${self(ZEN)}/posts/${openPostId}/comments`);
      expect((memberView.body.items as { id: string }[]).map((c) => c.id)).not.toContain(memberCommentId);
      const staffView = await as(trainerToken, ZEN).get(`${staff(ZEN)}/posts/${openPostId}/comments`);
      expect((staffView.body.items as { id: string; isHidden: boolean }[]).find((c) => c.id === memberCommentId)?.isHidden).toBe(true);
      const post = await as(ownerToken, ZEN).get(`${staff(ZEN)}/posts/${openPostId}`);
      expect(post.body).toMatchObject({ commentCount: 0, hiddenCommentCount: 1 });

      expect((await as(receptionToken, ZEN).post(`${staff(ZEN)}/comments/${memberCommentId}/unhide`)).body.isHidden).toBe(false);
    });

    it('comments can be turned off per post', async () => {
      await as(ownerToken, ZEN).patch(`${staff(ZEN)}/posts/${openPostId}`).send({ commentsEnabled: false }).expect(200);
      const res = await as(withPkgToken, ZEN).post(`${self(ZEN)}/posts/${openPostId}/comments`).send({ body: 'Kapali' });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('COMMUNITY_COMMENTS_DISABLED');
      await as(ownerToken, ZEN).patch(`${staff(ZEN)}/posts/${openPostId}`).send({ commentsEnabled: true }).expect(200);
    });

    it('a moderator deletes a comment', async () => {
      expect((await as(receptionToken, ZEN).delete(`${staff(ZEN)}/comments/${memberCommentId}`)).status).toBe(204);
      const view = await as(ownerToken, ZEN).get(`${staff(ZEN)}/posts/${openPostId}/comments`);
      expect((view.body.items as { id: string }[]).map((c) => c.id)).not.toContain(memberCommentId);
    });
  });

  describe('public share link', () => {
    let firstToken: string;

    it('only a published post can be shared, with an unguessable token', async () => {
      const draft = await as(ownerToken, ZEN).post(`${staff(ZEN)}/posts/${draftPostId}/share`);
      expect(draft.status).toBe(409);
      expect(draft.body.code).toBe('COMMUNITY_POST_NOT_PUBLISHED');
      expect((await as(receptionToken, ZEN).post(`${staff(ZEN)}/posts/${openPostId}/share`)).status).toBe(403);

      const on = await as(ownerToken, ZEN).post(`${staff(ZEN)}/posts/${openPostId}/share`);
      expect(on.status).toBe(200);
      firstToken = on.body.shareToken;
      expect(firstToken).toMatch(COMMUNITY_SHARE_TOKEN_PATTERN);
      expect((await as(ownerToken, ZEN).post(`${staff(ZEN)}/posts/${openPostId}/share`)).body.shareToken).toBe(firstToken);
    });

    it('the public view is read-only: no comments, likes, author or token', async () => {
      const res = await request(server).get(`/public/community/posts/${firstToken}`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ title: `${POST_PREFIX} herkese`, body: 'Duyuru metni', type: 'ANNOUNCEMENT' });
      expect(Object.keys(res.body).sort()).toEqual(['attachmentName', 'attachmentUrl', 'body', 'publishedAt', 'studioName', 'title', 'type', 'video']);
      expect((await request(server).post(`/public/community/posts/${firstToken}`).send({})).status).toBe(404);
      expect((await request(server).get('/public/community/posts/short')).status).toBe(404);
      expect((await request(server).get(`/public/community/posts/${'A'.repeat(43)}`)).status).toBe(404);
    });

    it('revoking kills the link; turning it on again issues a new token; archiving turns it off', async () => {
      const off = await as(ownerToken, ZEN).delete(`${staff(ZEN)}/posts/${openPostId}/share`);
      expect(off.status).toBe(200);
      expect(off.body.shareToken).toBeNull();
      expect((await request(server).get(`/public/community/posts/${firstToken}`)).status).toBe(404);

      const again = await as(ownerToken, ZEN).post(`${staff(ZEN)}/posts/${openPostId}/share`);
      expect(again.body.shareToken).not.toBe(firstToken);
      expect((await request(server).get(`/public/community/posts/${again.body.shareToken}`)).status).toBe(200);

      const archived = await as(ownerToken, ZEN).post(`${staff(ZEN)}/posts/${openPostId}/archive`);
      expect(archived.body).toMatchObject({ status: 'ARCHIVED', shareToken: null });
      expect((await request(server).get(`/public/community/posts/${again.body.shareToken}`)).status).toBe(404);
      expect(await feedTitles(noPkgToken)).not.toContain(`${POST_PREFIX} herkese`);
    });
  });

  describe('tenant isolation', () => {
    it('another studio cannot read or change this studio posts', async () => {
      expect((await as(flowOwnerToken, ZEN).get(`${staff(ZEN)}/posts`)).status).toBe(403);
      expect((await as(flowOwnerToken, FLOW).get(`${staff(FLOW)}/posts/${tierPostId}`)).status).toBe(404);
      expect((await as(flowOwnerToken, FLOW).patch(`${staff(FLOW)}/posts/${tierPostId}`).send({ pinned: true })).status).toBe(404);
      expect((await as(flowOwnerToken, FLOW).post(`${staff(FLOW)}/posts/${tierPostId}/share`)).status).toBe(404);
      expect((await as(flowOwnerToken, FLOW).get(`${self(FLOW)}/posts/${tierPostId}`)).status).toBe(404);
      const flowList = await as(flowOwnerToken, FLOW).get(`${staff(FLOW)}/posts?pageSize=50`);
      expect((flowList.body.items as { id: string }[]).map((p) => p.id)).not.toContain(tierPostId);
      // A header naming another studio than the path is refused by the tenant guard.
      expect((await as(ownerToken, FLOW).get(`${staff(ZEN)}/posts`)).status).toBe(403);
    });

    it('a member of one studio cannot read another studio feed', async () => {
      expect((await as(withPkgToken, FLOW).get(`${self(FLOW)}/feed`)).status).toBe(403);
    });

    it('a tier, comment or video of another studio cannot be used', async () => {
      const tier = await as(flowOwnerToken, FLOW).post(`${staff(FLOW)}/posts`).send({ type: 'POST', title: `${POST_PREFIX} flow`, tierIds: [tierId] });
      expect(tier.status).toBe(400);
      expect(tier.body.code).toBe('COMMUNITY_TIER_NOT_FOUND');
      const video = await as(flowOwnerToken, FLOW).post(`${staff(FLOW)}/posts`).send({ type: 'VIDEO', title: `${POST_PREFIX} flow video`, videoContentId: videoId });
      expect(video.status).toBe(400);
      expect(video.body.code).toBe('COMMUNITY_VIDEO_NOT_FOUND');
      const comment = await as(withPkgToken, ZEN).post(`${self(ZEN)}/posts/${tierPostId}/comments`).send({ body: 'Paketli yorum' });
      expect(comment.status).toBe(201);
      expect((await as(flowOwnerToken, FLOW).post(`${staff(FLOW)}/comments/${comment.body.id}/hide`)).status).toBe(404);
      expect((await as(flowOwnerToken, FLOW).delete(`${staff(FLOW)}/tiers/${tierId}`)).status).toBe(400);
    });
  });

  describe('restricted mode', () => {
    it('blocks community writes of a restricted tenant but keeps reads', async () => {
      await prisma.studio.update({ where: { id: T }, data: { billingStatus: 'RESTRICTED' } });
      const create = await as(tOwnerToken, T).post(`${staff(T)}/posts`).send({ type: 'POST', title: `${POST_PREFIX} yeni` });
      expect(create.status).toBe(403);
      expect(create.body.code).toBe('BILLING_RESTRICTED');
      expect((await as(tOwnerToken, T).get(`${staff(T)}/posts`)).status).toBe(200);
      expect((await as(tMemberToken, T).get(`${self(T)}/feed`)).status).toBe(200);
      const like = await as(tMemberToken, T).put(`${self(T)}/posts/${tPostId}/like`);
      expect(like.status).toBe(403);
      expect(like.body.code).toBe('BILLING_RESTRICTED');
      const comment = await as(tMemberToken, T).post(`${self(T)}/posts/${tPostId}/comments`).send({ body: 'Merhaba' });
      expect(comment.body.code).toBe('BILLING_RESTRICTED');
    });
  });

  describe('default permissions', () => {
    it('owner, reception and trainer role templates carry the community keys', async () => {
      const roles = await prisma.roleTemplate.findMany({ where: { studioId: ZEN, key: { in: ['owner', 'reception', 'trainer'] } }, include: { permissions: true } });
      const keys = (key: string) => roles.find((r) => r.key === key)?.permissions.map((p) => p.permissionKey) ?? [];
      expect(keys('owner')).toEqual(expect.arrayContaining(['community.view', 'community.manage', 'community.moderate']));
      expect(keys('reception')).toEqual(expect.arrayContaining(['community.view', 'community.moderate']));
      expect(keys('reception')).not.toContain('community.manage');
      expect(keys('trainer')).toContain('community.view');
      expect(keys('trainer')).not.toContain('community.moderate');
    });
  });
});
