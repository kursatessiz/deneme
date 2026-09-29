import { NestExpressApplication } from '@nestjs/platform-express';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { PrismaClient } from '@platform/database';
import { AppModule } from '../../src/app.module';
import { configureBodyParsers } from '../../src/common/body-parsers';

/**
 * Multi-language support (i18n): public reads, super-admin CMS, self and
 * studio locale selection. Everything this suite creates is removed in
 * afterAll so the suite is safe to run twice in a row against the same
 * seeded database.
 */

const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Demo1234!';
const SUPER_ADMIN_PHONE = '+905321000001';
const OWNER_PHONE = '+905321000002';
const TRAINER_PHONE = '+905321000004';
// ISO 639 reserves qaa-qtz for local use, so this never clashes with a real language.
const TEST_LANGUAGE_CODE = 'qaa';

describe('i18n (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let server: any;

  let superAdminToken: string;
  let ownerToken: string;
  let trainerToken: string;
  let ZEN: string;

  const login = async (phone: string): Promise<string> => {
    const res = await request(server).post('/auth/login').send({ emailOrPhone: phone, password: DEMO_PASSWORD });
    expect(res.status).toBe(200);
    return res.body.accessToken as string;
  };

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    // Language packs exceed the default body limit; parse bodies as src/main.ts does.
    app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
    configureBodyParsers(app);
    await app.init();
    server = app.getHttpServer();
    prisma = new PrismaClient();

    ZEN = (await prisma.studio.findUniqueOrThrow({ where: { slug: 'zen-reformer-pilates' } })).id;
    superAdminToken = await login(SUPER_ADMIN_PHONE);
    ownerToken = await login(OWNER_PHONE);
    trainerToken = await login(TRAINER_PHONE);
  });

  afterAll(async () => {
    await prisma.translationOverride.deleteMany({ where: { locale: { in: ['en', TEST_LANGUAGE_CODE] } } });
    await prisma.language.deleteMany({ where: { code: TEST_LANGUAGE_CODE } });
    await prisma.user.updateMany({ where: { phone: { in: [OWNER_PHONE, TRAINER_PHONE] } }, data: { locale: null } });
    await prisma.studio.update({ where: { id: ZEN }, data: { defaultLocale: 'tr' } });
    await prisma.auditLog.deleteMany({ where: { action: { startsWith: 'i18n.' } } });
    await prisma.auditLog.deleteMany({ where: { action: 'studio.locale.update' } });
    await prisma.$disconnect();
    await app.close();
  });

  describe('public reads', () => {
    it('lists enabled languages with tr first', async () => {
      const res = await request(server).get('/i18n/languages');
      expect(res.status).toBe(200);
      expect(res.body.baseLocale).toBe('tr');
      expect(res.body.items[0].code).toBe('tr');
      expect(res.body.items.some((l: any) => l.code === 'en')).toBe(true);
    });

    it('serves tr messages and honours If-None-Match with 304', async () => {
      const first = await request(server).get('/i18n/messages/tr');
      expect(first.status).toBe(200);
      expect(first.body.locale).toBe('tr');
      expect(first.body.messages['common.save']).toBe('Kaydet');
      expect(first.headers.etag).toBe(first.body.version);
      expect(first.headers['cache-control']).toContain('max-age=300');

      const cached = await request(server).get('/i18n/messages/tr').set('If-None-Match', first.headers.etag);
      expect(cached.status).toBe(304);
    });

    it('404s for an unknown or disabled locale', async () => {
      expect((await request(server).get('/i18n/messages/xx-unknown')).status).toBe(404);
    });
  });

  describe('super-admin only', () => {
    it('every admin/i18n route rejects a non-super-admin with 403', async () => {
      const calls = [
        () => request(server).get('/admin/i18n/languages').set('Authorization', `Bearer ${ownerToken}`),
        () => request(server).post('/admin/i18n/languages').set('Authorization', `Bearer ${ownerToken}`).send({ code: 'xx', name: 'X', nativeName: 'X' }),
        () => request(server).put('/admin/i18n/languages/en').set('Authorization', `Bearer ${ownerToken}`).send({ isEnabled: true }),
        () => request(server).delete('/admin/i18n/languages/en').set('Authorization', `Bearer ${ownerToken}`),
        () => request(server).get('/admin/i18n/languages/en/entries').set('Authorization', `Bearer ${ownerToken}`),
        () => request(server).put('/admin/i18n/languages/en/entries/common.save').set('Authorization', `Bearer ${ownerToken}`).send({ value: 'x' }),
        () => request(server).get('/admin/i18n/languages/en/export').set('Authorization', `Bearer ${ownerToken}`),
        () => request(server).post('/admin/i18n/languages/en/import').set('Authorization', `Bearer ${ownerToken}`).send({ format: 'json', content: '{}' }),
      ];
      for (const call of calls) {
        const res = await call();
        expect(res.status).toBe(403);
      }
    });

    it('trainer (non-owner staff) also gets 403', async () => {
      const res = await request(server).get('/admin/i18n/languages').set('Authorization', `Bearer ${trainerToken}`);
      expect(res.status).toBe(403);
    });
  });

  describe('language CRUD', () => {
    it('creates a disabled language, lists it and enables it', async () => {
      const create = await request(server)
        .post('/admin/i18n/languages')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ code: TEST_LANGUAGE_CODE, name: 'Test Language', nativeName: 'Testsprache' });
      expect(create.status).toBe(201);
      expect(create.body.isEnabled).toBe(false);
      expect(create.body.completion).toBe(0);

      const list = await request(server).get('/admin/i18n/languages').set('Authorization', `Bearer ${superAdminToken}`);
      expect(list.body.items.some((l: any) => l.code === TEST_LANGUAGE_CODE)).toBe(true);

      const enable = await request(server)
        .put(`/admin/i18n/languages/${TEST_LANGUAGE_CODE}`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ isEnabled: true });
      expect(enable.status).toBe(200);
      expect(enable.body.isEnabled).toBe(true);
    });

    it('a disabled new language is not in the public list, then appears once enabled', async () => {
      const before = await request(server).get('/i18n/languages');
      expect(before.body.items.some((l: any) => l.code === TEST_LANGUAGE_CODE)).toBe(true); // enabled by previous test
    });

    it('refuses to disable Turkish', async () => {
      const res = await request(server).put('/admin/i18n/languages/tr').set('Authorization', `Bearer ${superAdminToken}`).send({ isEnabled: false });
      expect(res.status).toBe(400);
    });

    it('refuses to delete a bundled language', async () => {
      const res = await request(server).delete('/admin/i18n/languages/en').set('Authorization', `Bearer ${superAdminToken}`);
      expect(res.status).toBe(400);
    });

    it('deleting a language resets users and studios pointed at it', async () => {
      await request(server)
        .put('/me/locale')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ locale: TEST_LANGUAGE_CODE });
      await request(server)
        .put(`/studios/${ZEN}/locale`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ defaultLocale: TEST_LANGUAGE_CODE });

      const del = await request(server).delete(`/admin/i18n/languages/${TEST_LANGUAGE_CODE}`).set('Authorization', `Bearer ${superAdminToken}`);
      expect(del.status).toBe(204);

      const me = await request(server).get('/me/locale').set('Authorization', `Bearer ${ownerToken}`);
      expect(me.body.locale).toBeNull();

      const studio = await request(server).get(`/studios/${ZEN}/locale`).set('Authorization', `Bearer ${ownerToken}`);
      expect(studio.body.defaultLocale).toBe('tr');
    });
  });

  describe('translation entries', () => {
    afterEach(async () => {
      await prisma.translationOverride.deleteMany({ where: { locale: 'en', key: 'common.save' } });
    });

    it('lists entries for en with base, bundled and effective values', async () => {
      const res = await request(server).get('/admin/i18n/languages/en/entries').set('Authorization', `Bearer ${superAdminToken}`);
      expect(res.status).toBe(200);
      const entry = res.body.items.find((e: any) => e.key === 'common.save');
      expect(entry.base).toBe('Kaydet');
      expect(entry.bundled).toBe('Save');
      expect(entry.effective).toBe('Save');
    });

    it('upserts one entry and it becomes the effective value', async () => {
      const upsert = await request(server)
        .put('/admin/i18n/languages/en/entries/common.save')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ value: 'Store' });
      expect(upsert.status).toBe(200);
      expect(upsert.body.override).toBe('Store');
      expect(upsert.body.effective).toBe('Store');

      const messages = await request(server).get('/i18n/messages/en');
      expect(messages.body.messages['common.save']).toBe('Store');
    });

    it('a value with mismatched placeholders is rejected', async () => {
      const res = await request(server)
        .put('/admin/i18n/languages/en/entries/common.itemCount.one')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ value: 'no placeholder' });
      expect(res.status).toBe(400);
    });

    it('an unknown key is rejected', async () => {
      const res = await request(server)
        .put('/admin/i18n/languages/en/entries/not.a.real.key')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ value: 'x' });
      expect(res.status).toBe(400);
    });

    it('null removes the override', async () => {
      await request(server).put('/admin/i18n/languages/en/entries/common.save').set('Authorization', `Bearer ${superAdminToken}`).send({ value: 'Store' });
      const del = await request(server).put('/admin/i18n/languages/en/entries/common.save').set('Authorization', `Bearer ${superAdminToken}`).send({ value: null });
      expect(del.status).toBe(200);
      expect(del.body.override).toBeNull();
      expect(del.body.effective).toBe('Save');
    });
  });

  describe('export -> import round trip', () => {
    afterEach(async () => {
      await prisma.translationOverride.deleteMany({ where: { locale: 'en', key: 'common.save' } });
    });

    it('json export can be uploaded back unchanged', async () => {
      await request(server).put('/admin/i18n/languages/en/entries/common.save').set('Authorization', `Bearer ${superAdminToken}`).send({ value: 'Store' });

      const exportRes = await request(server).get('/admin/i18n/languages/en/export?format=json').set('Authorization', `Bearer ${superAdminToken}`);
      expect(exportRes.status).toBe(200);
      expect(exportRes.headers['content-disposition']).toContain('attachment');
      const pack = JSON.parse(exportRes.text);
      expect(pack.messages['common.save']).toBe('Store');

      await prisma.translationOverride.deleteMany({ where: { locale: 'en', key: 'common.save' } });

      const importRes = await request(server)
        .post('/admin/i18n/languages/en/import')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ format: 'json', content: exportRes.text, dryRun: false, mode: 'merge' });
      expect(importRes.status).toBe(201);
      expect(importRes.body.applied).toBe(true);

      const entries = await request(server).get('/admin/i18n/languages/en/entries').set('Authorization', `Bearer ${superAdminToken}`);
      expect(entries.body.items.find((e: any) => e.key === 'common.save').effective).toBe('Store');
    });

    it('csv export can be uploaded back unchanged', async () => {
      await request(server).put('/admin/i18n/languages/en/entries/common.save').set('Authorization', `Bearer ${superAdminToken}`).send({ value: 'Store' });

      const exportRes = await request(server).get('/admin/i18n/languages/en/export?format=csv').set('Authorization', `Bearer ${superAdminToken}`);
      expect(exportRes.status).toBe(200);
      expect(exportRes.text).toContain('common.save');

      await prisma.translationOverride.deleteMany({ where: { locale: 'en', key: 'common.save' } });

      const importRes = await request(server)
        .post('/admin/i18n/languages/en/import')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ format: 'csv', content: exportRes.text, dryRun: false, mode: 'merge' });
      expect(importRes.status).toBe(201);
      expect(importRes.body.applied).toBe(true);
    });

    it('a placeholder mismatch in the upload writes nothing', async () => {
      const pack = {
        format: 'platform.language-pack',
        formatVersion: 1,
        locale: 'en',
        baseLocale: 'tr',
        messages: { 'common.itemCount.one': 'broken' },
      };
      const res = await request(server)
        .post('/admin/i18n/languages/en/import')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ format: 'json', content: JSON.stringify(pack), dryRun: false, mode: 'merge' });
      expect(res.status).toBe(201);
      expect(res.body.applied).toBe(false);
      expect(res.body.placeholderMismatches.length).toBeGreaterThan(0);

      const entries = await request(server).get('/admin/i18n/languages/en/entries').set('Authorization', `Bearer ${superAdminToken}`);
      expect(entries.body.items.find((e: any) => e.key === 'common.itemCount.one').override).toBeNull();
    });

    it('dryRun reports without writing', async () => {
      const pack = {
        format: 'platform.language-pack',
        formatVersion: 1,
        locale: 'en',
        baseLocale: 'tr',
        messages: { 'common.save': 'Store' },
      };
      const res = await request(server)
        .post('/admin/i18n/languages/en/import')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ format: 'json', content: JSON.stringify(pack), dryRun: true, mode: 'merge' });
      expect(res.status).toBe(201);
      expect(res.body.dryRun).toBe(true);
      expect(res.body.applied).toBe(true);

      const entries = await request(server).get('/admin/i18n/languages/en/entries').set('Authorization', `Bearer ${superAdminToken}`);
      expect(entries.body.items.find((e: any) => e.key === 'common.save').override).toBeNull();
    });

    it('replace mode removes overrides missing from the upload; merge keeps them', async () => {
      await request(server).put('/admin/i18n/languages/en/entries/common.save').set('Authorization', `Bearer ${superAdminToken}`).send({ value: 'Store' });
      await request(server).put('/admin/i18n/languages/en/entries/common.cancel').set('Authorization', `Bearer ${superAdminToken}`).send({ value: 'Abort' });

      const pack = { format: 'platform.language-pack', formatVersion: 1, locale: 'en', baseLocale: 'tr', messages: { 'common.save': 'Store' } };
      const res = await request(server)
        .post('/admin/i18n/languages/en/import')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ format: 'json', content: JSON.stringify(pack), dryRun: false, mode: 'replace' });
      expect(res.status).toBe(201);
      expect(res.body.removedCount).toBe(1);

      const entries = await request(server).get('/admin/i18n/languages/en/entries').set('Authorization', `Bearer ${superAdminToken}`);
      expect(entries.body.items.find((e: any) => e.key === 'common.cancel').override).toBeNull();
      expect(entries.body.items.find((e: any) => e.key === 'common.save').override).toBe('Store');

      await prisma.translationOverride.deleteMany({ where: { locale: 'en', key: 'common.cancel' } });
    });
  });

  describe('me/locale', () => {
    afterEach(async () => {
      await prisma.user.updateMany({ where: { phone: OWNER_PHONE }, data: { locale: null } });
    });

    it('reads and updates the caller own locale', async () => {
      const get = await request(server).get('/me/locale').set('Authorization', `Bearer ${ownerToken}`);
      expect(get.status).toBe(200);
      expect(get.body.locale).toBeNull();

      const put = await request(server).put('/me/locale').set('Authorization', `Bearer ${ownerToken}`).send({ locale: 'en' });
      expect(put.status).toBe(200);
      expect(put.body.locale).toBe('en');

      const me = await request(server).get('/auth/me').set('Authorization', `Bearer ${ownerToken}`);
      expect(me.body.locale).toBe('en');
    });

    it('rejects a disabled locale', async () => {
      const res = await request(server).put('/me/locale').set('Authorization', `Bearer ${ownerToken}`).send({ locale: 'xx-nope' });
      expect(res.status).toBe(400);
    });

    it('requires authentication', async () => {
      expect((await request(server).put('/me/locale').send({ locale: 'en' })).status).toBe(401);
    });
  });

  describe('studio locale', () => {
    afterEach(async () => {
      await prisma.studio.update({ where: { id: ZEN }, data: { defaultLocale: 'tr' } });
    });

    it('requires studio.settings.manage (trainer gets 403)', async () => {
      const res = await request(server).put(`/studios/${ZEN}/locale`).set('Authorization', `Bearer ${trainerToken}`).send({ defaultLocale: 'en' });
      expect(res.status).toBe(403);
    });

    it('the owner can set the studio default locale', async () => {
      const res = await request(server).put(`/studios/${ZEN}/locale`).set('Authorization', `Bearer ${ownerToken}`).send({ defaultLocale: 'en' });
      expect(res.status).toBe(200);
      expect(res.body.defaultLocale).toBe('en');

      const me = await request(server).get('/auth/me').set('Authorization', `Bearer ${ownerToken}`);
      expect(me.body.memberships.find((m: any) => m.studioId === ZEN).defaultLocale).toBe('en');
    });

    it('rejects a disabled locale', async () => {
      const res = await request(server).put(`/studios/${ZEN}/locale`).set('Authorization', `Bearer ${ownerToken}`).send({ defaultLocale: 'xx-nope' });
      expect(res.status).toBe(400);
    });
  });
});
