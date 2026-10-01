import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { PrismaClient } from '@platform/database';
import { SEO_INDEXNOW_FLAG } from '@platform/shared';
import { AppModule } from '../../src/app.module';
import { IndexNowQueueService } from '../../src/modules/sites/indexnow/indexnow-queue.service';
import type { IndexNowJobData } from '../../src/modules/sites/indexnow/indexnow-queue.service';
import { IndexNowKeyService } from '../../src/modules/sites/indexnow/indexnow-key.service';

/**
 * S3: IndexNow notifications and search engine verification. Publishing or unpublishing a page and publishing
 * or archiving an article enqueues one IndexNow job only while the `seo.indexnow` flag is on; the verification
 * tokens of a site are validated, tenant-scoped and exposed through the public settings; the per-site key is
 * generated once and served by the public key endpoint.
 */

const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Demo1234!';
const SUPER_ADMIN_PHONE = '+905321000001';
const OWNER_PHONE = '+905321000002';
const TRAINER_PHONE = '+905321000004';
const FLOW_OWNER_PHONE = '+905321000022';
const ZEN_SLUG = 'zen-reformer-pilates';

class RecordingQueue {
  jobs: IndexNowJobData[] = [];
  readonly enabled = true;
  async enqueue(job: IndexNowJobData): Promise<void> {
    this.jobs.push(job);
  }
}

describe('Sites: IndexNow and search verification (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let server: ReturnType<INestApplication['getHttpServer']>;
  const queue = new RecordingQueue();
  let ZEN: string;
  let FLOW: string;
  let tokens: { superAdmin: string; owner: string; trainer: string; flowOwner: string };
  const suffix = Date.now().toString(36);
  const createdPageIds: string[] = [];
  const createdArticleIds: string[] = [];

  const login = async (phone: string) => {
    const res = await request(server).post('/auth/login').send({ emailOrPhone: phone, password: DEMO_PASSWORD });
    expect(res.status).toBe(200);
    return res.body.accessToken as string;
  };
  const as = (token: string, studioId: string) => ({
    get: (url: string) => request(server).get(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId),
    post: (url: string) => request(server).post(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId),
    put: (url: string) => request(server).put(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId),
    patch: (url: string) => request(server).patch(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId),
  });
  const setFlag = (enabled: boolean) =>
    request(server).post('/admin/feature-flags').set('Authorization', `Bearer ${tokens.superAdmin}`).send({ key: SEO_INDEXNOW_FLAG, scope: 'TENANT', studioId: ZEN, enabled });

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(IndexNowQueueService)
      .useValue(queue)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer();
    prisma = new PrismaClient();
    ZEN = (await prisma.studio.findUniqueOrThrow({ where: { slug: ZEN_SLUG } })).id;
    FLOW = (await prisma.studio.findUniqueOrThrow({ where: { slug: 'flow-pilates-wellness' } })).id;
    tokens = { superAdmin: await login(SUPER_ADMIN_PHONE), owner: await login(OWNER_PHONE), trainer: await login(TRAINER_PHONE), flowOwner: await login(FLOW_OWNER_PHONE) };
  });

  afterAll(async () => {
    await prisma.featureFlag.deleteMany({ where: { key: SEO_INDEXNOW_FLAG, studioId: ZEN } });
    if (createdPageIds.length) await prisma.page.deleteMany({ where: { id: { in: createdPageIds } } });
    if (createdArticleIds.length) await prisma.article.deleteMany({ where: { id: { in: createdArticleIds } } });
    const site = await prisma.site.findUnique({ where: { studioId: ZEN } });
    if (site) await prisma.site.update({ where: { id: site.id }, data: { seoSettings: {} } });
    await app.close();
    await prisma.$disconnect();
  });

  const hero = { config: {}, text: { tr: { title: 'Merhaba', subtitle: 'Alt' } } };
  const pageSlug = `s3-indexnow-${suffix}`;
  let pageId: string;
  const owner = () => as(tokens.owner, ZEN);

  it('does not enqueue anything while the flag is off (the default)', async () => {
    const created = await owner().post(`/sites/studio/${ZEN}/pages`).send({ kind: 'CUSTOM', internalLabel: `S3 indexnow ${suffix}` });
    expect(created.status).toBe(201);
    pageId = created.body.id as string;
    createdPageIds.push(pageId);
    await owner().put(`/sites/studio/${ZEN}/pages/${pageId}/locales/tr`).send({ slug: pageSlug, seoTitle: 'IndexNow' });
    await owner().put(`/sites/studio/${ZEN}/pages/${pageId}/blocks`).send([{ type: 'hero', position: 0, data: hero }]);
    expect((await owner().post(`/sites/studio/${ZEN}/pages/${pageId}/publish`)).status).toBe(201);
    expect((await owner().post(`/sites/studio/${ZEN}/pages/${pageId}/unpublish`)).status).toBe(201);
    expect(queue.jobs).toEqual([]);
  });

  it('enqueues one job per publish and unpublish once the super admin turns the flag on', async () => {
    expect((await setFlag(true)).status).toBeLessThan(300);
    expect((await owner().post(`/sites/studio/${ZEN}/pages/${pageId}/publish`)).status).toBe(201);
    await new Promise((r) => setTimeout(r, 150));
    expect(queue.jobs).toHaveLength(1);
    expect(queue.jobs[0].studioId).toBe(ZEN);
    expect(queue.jobs[0].urls).toHaveLength(1);
    const url = new URL(queue.jobs[0].urls[0]);
    expect(url.pathname).toBe(`/tr/${pageSlug}`);
    expect(url.hostname.startsWith(`${ZEN_SLUG}.`)).toBe(true);

    expect((await owner().post(`/sites/studio/${ZEN}/pages/${pageId}/unpublish`)).status).toBe(201);
    await new Promise((r) => setTimeout(r, 150));
    expect(queue.jobs).toHaveLength(2);
  });

  it('enqueues the article variants and the blog index on publish and archive', async () => {
    queue.jobs.length = 0;
    const created = await owner()
      .post(`/sites/studio/${ZEN}/articles`)
      .send({ authorName: 'Elif', tagIds: [], locales: [{ locale: 'tr', slug: `indexnow-yazi-${suffix}`, title: 'Yazi', body: 'Metin' }] });
    expect(created.status).toBe(201);
    const articleId = created.body.id as string;
    createdArticleIds.push(articleId);
    expect(queue.jobs).toEqual([]);

    expect((await owner().post(`/sites/studio/${ZEN}/articles/${articleId}/publish`)).status).toBe(201);
    await new Promise((r) => setTimeout(r, 150));
    expect(queue.jobs).toHaveLength(1);
    expect(queue.jobs[0].urls.map((u) => new URL(u).pathname)).toEqual([`/tr/blog/indexnow-yazi-${suffix}`, '/tr/blog']);

    expect((await owner().post(`/sites/studio/${ZEN}/articles/${articleId}/archive`)).status).toBe(201);
    await new Promise((r) => setTimeout(r, 150));
    expect(queue.jobs).toHaveLength(2);
  });

  it('stops enqueueing when the flag is turned off again', async () => {
    expect((await setFlag(false)).status).toBeLessThan(300);
    queue.jobs.length = 0;
    expect((await owner().post(`/sites/studio/${ZEN}/pages/${pageId}/publish`)).status).toBe(201);
    await new Promise((r) => setTimeout(r, 150));
    expect(queue.jobs).toEqual([]);
  });

  describe('verification tokens', () => {
    it('stores validated tokens per site and exposes them in the public settings', async () => {
      const bad = await owner().patch(`/sites/studio/${ZEN}`).send({ seo: { googleSiteVerification: '"><script>x</script>' } });
      expect(bad.status).toBe(400);
      const unknown = await owner().patch(`/sites/studio/${ZEN}`).send({ seo: { indexNowKey: 'a'.repeat(32) } });
      expect(unknown.status).toBe(400);

      const ok = await owner().patch(`/sites/studio/${ZEN}`).send({ seo: { googleSiteVerification: `g-token-${suffix}-abc`, bingSiteVerification: 'BING0123456789ABCDEF' } });
      expect(ok.status).toBe(200);
      expect(ok.body.seo).toEqual({ googleSiteVerification: `g-token-${suffix}-abc`, bingSiteVerification: 'BING0123456789ABCDEF' });
      expect((await owner().get(`/sites/studio/${ZEN}`)).body.seo.googleSiteVerification).toBe(`g-token-${suffix}-abc`);

      const pub = await request(server).get(`/public/sites/${ZEN_SLUG}/settings`);
      expect(pub.body).toMatchObject({ googleSiteVerification: `g-token-${suffix}-abc`, bingSiteVerification: 'BING0123456789ABCDEF' });

      // Another tenant's site is untouched.
      expect((await as(tokens.flowOwner, FLOW).get(`/sites/studio/${FLOW}`)).status).toBe(200);
      expect((await request(server).get('/public/sites/flow-pilates-wellness/settings')).body.googleSiteVerification).toBeNull();
    });

    it('keeps a field that is not sent and clears one that is sent empty', async () => {
      const res = await owner().patch(`/sites/studio/${ZEN}`).send({ seo: { bingSiteVerification: '' } });
      expect(res.status).toBe(200);
      expect(res.body.seo).toEqual({ googleSiteVerification: `g-token-${suffix}-abc`, bingSiteVerification: null });
    });

    it('is refused without site.manage and across tenants', async () => {
      expect((await as(tokens.trainer, ZEN).patch(`/sites/studio/${ZEN}`).send({ seo: { googleSiteVerification: 'abcdefgh1234' } })).status).toBe(403);
      expect((await as(tokens.flowOwner, ZEN).patch(`/sites/studio/${ZEN}`).send({ seo: { googleSiteVerification: 'abcdefgh1234' } })).status).toBe(403);
    });

    it('lets the super admin manage the platform site the same way', async () => {
      const platform = (await prisma.studio.findUniqueOrThrow({ where: { slug: 'platform' } })).id;
      const res = await as(tokens.superAdmin, platform).patch(`/sites/studio/${platform}`).send({ seo: { googleSiteVerification: 'platform-google-0001' } });
      expect(res.status).toBe(200);
      expect((await request(server).get('/public/sites/platform/settings')).body.googleSiteVerification).toBe('platform-google-0001');
      await as(tokens.superAdmin, platform).patch(`/sites/studio/${platform}`).send({ seo: { googleSiteVerification: '' } });
      expect((await request(server).get('/public/sites/platform/settings')).body.googleSiteVerification).toBeNull();
    });
  });

  describe('IndexNow key', () => {
    it('is generated once per site and served by the public endpoint', async () => {
      await prisma.site.updateMany({ where: { studioId: ZEN }, data: { seoSettings: {} } });
      expect((await request(server).get(`/public/sites/${ZEN_SLUG}/indexnow-key`)).status).toBe(404);

      const keys = app.get(IndexNowKeyService);
      const [a, b] = await Promise.all([keys.ensureKey(ZEN), keys.ensureKey(ZEN)]);
      expect(a).toMatch(/^[a-f0-9]{32}$/);
      expect(b).toBe(a);
      expect(await keys.ensureKey(ZEN)).toBe(a);

      const res = await request(server).get(`/public/sites/${ZEN_SLUG}/indexnow-key`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ key: a });
      // A different site has its own key (none yet).
      expect((await request(server).get('/public/sites/flow-pilates-wellness/indexnow-key')).status).toBe(404);
      await as(tokens.flowOwner, FLOW).get(`/sites/studio/${FLOW}`);
      expect(await keys.ensureKey(FLOW)).not.toBe(a);
      await prisma.site.updateMany({ where: { studioId: FLOW }, data: { seoSettings: {} } });
    });

    it('survives a verification token update', async () => {
      const before = (await request(server).get(`/public/sites/${ZEN_SLUG}/indexnow-key`)).body.key as string;
      expect((await owner().patch(`/sites/studio/${ZEN}`).send({ seo: { googleSiteVerification: 'another-token-123' } })).status).toBe(200);
      expect((await request(server).get(`/public/sites/${ZEN_SLUG}/indexnow-key`)).body.key).toBe(before);
    });
  });
});
