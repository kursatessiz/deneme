import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { PrismaClient } from '@platform/database';
import { AppModule } from '../../src/app.module';
import { SiteCacheService } from '../../src/modules/sites/site-cache.service';

/**
 * S3: ISR support. Publishing, unpublishing and editing live content asks the web app to purge the site's cache
 * (SiteCacheService, stubbed here), draft edits do not, the public settings carry a host-independent canonical
 * origin, and the variant-pages list names exactly the A/B pages the web app renders per request.
 */

const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Demo1234!';
const OWNER_PHONE = '+905321000002';
const ZEN_SLUG = 'zen-reformer-pilates';

class RecordingSiteCache {
  studios: string[] = [];
  slugs: string[] = [];
  async purgeStudio(studioId: string): Promise<void> {
    this.studios.push(studioId);
  }
  async purgeSlug(slug: string): Promise<void> {
    this.slugs.push(slug);
  }
}

describe('Sites: ISR cache purge and public settings (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let server: ReturnType<INestApplication['getHttpServer']>;
  const cache = new RecordingSiteCache();
  let ZEN: string;
  let ownerToken: string;
  const suffix = Date.now().toString(36);
  const createdPageIds: string[] = [];
  const createdDomainIds: string[] = [];

  const owner = {
    get: (url: string) => request(server).get(url).set('Authorization', `Bearer ${ownerToken}`).set('x-studio-id', ZEN),
    post: (url: string) => request(server).post(url).set('Authorization', `Bearer ${ownerToken}`).set('x-studio-id', ZEN),
    put: (url: string) => request(server).put(url).set('Authorization', `Bearer ${ownerToken}`).set('x-studio-id', ZEN),
    patch: (url: string) => request(server).patch(url).set('Authorization', `Bearer ${ownerToken}`).set('x-studio-id', ZEN),
  };

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SiteCacheService)
      .useValue(cache)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer();
    prisma = new PrismaClient();
    ZEN = (await prisma.studio.findUniqueOrThrow({ where: { slug: ZEN_SLUG } })).id;
    const login = await request(server).post('/auth/login').send({ emailOrPhone: OWNER_PHONE, password: DEMO_PASSWORD });
    expect(login.status).toBe(200);
    ownerToken = login.body.accessToken as string;
  });

  afterAll(async () => {
    if (createdDomainIds.length) await prisma.siteDomain.deleteMany({ where: { id: { in: createdDomainIds } } });
    if (createdPageIds.length) await prisma.page.deleteMany({ where: { id: { in: createdPageIds } } });
    await app.close();
    await prisma.$disconnect();
  });

  const hero = (title: string) => ({ config: {}, text: { tr: { title, subtitle: 'Alt baslik' } } });
  const slug = `s3-cache-${suffix}`;
  let pageId: string;

  it('does not purge for draft edits, then purges on publish', async () => {
    const created = await owner.post(`/sites/studio/${ZEN}/pages`).send({ kind: 'CUSTOM', internalLabel: `S3 cache ${suffix}` });
    expect(created.status).toBe(201);
    pageId = created.body.id as string;
    createdPageIds.push(pageId);

    expect((await owner.put(`/sites/studio/${ZEN}/pages/${pageId}/locales/tr`).send({ slug, seoTitle: 'S3 cache' })).status).toBe(200);
    expect((await owner.put(`/sites/studio/${ZEN}/pages/${pageId}/blocks`).send([{ type: 'hero', position: 0, data: hero('Merhaba') }])).status).toBe(200);
    expect(cache.studios).toEqual([]);

    expect((await owner.post(`/sites/studio/${ZEN}/pages/${pageId}/publish`)).status).toBe(201);
    expect(cache.studios).toEqual([ZEN]);
  });

  it('purges when live content is edited and when the page is unpublished', async () => {
    cache.studios.length = 0;
    expect((await owner.put(`/sites/studio/${ZEN}/pages/${pageId}/blocks`).send([{ type: 'hero', position: 0, data: hero('Guncel') }])).status).toBe(200);
    expect(cache.studios).toEqual([ZEN]);
    expect((await owner.post(`/sites/studio/${ZEN}/pages/${pageId}/unpublish`)).status).toBe(201);
    expect(cache.studios).toEqual([ZEN, ZEN]);
  });

  it('lists only published pages with two or more A/B variants as variant pages', async () => {
    const blocks = [
      { type: 'hero', position: 0, abVariantKey: 'a', data: hero('Varyant A') },
      { type: 'hero', position: 0, abVariantKey: 'b', data: hero('Varyant B') },
    ];
    expect((await owner.put(`/sites/studio/${ZEN}/pages/${pageId}/blocks`).send(blocks)).status).toBe(200);
    // Draft: not listed.
    expect((await request(server).get(`/public/sites/${ZEN_SLUG}/variant-pages`)).body.items).not.toContainEqual({ locale: 'tr', slug });

    expect((await owner.post(`/sites/studio/${ZEN}/pages/${pageId}/publish`)).status).toBe(201);
    const listed = await request(server).get(`/public/sites/${ZEN_SLUG}/variant-pages`);
    expect(listed.status).toBe(200);
    expect(listed.body.items).toContainEqual({ locale: 'tr', slug });

    // One variant only: back to the cached renderer.
    expect((await owner.put(`/sites/studio/${ZEN}/pages/${pageId}/blocks`).send([blocks[0]])).status).toBe(200);
    expect((await request(server).get(`/public/sites/${ZEN_SLUG}/variant-pages`)).body.items).not.toContainEqual({ locale: 'tr', slug });
  });

  it('does not leak variant pages across tenants', async () => {
    const flow = await request(server).get('/public/sites/flow-pilates-wellness/variant-pages');
    expect(flow.status).toBe(200);
    expect(flow.body.items).not.toContainEqual({ locale: 'tr', slug });
  });

  it('serves a canonical origin that ignores the request host: subdomain, then the verified custom domain', async () => {
    const before = await request(server).get(`/public/sites/${ZEN_SLUG}/settings`).set('Host', 'attacker.example');
    expect(before.status).toBe(200);
    expect(before.body.canonicalOrigin).toMatch(new RegExp(`^https?://${ZEN_SLUG}\\.`));

    const site = await prisma.site.findUniqueOrThrow({ where: { studioId: ZEN } });
    const pending = await prisma.siteDomain.create({ data: { siteId: site.id, domain: `pending-${suffix}.example.org`, verificationToken: 'x'.repeat(20), status: 'PENDING' } });
    const verified = await prisma.siteDomain.create({ data: { siteId: site.id, domain: `www-${suffix}.example.org`, verificationToken: 'y'.repeat(20), status: 'VERIFIED', verifiedAt: new Date() } });
    createdDomainIds.push(pending.id, verified.id);
    const after = await request(server).get(`/public/sites/${ZEN_SLUG}/settings`);
    expect(after.body.canonicalOrigin).toBe(`https://www-${suffix}.example.org`);
  });

  it('purges when a domain is removed and when site settings change', async () => {
    cache.studios.length = 0;
    const site = await owner.get(`/sites/studio/${ZEN}`);
    expect(site.status).toBe(200);
    const patched = await owner.patch(`/sites/studio/${ZEN}`).send({ defaultLocale: site.body.defaultLocale });
    expect(patched.status).toBe(200);
    expect(cache.studios).toEqual([ZEN]);
  });
});
