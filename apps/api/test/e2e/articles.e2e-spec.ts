import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { PrismaClient } from '@platform/database';
import { AppModule } from '../../src/app.module';

/**
 * S2b: blog articles on the page engine. Permissions and tenant isolation of
 * the article and tag routes, the lifecycle (draft, publish, archive, delete),
 * the public list/detail/tags/feed endpoints (only PUBLISHED, unknown slug 404,
 * RSS escaping) and the additive `articles` list of the sitemap entries.
 */

const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Demo1234!';
const SUPER_ADMIN_PHONE = '+905321000001';
const OWNER_PHONE = '+905321000002';
const TRAINER_PHONE = '+905321000004';
const FLOW_OWNER_PHONE = '+905321000022';
const ZEN_SLUG = 'zen-reformer-pilates';

describe('Sites: blog articles (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let server: ReturnType<INestApplication['getHttpServer']>;

  let ZEN: string;
  let FLOW: string;
  let PLATFORM: string;
  let ownerToken: string;
  let trainerToken: string;
  let flowOwnerToken: string;
  let superAdminToken: string;

  const suffix = Date.now().toString(36);
  const createdArticleIds: string[] = [];
  const createdTagIds: string[] = [];

  const login = async (phone: string) => {
    const res = await request(server).post('/auth/login').send({ emailOrPhone: phone, password: DEMO_PASSWORD });
    expect(res.status).toBe(200);
    return res.body.accessToken as string;
  };
  const as = (token: string, studioId: string) => ({
    get: (url: string) => request(server).get(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId),
    post: (url: string) => request(server).post(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId),
    patch: (url: string) => request(server).patch(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId),
    delete: (url: string) => request(server).delete(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId),
  });

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer();
    prisma = new PrismaClient();

    ZEN = (await prisma.studio.findUniqueOrThrow({ where: { slug: ZEN_SLUG } })).id;
    FLOW = (await prisma.studio.findUniqueOrThrow({ where: { slug: 'flow-pilates-wellness' } })).id;
    PLATFORM = (await prisma.studio.findUniqueOrThrow({ where: { slug: 'platform' } })).id;

    ownerToken = await login(OWNER_PHONE);
    trainerToken = await login(TRAINER_PHONE);
    flowOwnerToken = await login(FLOW_OWNER_PHONE);
    superAdminToken = await login(SUPER_ADMIN_PHONE);
  });

  afterAll(async () => {
    if (createdArticleIds.length) await prisma.article.deleteMany({ where: { id: { in: createdArticleIds } } });
    if (createdTagIds.length) await prisma.articleTag.deleteMany({ where: { id: { in: createdTagIds } } });
    await app.close();
    await prisma.$disconnect();
  });

  const zenSlug = `ilk-yazi-${suffix}`;
  let zenArticleId: string;
  let zenTagId: string;

  describe('permissions and tenant isolation', () => {
    it('denies staff without sites.articles.manage', async () => {
      const res = await as(trainerToken, ZEN).get(`/sites/studio/${ZEN}/articles`);
      expect(res.status).toBe(403);
    });

    it('lets the owner create a tag and a draft article', async () => {
      const tag = await as(ownerToken, ZEN).post(`/sites/studio/${ZEN}/article-tags`).send({ slug: `haber-${suffix}`, labels: { tr: 'Haber', en: 'News' } });
      expect(tag.status).toBe(201);
      zenTagId = tag.body.id;
      createdTagIds.push(zenTagId);

      const res = await as(ownerToken, ZEN)
        .post(`/sites/studio/${ZEN}/articles`)
        .send({
          authorName: 'Elif',
          tagIds: [zenTagId],
          locales: [
            { locale: 'tr', slug: zenSlug, title: 'Ilk yazi <b>&"kalin"</b>', body: '## Baslik\n\nMetin **kalin** ve [baglanti](https://example.com).\n\n- bir\n- iki' },
            { locale: 'en', slug: `first-post-${suffix}`, title: 'First post', body: 'Text' },
          ],
        });
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('DRAFT');
      expect(res.body.tagIds).toEqual([zenTagId]);
      expect(res.body.locales).toHaveLength(2);
      expect(res.body.locales[0].readingMinutes).toBe(1);
      zenArticleId = res.body.id;
      createdArticleIds.push(zenArticleId);
    });

    it('does not let another tenant read, edit, publish or delete it', async () => {
      const flow = as(flowOwnerToken, FLOW);
      expect((await flow.get(`/sites/studio/${FLOW}/articles/${zenArticleId}`)).status).toBe(404);
      expect((await flow.patch(`/sites/studio/${FLOW}/articles/${zenArticleId}`).send({ authorName: 'X' })).status).toBe(404);
      expect((await flow.post(`/sites/studio/${FLOW}/articles/${zenArticleId}/publish`)).status).toBe(404);
      expect((await flow.delete(`/sites/studio/${FLOW}/articles/${zenArticleId}`)).status).toBe(404);
      expect((await flow.patch(`/sites/studio/${FLOW}/article-tags/${zenTagId}`).send({ slug: 'x', labels: { tr: 'x' } })).status).toBe(404);

      const list = await flow.get(`/sites/studio/${FLOW}/articles`);
      expect(list.status).toBe(200);
      expect(list.body.items.some((a: { id: string }) => a.id === zenArticleId)).toBe(false);

      // Addressing tenant A's studio with tenant B's token is refused by the tenant guard.
      const crossed = await request(server).get(`/sites/studio/${ZEN}/articles`).set('Authorization', `Bearer ${flowOwnerToken}`).set('x-studio-id', ZEN);
      expect(crossed.status).toBe(403);

      // Another tenant's tag cannot be attached.
      const attach = await flow.post(`/sites/studio/${FLOW}/articles`).send({ authorName: 'Derya', tagIds: [zenTagId], locales: [{ locale: 'tr', slug: `flow-${suffix}`, title: 'T', body: 'B' }] });
      expect(attach.status).toBe(404);
      expect(attach.body.code).toBe('ARTICLE_TAG_NOT_FOUND');

      const unchanged = await prisma.article.findUniqueOrThrow({ where: { id: zenArticleId } });
      expect(unchanged.status).toBe('DRAFT');
      expect(unchanged.authorName).toBe('Elif');
    });

    it('rejects unsafe links and a duplicate slug', async () => {
      const unsafe = await as(ownerToken, ZEN)
        .post(`/sites/studio/${ZEN}/articles`)
        .send({ authorName: 'Elif', locales: [{ locale: 'tr', slug: `kotu-${suffix}`, title: 'T', body: '[x](javascript:alert)' }] });
      expect(unsafe.status).toBe(400);

      const duplicate = await as(ownerToken, ZEN)
        .post(`/sites/studio/${ZEN}/articles`)
        .send({ authorName: 'Elif', locales: [{ locale: 'tr', slug: zenSlug, title: 'T', body: 'B' }] });
      expect(duplicate.status).toBe(409);
      expect(duplicate.body.code).toBe('ARTICLE_SLUG_TAKEN');
    });
  });

  describe('public reads', () => {
    it('hides a draft from the public list, detail and feed', async () => {
      const list = await request(server).get(`/public/sites/${ZEN_SLUG}/articles`).query({ locale: 'tr' });
      expect(list.status).toBe(200);
      expect(list.body.items.some((a: { slug: string }) => a.slug === zenSlug)).toBe(false);
      const detail = await request(server).get(`/public/sites/${ZEN_SLUG}/articles/${zenSlug}`).query({ locale: 'tr' });
      expect(detail.status).toBe(404);
    });

    it('serves a published article in list, detail, tags, sitemap entries and the feed', async () => {
      const publish = await as(ownerToken, ZEN).post(`/sites/studio/${ZEN}/articles/${zenArticleId}/publish`);
      expect(publish.status).toBe(201);
      expect(publish.body.status).toBe('PUBLISHED');
      expect(publish.body.publishedAt).toBeTruthy();

      const list = await request(server).get(`/public/sites/${ZEN_SLUG}/articles`).query({ locale: 'tr' });
      const item = list.body.items.find((a: { slug: string }) => a.slug === zenSlug);
      expect(item).toMatchObject({ authorName: 'Elif', readingMinutes: 1, tags: [{ slug: `haber-${suffix}`, label: 'Haber' }] });
      expect(item.excerpt).toContain('Metin kalin ve baglanti');
      expect(list.body.site).toMatchObject({ siteKind: 'TENANT', studioSlug: ZEN_SLUG });
      expect(list.body.publishedLocales).toEqual(expect.arrayContaining(['tr', 'en']));

      const byTag = await request(server).get(`/public/sites/${ZEN_SLUG}/articles`).query({ locale: 'tr', tag: `haber-${suffix}` });
      expect(byTag.status).toBe(200);
      expect(byTag.body.tag).toEqual({ slug: `haber-${suffix}`, label: 'Haber' });
      expect(byTag.body.items.map((a: { slug: string }) => a.slug)).toEqual([zenSlug]);

      const paged = await request(server).get(`/public/sites/${ZEN_SLUG}/articles`).query({ locale: 'tr', pageSize: 1 });
      expect(paged.body.items).toHaveLength(1);
      expect(paged.body.total).toBeGreaterThanOrEqual(2); // the seeded tenant article and this one

      const detail = await request(server).get(`/public/sites/${ZEN_SLUG}/articles/${zenSlug}`).query({ locale: 'tr' });
      expect(detail.status).toBe(200);
      expect(detail.body.body).toContain('## Baslik');
      expect(detail.body.alternates).toEqual([
        { locale: 'en', slug: `first-post-${suffix}` },
        { locale: 'tr', slug: zenSlug },
      ]);

      const tags = await request(server).get(`/public/sites/${ZEN_SLUG}/article-tags`).query({ locale: 'en' });
      expect(tags.body.items).toContainEqual({ slug: `haber-${suffix}`, label: 'News', count: 1 });

      const sitemap = await request(server).get(`/public/sites/${ZEN_SLUG}/sitemap-entries`);
      expect(sitemap.status).toBe(200);
      expect(Array.isArray(sitemap.body.items)).toBe(true);
      const entries = sitemap.body.articles.filter((a: { articleId: string }) => a.articleId === zenArticleId);
      expect(entries.map((a: { locale: string }) => a.locale).sort()).toEqual(['en', 'tr']);

      const feed = await request(server).get(`/public/sites/${ZEN_SLUG}/feed/tr`);
      expect(feed.status).toBe(200);
      expect(feed.headers['content-type']).toContain('application/rss+xml');
      expect(feed.headers['cache-control']).toContain('max-age=300');
      expect(feed.text).toContain('<rss version="2.0"');
      // Tenant input is escaped, never emitted as markup.
      expect(feed.text).toContain('<title>Ilk yazi &lt;b&gt;&amp;&quot;kalin&quot;&lt;/b&gt;</title>');
      expect(feed.text).not.toContain('<b>');
      expect(feed.text).toContain(`/tr/blog/${zenSlug}</link>`);
    });

    it('drops an archived article from public reads, and only then allows deleting it', async () => {
      const del = await as(ownerToken, ZEN).delete(`/sites/studio/${ZEN}/articles/${zenArticleId}`);
      expect(del.status).toBe(409);
      expect(del.body.code).toBe('ARTICLE_NOT_DELETABLE');

      const archive = await as(ownerToken, ZEN).post(`/sites/studio/${ZEN}/articles/${zenArticleId}/archive`);
      expect(archive.body.status).toBe('ARCHIVED');
      expect((await request(server).get(`/public/sites/${ZEN_SLUG}/articles/${zenSlug}`).query({ locale: 'tr' })).status).toBe(404);
      const feed = await request(server).get(`/public/sites/${ZEN_SLUG}/feed/tr`);
      expect(feed.text).not.toContain(zenSlug);

      const removed = await as(ownerToken, ZEN).delete(`/sites/studio/${ZEN}/articles/${zenArticleId}`);
      expect(removed.status).toBe(200);
      expect(await prisma.article.findUnique({ where: { id: zenArticleId } })).toBeNull();
    });

    it('404s unknown studios, articles, tags and locales', async () => {
      expect((await request(server).get('/public/sites/no-such-studio/articles').query({ locale: 'tr' })).status).toBe(404);
      expect((await request(server).get('/public/sites/no-such-studio/feed/tr')).status).toBe(404);
      expect((await request(server).get(`/public/sites/${ZEN_SLUG}/articles/no-such-article`).query({ locale: 'tr' })).status).toBe(404);
      expect((await request(server).get(`/public/sites/${ZEN_SLUG}/articles`).query({ locale: 'tr', tag: 'no-such-tag' })).status).toBe(404);
      expect((await request(server).get(`/public/sites/${ZEN_SLUG}/articles`).query({ locale: 'de' })).status).toBe(404);
      expect((await request(server).get(`/public/sites/${ZEN_SLUG}/feed/not-a-locale`)).status).toBe(404);
    });
  });

  describe('platform site', () => {
    it('lets the super admin manage platform articles through the platform studio', async () => {
      const res = await as(superAdminToken, PLATFORM)
        .post(`/sites/studio/${PLATFORM}/articles`)
        .send({ authorName: 'Platform Ekibi', locales: [{ locale: 'tr', slug: `platform-${suffix}`, title: 'Platform yazisi', body: 'Metin' }] });
      expect(res.status).toBe(201);
      createdArticleIds.push(res.body.id);
      await as(superAdminToken, PLATFORM).post(`/sites/studio/${PLATFORM}/articles/${res.body.id}/publish`);

      const list = await request(server).get('/public/sites/platform/articles').query({ locale: 'tr' });
      expect(list.body.site.siteKind).toBe('PLATFORM');
      expect(list.body.items.some((a: { slug: string }) => a.slug === `platform-${suffix}`)).toBe(true);
      // Seeded: the draft never shows up.
      expect(list.body.items.some((a: { slug: string }) => a.slug === 'taslak-yazi')).toBe(false);
      expect((await request(server).get('/public/sites/platform/articles/taslak-yazi').query({ locale: 'tr' })).status).toBe(404);

      // A tenant owner cannot write to the platform site.
      const denied = await as(ownerToken, PLATFORM).get(`/sites/studio/${PLATFORM}/articles`);
      expect(denied.status).toBe(403);
    });
  });
});
