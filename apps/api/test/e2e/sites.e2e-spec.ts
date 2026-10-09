import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { PrismaClient } from '@platform/database';
import { AppModule } from '../../src/app.module';

/**
 * G2c: page engine. Site/page/block CRUD with permissions and tenant
 * isolation, publish/version/rollback, the domain "ask" endpoint, public
 * rendering, and a lead-form submission from a published landing page
 * creating a Contact + lead conversion attributed to the page's visit.
 */

const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Demo1234!';
const SUPER_ADMIN_PHONE = '+905321000001';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const OWNER_PHONE = '+905321000002';
const TRAINER_PHONE = '+905321000004';

describe('Sites: page engine (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let server: any;

  let ZEN: string;
  let PLATFORM: string;
  let ownerToken: string;
  let trainerToken: string;
  let superAdminToken: string;

  const login = async (phone: string) => {
    const res = await request(server).post('/auth/login').send({ emailOrPhone: phone, password: DEMO_PASSWORD });
    expect(res.status).toBe(200);
    return res.body.accessToken as string;
  };
  const as = (token: string, studioId: string) => ({
    get: (url: string) => request(server).get(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId),
    post: (url: string) => request(server).post(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId),
    patch: (url: string) => request(server).patch(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId),
    put: (url: string) => request(server).put(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId),
    delete: (url: string) => request(server).delete(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId),
  });

  const createdPageIds: string[] = [];
  const createdContactPhones = ['+905399977001', '+905399977002'];

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer();
    prisma = new PrismaClient();

    ZEN = (await prisma.studio.findUniqueOrThrow({ where: { slug: 'zen-reformer-pilates' } })).id;
    PLATFORM = (await prisma.studio.findUniqueOrThrow({ where: { slug: 'platform' } })).id;

    ownerToken = await login(OWNER_PHONE);
    trainerToken = await login(TRAINER_PHONE);
    superAdminToken = await login(SUPER_ADMIN_PHONE);
  });

  afterAll(async () => {
    await prisma.contact.deleteMany({ where: { studioId: ZEN, phone: { in: createdContactPhones } } });
    if (createdPageIds.length) await prisma.page.deleteMany({ where: { id: { in: createdPageIds } } });
    await prisma.companyInfo.deleteMany({ where: { id: 'platform' } });
    await app.close();
    await prisma.$disconnect();
  });

  describe('tenant site: permissions and CRUD', () => {
    it('denies a staff member without site.manage / site.view', async () => {
      const denied = await as(trainerToken, ZEN).get(`/sites/studio/${ZEN}`);
      expect(denied.status).toBe(403);
    });

    it('does not let one tenant read another tenant site through a mismatched header', async () => {
      const other = (await prisma.studio.findFirstOrThrow({ where: { slug: 'flow-pilates-wellness' } })).id;
      const res = await request(server)
        .get(`/sites/studio/${ZEN}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-studio-id', other);
      expect(res.status).toBe(403);
    });

    it('creates the site lazily for the owner (site.manage via owner default)', async () => {
      const res = await as(ownerToken, ZEN).get(`/sites/studio/${ZEN}`);
      expect(res.status).toBe(200);
      expect(res.body.kind).toBe('TENANT');
    });

    it('full page lifecycle: create, locale, blocks, publish, versions, rollback', async () => {
      const create = await as(ownerToken, ZEN).post(`/sites/studio/${ZEN}/pages`).send({
        kind: 'LANDING',
        internalLabel: 'E2E test landing',
      });
      expect(create.status).toBe(201);
      const pageId = create.body.id as string;
      createdPageIds.push(pageId);

      const locale = await as(ownerToken, ZEN).put(`/sites/studio/${ZEN}/pages/${pageId}/locales/tr`).send({
        slug: 'e2e-test-landing',
        seoTitle: 'E2E Test',
      });
      expect(locale.status).toBe(200);
      expect(locale.body.slug).toBe('e2e-test-landing');

      const blocksV1 = await as(ownerToken, ZEN).put(`/sites/studio/${ZEN}/pages/${pageId}/blocks`).send([
        { type: 'hero', position: 0, data: { config: {}, text: { tr: { title: 'Baslik 1' } } } },
        {
          type: 'lead_form',
          position: 1,
          data: { config: { fields: ['fullName', 'phone'] }, text: { tr: { title: 'Iletisim', submitLabel: 'Gonder' } } },
        },
      ]);
      expect(blocksV1.status).toBe(200);
      expect(blocksV1.body.items).toHaveLength(2);

      const rejectedBlock = await as(ownerToken, ZEN)
        .put(`/sites/studio/${ZEN}/pages/${pageId}/blocks`)
        .send([{ type: 'hero', position: 0, data: { config: {}, text: { tr: { bogus: 1 } } } }]);
      expect(rejectedBlock.status).toBe(400);

      const publish1 = await as(ownerToken, ZEN).post(`/sites/studio/${ZEN}/pages/${pageId}/publish`);
      expect(publish1.status).toBe(201);
      expect(publish1.body.status).toBe('PUBLISHED');

      // Republish with a changed hero title -> second version.
      await as(ownerToken, ZEN)
        .put(`/sites/studio/${ZEN}/pages/${pageId}/blocks`)
        .send([{ type: 'hero', position: 0, data: { config: {}, text: { tr: { title: 'Baslik 2' } } } }]);
      const publish2 = await as(ownerToken, ZEN).post(`/sites/studio/${ZEN}/pages/${pageId}/publish`);
      expect(publish2.status).toBe(201);

      const versions = await as(ownerToken, ZEN).get(`/sites/studio/${ZEN}/pages/${pageId}/versions`);
      expect(versions.status).toBe(200);
      expect(versions.body.items).toHaveLength(2);
      const v1 = versions.body.items.find((v: { version: number }) => v.version === 1);

      const detailBefore = await as(ownerToken, ZEN).get(`/sites/studio/${ZEN}/pages/${pageId}`);
      expect(detailBefore.body.blocks[0].data.text.tr.title).toBe('Baslik 2');

      const rollback = await as(ownerToken, ZEN).post(`/sites/studio/${ZEN}/pages/${pageId}/versions/${v1.id}/rollback`);
      expect(rollback.status).toBe(201);

      const detailAfter = await as(ownerToken, ZEN).get(`/sites/studio/${ZEN}/pages/${pageId}`);
      expect(detailAfter.body.blocks[0].data.text.tr.title).toBe('Baslik 1');

      const versionsAfterRollback = await as(ownerToken, ZEN).get(`/sites/studio/${ZEN}/pages/${pageId}/versions`);
      expect(versionsAfterRollback.body.items).toHaveLength(3);
    });

    it('rejects a tenant-only block type on the platform site', async () => {
      const create = await as(superAdminToken, PLATFORM).post(`/sites/studio/${PLATFORM}/pages`).send({
        kind: 'CUSTOM',
        internalLabel: 'E2E platform trainers test',
      });
      createdPageIds.push(create.body.id);
      const rejected = await as(superAdminToken, PLATFORM)
        .put(`/sites/studio/${PLATFORM}/pages/${create.body.id}/blocks`)
        .send([{ type: 'trainers', position: 0, data: { config: {}, text: { tr: { items: [] } } } }]);
      expect(rejected.status).toBe(400);
    });

    it('rejects legal approval on a non-legal page', async () => {
      const create = await as(ownerToken, ZEN).post(`/sites/studio/${ZEN}/pages`).send({ kind: 'LANDING', internalLabel: 'E2E legal reject' });
      createdPageIds.push(create.body.id);
      const res = await as(ownerToken, ZEN).patch(`/sites/studio/${ZEN}/pages/${create.body.id}/locales/tr/legal-approval`).send({ approved: true });
      expect(res.status).toBe(400);
    });

    it('approves legal text on a legal page', async () => {
      const create = await as(superAdminToken, PLATFORM).post(`/sites/studio/${PLATFORM}/pages`).send({ kind: 'LEGAL', internalLabel: 'E2E KVKK' });
      createdPageIds.push(create.body.id);
      await as(superAdminToken, PLATFORM).put(`/sites/studio/${PLATFORM}/pages/${create.body.id}/locales/tr`).send({ slug: 'e2e-kvkk' });
      const approve = await as(superAdminToken, PLATFORM).patch(`/sites/studio/${PLATFORM}/pages/${create.body.id}/locales/tr/legal-approval`).send({ approved: true });
      expect(approve.status).toBe(200);
      expect(approve.body.legalApproved).toBe(true);
    });
  });

  describe('sector landing wizard', () => {
    it('creates a pre-filled sector landing page for the platform site', async () => {
      const res = await as(superAdminToken, PLATFORM).post(`/sites/studio/${PLATFORM}/pages/wizard`).send({
        sectorKey: 'pilates_studio',
        offerKey: 'e2e-offer',
        locales: ['tr', 'en'],
      });
      expect(res.status).toBe(201);
      createdPageIds.push(res.body.id);
      expect(res.body.sectorKey).toBe('pilates_studio');
      expect(res.body.locales.map((l: { locale: string }) => l.locale).sort()).toEqual(['en', 'tr']);

      const detail = await as(superAdminToken, PLATFORM).get(`/sites/studio/${PLATFORM}/pages/${res.body.id}`);
      const types = detail.body.blocks.map((b: { type: string }) => b.type);
      expect(types).toEqual(['hero', 'cta', 'lead_form']);
    });
  });

  describe('custom domains', () => {
    it('adds a domain, ask endpoint refuses it until verified, accepts once verified', async () => {
      const add = await as(ownerToken, ZEN).post(`/sites/studio/${ZEN}/domains`).send({ domain: 'e2e-test.example.com' });
      expect(add.status).toBe(201);
      const domainId = add.body.id as string;

      const askBefore = await request(server).get('/public/domains/ask').query({ domain: 'e2e-test.example.com' });
      expect(askBefore.status).toBe(404);

      await prisma.siteDomain.update({ where: { id: domainId }, data: { status: 'VERIFIED', verifiedAt: new Date() } });

      const askAfter = await request(server).get('/public/domains/ask').query({ domain: 'e2e-test.example.com' });
      expect(askAfter.status).toBe(200);

      await as(ownerToken, ZEN).delete(`/sites/studio/${ZEN}/domains/${domainId}`);
      const askAfterDelete = await request(server).get('/public/domains/ask').query({ domain: 'e2e-test.example.com' });
      expect(askAfterDelete.status).toBe(404);
    });

    describe('a domain held by another site', () => {
      const squatted = `e2e-squat-${Date.now().toString(36)}.example.com`;
      const verifiedElsewhere = `e2e-owned-${Date.now().toString(36)}.example.com`;
      let otherSiteId: string;
      let createdOtherSite = false;

      beforeAll(async () => {
        const flow = (await prisma.studio.findUniqueOrThrow({ where: { slug: 'flow-pilates-wellness' } })).id;
        const existing = await prisma.site.findUnique({ where: { studioId: flow } });
        if (existing) {
          otherSiteId = existing.id;
        } else {
          otherSiteId = (await prisma.site.create({ data: { studioId: flow, kind: 'TENANT' } })).id;
          createdOtherSite = true;
        }
      });

      afterAll(async () => {
        await prisma.siteDomain.deleteMany({ where: { domain: { in: [squatted, verifiedElsewhere] } } });
        if (createdOtherSite) await prisma.site.delete({ where: { id: otherSiteId } });
      });

      it('an unverified claim of another site does not block the real owner: the row moves over with a fresh token', async () => {
        const squat = await prisma.siteDomain.create({ data: { siteId: otherSiteId, domain: squatted, verificationToken: 'squatter-token' } });

        const add = await as(ownerToken, ZEN).post(`/sites/studio/${ZEN}/domains`).send({ domain: squatted });
        expect(add.status).toBe(201);
        expect(add.body.status).toBe('PENDING');

        const row = await prisma.siteDomain.findUniqueOrThrow({ where: { domain: squatted }, include: { site: { select: { studioId: true } } } });
        expect(row.id).toBe(squat.id);
        expect(row.site.studioId).toBe(ZEN);
        expect(row.verificationToken).not.toBe('squatter-token');
        expect(row.verifiedAt).toBeNull();
      });

      it('a domain verified by another site still answers 409', async () => {
        await prisma.siteDomain.create({
          data: { siteId: otherSiteId, domain: verifiedElsewhere, verificationToken: 'owner-token', status: 'VERIFIED', verifiedAt: new Date() },
        });
        const add = await as(ownerToken, ZEN).post(`/sites/studio/${ZEN}/domains`).send({ domain: verifiedElsewhere });
        expect(add.status).toBe(409);
        const row = await prisma.siteDomain.findUniqueOrThrow({ where: { domain: verifiedElsewhere } });
        expect(row.siteId).toBe(otherSiteId);
      });

      it('adding a domain the site already has still answers 409', async () => {
        const again = await as(ownerToken, ZEN).post(`/sites/studio/${ZEN}/domains`).send({ domain: squatted });
        expect(again.status).toBe(409);
      });
    });
  });

  describe('public rendering', () => {
    let publishedPageId: string;
    const slug = 'e2e-public-landing';

    beforeAll(async () => {
      const create = await as(ownerToken, ZEN).post(`/sites/studio/${ZEN}/pages`).send({ kind: 'LANDING', internalLabel: 'E2E public landing' });
      publishedPageId = create.body.id;
      createdPageIds.push(publishedPageId);
      await as(ownerToken, ZEN).put(`/sites/studio/${ZEN}/pages/${publishedPageId}/locales/tr`).send({ slug });
      await as(ownerToken, ZEN)
        .put(`/sites/studio/${ZEN}/pages/${publishedPageId}/blocks`)
        .send([
          { type: 'hero', position: 0, data: { config: {}, text: { tr: { title: 'Herkese acik baslik' } } } },
          { type: 'pricing', position: 1, data: { config: { hidden: false }, text: { tr: {} } } },
          { type: 'lead_form', position: 2, data: { config: { fields: ['fullName', 'phone'] }, text: { tr: { title: 'Iletisim', submitLabel: 'Gonder' } } } },
        ]);
      await as(ownerToken, ZEN).post(`/sites/studio/${ZEN}/pages/${publishedPageId}/publish`);
    });

    it('serves the published page and 404s an unpublished/unknown locale', async () => {
      const res = await request(server).get(`/public/sites/zen-reformer-pilates/pages`).query({ locale: 'tr', slug });
      expect(res.status).toBe(200);
      expect(res.body.blocks).toHaveLength(3);
      expect(res.body.context.packages).toBeDefined();
      expect(res.body.siteKind).toBe('TENANT');

      const missingLocale = await request(server).get(`/public/sites/zen-reformer-pilates/pages`).query({ locale: 'en', slug });
      expect(missingLocale.status).toBe(404);

      const unpublishedSlug = await request(server).get(`/public/sites/zen-reformer-pilates/pages`).query({ locale: 'tr', slug: 'does-not-exist' });
      expect(unpublishedSlug.status).toBe(404);
    });

    it('lists the published page in the site-map entries', async () => {
      const res = await request(server).get('/public/sites/zen-reformer-pilates/sitemap-entries');
      expect(res.status).toBe(200);
      expect(res.body.items.some((e: { slug: string }) => e.slug === slug)).toBe(true);
    });

    it('resolves a tenant subdomain host to its site', async () => {
      const base = process.env.SITES_DOMAIN ?? process.env.WEB_DOMAIN ?? 'localhost';
      const res = await request(server).get('/public/sites/resolve').query({ host: `zen-reformer-pilates.${base}` });
      expect(res.status).toBe(200);
      expect(res.body.studioSlug).toBe('zen-reformer-pilates');
    });

    it('a lead form submission from the published landing page creates a Contact and a lead conversion attributed to the visit', async () => {
      const vid = 'e2e71234-0000-4000-8000-000000000099';
      const touchpoint = await request(server)
        .post('/track/zen-reformer-pilates/touchpoint')
        .set('User-Agent', UA)
        .send({
          visitorId: vid,
          sessionId: 'e2e71234-0000-4000-8000-000000000100',
          landingUrl: `https://zen-reformer-pilates.example.com/tr/${slug}`,
          utm: {},
          adIds: {},
          clickIds: {},
          locale: 'tr',
          pageVariant: 'control',
          consent: { analytics: true, advertising: false },
        });
      expect(touchpoint.status).toBe(204);

      const submit = await request(server)
        .post('/public/studios/zen-reformer-pilates/leads')
        .set('X-PW-VID', vid)
        .send({ fullName: 'E2E Aday Bir', phone: createdContactPhones[0], consent: true });
      expect(submit.status).toBe(202);

      const contact = await prisma.contact.findFirstOrThrow({ where: { studioId: ZEN, phone: createdContactPhones[0] } });
      const conversion = await prisma.conversionEvent.findFirstOrThrow({ where: { studioId: ZEN, contactId: contact.id, type: 'lead' } });
      expect(conversion.attributedTouchpointId).not.toBeNull();
      const attributedTouchpoint = await prisma.touchpoint.findUniqueOrThrow({ where: { id: conversion.attributedTouchpointId! } });
      expect(attributedTouchpoint.pageVariant).toBe('control');

      await prisma.visitor.deleteMany({ where: { id: vid } });
    });
  });

  describe('company info (super admin only)', () => {
    it('denies a tenant owner', async () => {
      const res = await as(ownerToken, ZEN).get('/admin/company-info');
      expect(res.status).toBe(403);
    });

    it('lets the super admin read and update the singleton', async () => {
      const update = await request(server)
        .put('/admin/company-info')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ legalName: 'E2E Platform A.S.', socialLinks: {} });
      expect(update.status).toBe(200);
      expect(update.body.legalName).toBe('E2E Platform A.S.');

      const get = await request(server).get('/admin/company-info').set('Authorization', `Bearer ${superAdminToken}`);
      expect(get.status).toBe(200);
      expect(get.body.legalName).toBe('E2E Platform A.S.');
    });
  });
});
