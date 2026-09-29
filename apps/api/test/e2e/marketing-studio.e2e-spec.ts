import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import * as bcrypt from 'bcrypt';
import { PrismaClient } from '@platform/database';
import { MARKETING_MIN_CELL, normalizePhone } from '@platform/shared';
import { AppModule } from '../../src/app.module';
import { AI_PROVIDER_ADAPTER } from '../../src/modules/ai/providers/ai-provider';
import { FakeAiAdapter } from '../../src/modules/ai/providers/fake-ai.adapter';

/**
 * M2 marketing studio (docs/PAZARLAMA_MODULU.md 3.4, 4, 7.3): brand kit and
 * product facts, the AI studio with the fake provider (drafts, variants,
 * brand checks, A/B stub, export to a DRAFT campaign, k-anonymous segment
 * suggestions, cited research notes), the content calendar, the marketing
 * budget, permissions and tenant isolation. Everything it creates is removed
 * in afterAll so the suite can run twice against the same seeded database.
 */

const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Demo1234!';
const SUPER_ADMIN_PHONE = '+905321000001';
const ZEN_OWNER_PHONE = '+905321000002';
const API_KEY = 'sk-ant-api03-e2e-marketing-key-value-0000QWER';

/** Markers that must never reach the model or a response: they exist only as contact details. */
const PII_NAME = 'Zeynepmarker';
const PII_EMAIL_DOMAIN = 'pii-marker.example';
const PII_PHONE_PREFIX = '+90532777';

describe('Marketing studio (M2) e2e', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let server: ReturnType<INestApplication['getHttpServer']>;
  const fake = new FakeAiAdapter();
  const startedAt = new Date();
  const runId = Date.now().toString().slice(-7);

  let PLATFORM: string;
  let ZEN: string;
  let superAdminToken: string;
  let ownerToken: string;
  let marketingToken: string;
  /** A second marketing admin: the model endpoints are limited to 10 requests per user per minute. */
  let marketing2Token: string;
  let viewerToken: string;
  let marketingUserId: string;
  let segmentId: string;
  let previousMfaPolicy: boolean | undefined;
  let baselineNotifications = 0;

  const marketingPhone = normalizePhone(`0538${runId}`)!;
  const viewerPhone = normalizePhone(`0537${runId}`)!;
  const marketing2Phone = normalizePhone(`0536${runId}`)!;
  const viewerRoleKey = `m2_viewer_${runId}`;
  const foreignDraftIds: string[] = [];
  const foreignItemIds: string[] = [];

  const as = (token: string) => ({
    get: (url: string) => request(server).get(url).set('Authorization', `Bearer ${token}`),
    post: (url: string) => request(server).post(url).set('Authorization', `Bearer ${token}`),
    put: (url: string) => request(server).put(url).set('Authorization', `Bearer ${token}`),
    patch: (url: string) => request(server).patch(url).set('Authorization', `Bearer ${token}`),
    delete: (url: string) => request(server).delete(url).set('Authorization', `Bearer ${token}`),
  });
  const login = async (phone: string): Promise<string> => {
    const res = await request(server).post('/auth/login').send({ emailOrPhone: phone, password: DEMO_PASSWORD });
    expect(res.status).toBe(200);
    return res.body.accessToken as string;
  };

  const KIT = {
    brandName: 'Acme Platform',
    positioning: 'Randevu isletmeleri icin tek panel',
    defaultLocale: 'tr',
    links: { website: 'https://example.com' },
    senderIdentities: { EMAIL: { displayName: 'Acme', address: 'hello@example.com' } },
    icps: [{ key: 'studio_owner', name: 'Studyo sahibi', description: 'Kucuk isletme' }],
    locales: [
      {
        locale: 'tr',
        toneNotes: 'Sicak ama profesyonel.',
        doList: ['Somut fayda anlat'],
        dontList: ['Rakip adi verme'],
        bannedPhrases: ['garanti', 'en iyi'],
        requiredDisclaimers: { SMS: 'Cikis icin STOP yazin.' },
      },
      { locale: 'en', toneNotes: 'Warm and direct.', doList: [], dontList: [], bannedPhrases: ['guaranteed'], requiredDisclaimers: {} },
    ],
  };
  const BRIEF = { goal: `Yeni studyolara ulas. Ilgili kisi ${PII_NAME.toLowerCase()}@${PII_EMAIL_DOMAIN}, tel ${PII_PHONE_PREFIX}1122`, offer: 'Ilk ay ucretsiz' };

  const generate = (body: Record<string, unknown>, token = marketingToken) => as(token).post('/platform/marketing/studio/generate').send(body);

  async function cleanup(): Promise<void> {
    await prisma.contentCalendarItem.deleteMany({ where: { OR: [{ studioId: PLATFORM }, { id: { in: foreignItemIds } }] } });
    await prisma.campaign.deleteMany({ where: { studioId: PLATFORM, OR: [{ name: { startsWith: 'M2 e2e' } }, { templateKey: { startsWith: 'MKT_' } }] } });
    await prisma.messageTemplate.deleteMany({ where: { studioId: PLATFORM, key: { startsWith: 'MKT_' } } });
    await prisma.marketingDraft.deleteMany({ where: { OR: [{ studioId: PLATFORM }, { id: { in: foreignDraftIds } }] } });
    await prisma.productFact.deleteMany({ where: { studioId: PLATFORM } });
    await prisma.brandKit.deleteMany({ where: { studioId: PLATFORM } });
    await prisma.contact.deleteMany({ where: { studioId: PLATFORM, lastName: 'M2Marker' } });
    await prisma.segment.deleteMany({ where: { studioId: PLATFORM, name: { startsWith: 'M2 e2e' } } });
    await prisma.aiUsage.deleteMany({ where: { createdAt: { gte: startedAt } } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ action: { startsWith: 'marketing.' } }, { action: { startsWith: 'ai.' } }], createdAt: { gte: startedAt } } });
  }

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AI_PROVIDER_ADAPTER)
      .useValue(fake)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer();
    prisma = new PrismaClient();

    PLATFORM = (await prisma.studio.findFirstOrThrow({ where: { isPlatform: true } })).id;
    ZEN = (await prisma.studio.findUniqueOrThrow({ where: { slug: 'zen-reformer-pilates' } })).id;
    await cleanup();
    baselineNotifications = await prisma.notificationLog.count({ where: { studioId: PLATFORM } });

    // Platform users: a marketing admin (default role) and a read-only role.
    const previous = await prisma.platformAccessSettings.findUnique({ where: { id: 'platform' } });
    previousMfaPolicy = previous?.require2faForPlatformRoles;
    await prisma.platformAccessSettings.upsert({ where: { id: 'platform' }, create: { id: 'platform', require2faForPlatformRoles: false }, update: { require2faForPlatformRoles: false } });
    const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 4);
    const marketingRole = await prisma.platformRoleTemplate.findUniqueOrThrow({ where: { key: 'marketing_admin' } });
    const viewerRole = await prisma.platformRoleTemplate.create({
      data: { key: viewerRoleKey, name: 'M2 salt okunur', permissions: { create: [{ permissionKey: 'platform.marketing.view' }] } },
    });
    const marketing = await prisma.user.create({ data: { phone: marketingPhone, firstName: 'Pazarlama', lastName: 'Yonetici', passwordHash, phoneVerifiedAt: new Date() } });
    const viewer = await prisma.user.create({ data: { phone: viewerPhone, firstName: 'Salt', lastName: 'Okunur', passwordHash, phoneVerifiedAt: new Date() } });
    const marketing2 = await prisma.user.create({ data: { phone: marketing2Phone, firstName: 'Pazarlama', lastName: 'Ikinci', passwordHash, phoneVerifiedAt: new Date() } });
    marketingUserId = marketing.id;
    await prisma.platformMembership.create({ data: { userId: marketing2.id, roleTemplateId: marketingRole.id, status: 'ACTIVE', activatedAt: new Date() } });
    await prisma.platformMembership.create({ data: { userId: marketing.id, roleTemplateId: marketingRole.id, status: 'ACTIVE', activatedAt: new Date() } });
    await prisma.platformMembership.create({ data: { userId: viewer.id, roleTemplateId: viewerRole.id, status: 'ACTIVE', activatedAt: new Date() } });

    superAdminToken = await login(SUPER_ADMIN_PHONE);
    ownerToken = await login(ZEN_OWNER_PHONE);
    marketingToken = await login(marketingPhone);
    marketing2Token = await login(marketing2Phone);
    viewerToken = await login(viewerPhone);

    // AI key for the fake provider.
    const key = await as(superAdminToken).put('/admin/ai/settings/key').send({ apiKey: API_KEY });
    expect(key.status).toBe(200);

    // Contacts of the platform tenant with distinctive personal details, for the k-anonymity checks.
    const contacts = [
      ...Array.from({ length: 8 }, (_, i) => ({ stage: 'LEAD' as const, country: 'TR', source: 'newsletter', i })),
      ...Array.from({ length: 6 }, (_, i) => ({ stage: 'TRIAL' as const, country: 'TR', source: 'webinar', i: i + 8 })),
      ...Array.from({ length: 2 }, (_, i) => ({ stage: 'LOST' as const, country: 'FR', source: 'rare_source', i: i + 14 })),
    ];
    for (const c of contacts) {
      await prisma.contact.create({
        data: {
          studioId: PLATFORM,
          firstName: `${PII_NAME}${c.i}`,
          lastName: 'M2Marker',
          phone: `${PII_PHONE_PREFIX}${String(1000 + c.i)}`,
          email: `${PII_NAME.toLowerCase()}${c.i}@${PII_EMAIL_DOMAIN}`,
          lifecycleStage: c.stage,
          countryCode: c.country,
          locale: 'tr',
          firstSource: c.source,
        },
      });
    }
    const segment = await as(superAdminToken)
      .post(`/studios/${PLATFORM}/segments`)
      .set('x-studio-id', PLATFORM)
      .send({ name: `M2 e2e segment ${runId}`, kind: 'DYNAMIC', rules: { combinator: 'and', rules: [{ field: 'contact.lifecycleStage', op: 'in', value: ['LEAD'] }] } });
    expect(segment.status).toBe(201);
    segmentId = segment.body.id;
  });

  afterAll(async () => {
    await cleanup();
    await prisma.aiSettings.deleteMany({});
    const users = await prisma.user.findMany({ where: { phone: { in: [marketingPhone, marketing2Phone, viewerPhone] } }, select: { id: true } });
    await prisma.auditLog.deleteMany({ where: { userId: { in: users.map((u) => u.id) } } });
    await prisma.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });
    await prisma.platformRoleTemplate.deleteMany({ where: { key: viewerRoleKey } });
    if (previousMfaPolicy !== undefined) {
      await prisma.platformAccessSettings.update({ where: { id: 'platform' }, data: { require2faForPlatformRoles: previousMfaPolicy } });
    }
    await prisma.$disconnect();
    await app.close();
  });

  beforeEach(() => fake.reset());

  describe('brand kit and product facts', () => {
    it('starts empty and the studio refuses to write without a kit (409 BRAND_KIT_REQUIRED)', async () => {
      const view = await as(marketingToken).get('/platform/marketing/brand-kit');
      expect(view.status).toBe(200);
      expect(view.body).toMatchObject({ kit: null, facts: [], canEdit: true });
      const res = await generate({ brief: BRIEF, locales: ['tr'], kinds: ['SMS'] });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('BRAND_KIT_REQUIRED');
      expect(fake.requests).toHaveLength(0);
    });

    it('the marketing admin saves the kit; every save raises the version and is audit logged', async () => {
      const first = await as(marketingToken).put('/platform/marketing/brand-kit').send(KIT);
      expect(first.status).toBe(200);
      expect(first.body.kit).toMatchObject({ version: 1, brandName: 'Acme Platform', defaultLocale: 'tr', updatedByUserId: marketingUserId });
      expect(first.body.kit.locales.map((l: { locale: string }) => l.locale)).toEqual(['en', 'tr']);
      const tr = first.body.kit.locales.find((l: { locale: string }) => l.locale === 'tr');
      expect(tr.bannedPhrases).toEqual(['garanti', 'en iyi']);
      expect(tr.requiredDisclaimers.SMS).toBe('Cikis icin STOP yazin.');

      const second = await as(marketingToken).put('/platform/marketing/brand-kit').send({ ...KIT, positioning: 'Guncellendi' });
      expect(second.body.kit).toMatchObject({ version: 2, positioning: 'Guncellendi' });
      const audits = await prisma.auditLog.findMany({ where: { studioId: PLATFORM, action: 'marketing.brand_kit.update', userId: marketingUserId } });
      expect(audits.length).toBeGreaterThanOrEqual(2);
      expect(await prisma.brandKit.count({ where: { studioId: PLATFORM } })).toBe(1);
    });

    it('validates the kit (https links, default language row, duplicate languages)', async () => {
      const put = (body: unknown) => as(marketingToken).put('/platform/marketing/brand-kit').send(body as object);
      expect((await put({ ...KIT, links: { website: 'http://example.com' } })).status).toBe(400);
      expect((await put({ ...KIT, defaultLocale: 'de' })).status).toBe(400);
      expect((await put({ ...KIT, locales: [KIT.locales[0], KIT.locales[0]] })).status).toBe(400);
    });

    it('product facts: create, duplicate key 409, update, expire, delete; each change bumps the kit version', async () => {
      const before = (await as(marketingToken).get('/platform/marketing/brand-kit')).body.kit.version as number;
      const created = await as(marketingToken)
        .post('/platform/marketing/brand-kit/facts')
        .send({ key: 'platform.multi_tenant', category: 'product', statements: { tr: 'Cok kiracili yapi', en: 'Multi-tenant by design' } });
      expect(created.status).toBe(201);
      const dup = await as(marketingToken).post('/platform/marketing/brand-kit/facts').send({ key: 'platform.multi_tenant', statements: { tr: 'x' } });
      expect(dup.status).toBe(409);
      expect(dup.body.code).toBe('FACT_KEY_EXISTS');
      const expired = await as(marketingToken)
        .post('/platform/marketing/brand-kit/facts')
        .send({ key: 'promo.old', statements: { tr: 'Eski kampanya' }, validUntil: '2020-01-01' });
      expect(expired.status).toBe(201);
      const removable = await as(marketingToken).post('/platform/marketing/brand-kit/facts').send({ key: 'tmp.fact', statements: { tr: 'Gecici' } });
      const patched = await as(marketingToken).patch(`/platform/marketing/brand-kit/facts/${created.body.id}`).send({ statements: { tr: 'Cok kiracili yapi', en: 'Multi-tenant' } });
      expect(patched.status).toBe(200);
      expect(patched.body.statements.en).toBe('Multi-tenant');
      const removed = await as(marketingToken).delete(`/platform/marketing/brand-kit/facts/${removable.body.id}`);
      expect(removed.body).toEqual({ deleted: true });
      const after = await as(marketingToken).get('/platform/marketing/brand-kit');
      expect(after.body.facts.map((f: { key: string }) => f.key).sort()).toEqual(['platform.multi_tenant', 'promo.old']);
      expect(after.body.kit.version).toBe(before + 5);
      expect((await as(marketingToken).delete(`/platform/marketing/brand-kit/facts/${removable.body.id}`)).status).toBe(404);
    });

    it('a viewer reads the kit (canEdit false) but cannot change it or use the studio', async () => {
      const view = await as(viewerToken).get('/platform/marketing/brand-kit');
      expect(view.status).toBe(200);
      expect(view.body.canEdit).toBe(false);
      expect((await as(viewerToken).put('/platform/marketing/brand-kit').send(KIT)).status).toBe(403);
      expect((await as(viewerToken).post('/platform/marketing/brand-kit/facts').send({ key: 'x.y', statements: { tr: 'x' } })).status).toBe(403);
      expect((await generate({ brief: BRIEF, locales: ['tr'], kinds: ['SMS'] }, viewerToken)).status).toBe(403);
      expect((await as(viewerToken).get('/platform/marketing/studio/kit')).status).toBe(403);
      expect((await as(viewerToken).get('/platform/marketing/studio/drafts')).status).toBe(403);
    });
  });

  describe('AI studio drafts', () => {
    let emailDraftId: string;
    let smsDraftId: string;
    let smsVariantIds: string[];

    it('reports the marketing budget status', async () => {
      const res = await as(marketingToken).get('/platform/marketing/studio/status');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ configured: true, budgetCents: 5000, limitReached: false });
    });

    it('a brief becomes per-channel drafts with N variants, grounded on the kit and free of contact details', async () => {
      const res = await generate({ brief: { ...BRIEF, icpKey: 'studio_owner' }, locales: ['tr'], kinds: ['SMS', 'EMAIL'], variantCount: 3 });
      expect(res.status).toBe(200);
      expect(res.body.failures).toEqual([]);
      expect(res.body.drafts).toHaveLength(2);
      const sms = res.body.drafts.find((d: { kind: string }) => d.kind === 'SMS');
      const email = res.body.drafts.find((d: { kind: string }) => d.kind === 'EMAIL');
      smsDraftId = sms.id;
      emailDraftId = email.id;
      smsVariantIds = sms.variants.map((v: { id: string }) => v.id);
      expect(sms).toMatchObject({ status: 'DRAFT', locale: 'tr', brandKitVersion: expect.any(Number), exportedCampaignId: null });
      expect(sms.variants.map((v: { key: string }) => v.key)).toEqual(['A', 'B', 'C']);
      // The fake honours the required SMS disclaimer, so the stored variants pass every check.
      for (const v of sms.variants) {
        expect(v.content.text).toContain('Cikis icin STOP yazin.');
        expect(v.issues).toEqual([]);
      }
      expect(email.variants[0].content).toMatchObject({ subject: expect.any(String), preheader: expect.any(String), body: expect.any(String) });
      // Unknown fact keys returned by the model are dropped; the expired fact was never offered.
      expect(sms.factKeys).toEqual(['platform.multi_tenant']);

      expect(fake.requests).toHaveLength(2);
      for (const req of fake.requests) {
        expect(req.system[1]).toContain('platform.multi_tenant: Cok kiracili yapi');
        expect(req.system[1]).toContain('garanti');
        expect(req.system[1]).not.toContain('promo.old');
        expect(req.system[1]).toContain('studio_owner');
        const wire = JSON.stringify(req);
        expect(wire).not.toContain(PII_EMAIL_DOMAIN);
        expect(wire).not.toContain(PII_PHONE_PREFIX);
        expect(wire).toContain('[email]');
      }
      // The stored brief is the redacted one.
      const stored = await prisma.marketingDraft.findUniqueOrThrow({ where: { id: smsDraftId } });
      expect(JSON.stringify(stored.brief)).not.toContain(PII_EMAIL_DOMAIN);

      const usage = await prisma.aiUsage.findMany({ where: { studioId: PLATFORM, task: 'MARKETING_DRAFT', createdAt: { gte: startedAt } } });
      expect(usage.length).toBeGreaterThanOrEqual(2);
      expect(usage.every((u) => u.userId === marketingUserId && u.success)).toBe(true);
    });

    it('subject line and CTA variants are stored; a banned phrase is flagged and the draft is saved anyway', async () => {
      fake.marketingAppend = 'garanti';
      const res = await generate({ brief: BRIEF, locales: ['tr'], kinds: ['SUBJECT_LINES', 'CTA_VARIANTS'], variantCount: 5 });
      expect(res.status).toBe(200);
      const subjects = res.body.drafts.find((d: { kind: string }) => d.kind === 'SUBJECT_LINES');
      expect(subjects.variants).toHaveLength(5);
      expect(subjects.variants[0].issues).toContainEqual(expect.objectContaining({ code: 'BANNED_PHRASE', severity: 'BLOCKING', detail: 'garanti' }));
      expect(subjects.variants[1].issues).toEqual([]);
      expect(subjects.status).toBe('DRAFT');
    });

    it('editing a variant re-runs the checks; review is reset by an edit; invalid content is a 400', async () => {
      await as(marketingToken).patch(`/platform/marketing/studio/drafts/${emailDraftId}`).send({ status: 'REVIEWED' }).expect(200);
      const variantId = (await as(marketingToken).get(`/platform/marketing/studio/drafts/${emailDraftId}`)).body.variants[0].id as string;
      const edited = await as(marketingToken)
        .patch(`/platform/marketing/studio/drafts/${emailDraftId}/variants/${variantId}`)
        .send({ content: { subject: 'x'.repeat(80), preheader: '', body: 'Bu en iyi cozum <b>hemen</b>' } });
      expect(edited.status).toBe(200);
      expect(edited.body.status).toBe('DRAFT');
      const codes = edited.body.variants[0].issues.map((i: { code: string }) => i.code);
      expect(codes).toEqual(expect.arrayContaining(['LENGTH_EXCEEDED', 'BANNED_PHRASE', 'HTML']));
      expect(edited.body.variants[0].editedAt).not.toBeNull();
      const invalid = await as(marketingToken).patch(`/platform/marketing/studio/drafts/${emailDraftId}/variants/${variantId}`).send({ content: { subject: '' } });
      expect(invalid.status).toBe(400);
      expect(await prisma.auditLog.count({ where: { studioId: PLATFORM, action: 'marketing.draft.edit_variant', entityId: emailDraftId } })).toBe(1);
    });

    it('adds more variants to an existing draft from its stored brief', async () => {
      const res = await as(marketingToken).post(`/platform/marketing/studio/drafts/${smsDraftId}/variants`).send({ count: 2 });
      expect(res.status).toBe(200);
      expect(res.body.variants.map((v: { key: string }) => v.key)).toEqual(['A', 'B', 'C', 'D', 'E']);
      expect(fake.requests).toHaveLength(1);
      expect(JSON.stringify(fake.requests[0])).not.toContain(PII_EMAIL_DOMAIN);
    });

    it('A/B setup is stored on the draft (no send); variants must belong to the draft', async () => {
      const notificationsBefore = await prisma.notificationLog.count({ where: { studioId: PLATFORM } });
      const ok = await as(marketingToken)
        .put(`/platform/marketing/studio/drafts/${smsDraftId}/ab-test`)
        .send({ enabled: true, testSharePercent: 25, metric: 'CLICK', waitHours: 12, variantIds: smsVariantIds.slice(0, 2) });
      expect(ok.status).toBe(200);
      expect(ok.body.abTest).toMatchObject({ enabled: true, testSharePercent: 25, metric: 'CLICK', waitHours: 12 });
      const foreign = (await as(marketingToken).get(`/platform/marketing/studio/drafts/${emailDraftId}`)).body.variants[0].id as string;
      const bad = await as(marketingToken)
        .put(`/platform/marketing/studio/drafts/${smsDraftId}/ab-test`)
        .send({ enabled: true, variantIds: [smsVariantIds[0], foreign] });
      expect(bad.status).toBe(400);
      expect(await as(marketingToken).put(`/platform/marketing/studio/drafts/${smsDraftId}/ab-test`).send({ enabled: true, variantIds: [smsVariantIds[0]] }).then((r) => r.status)).toBe(400);
      expect(await prisma.notificationLog.count({ where: { studioId: PLATFORM } })).toBe(notificationsBefore);
    });

    it('generates ads, landing block, SEO outline and WhatsApp text within the channel limits', async () => {
      const res = await generate({
        brief: { ...BRIEF, sector: 'pilates' },
        locales: ['en'],
        kinds: ['AD_GOOGLE_RSA', 'AD_META', 'AD_LINKEDIN', 'LANDING_BLOCK', 'SEO_OUTLINE', 'WHATSAPP'],
        variantCount: 2,
      });
      expect(res.status).toBe(200);
      expect(res.body.drafts).toHaveLength(6);
      for (const draft of res.body.drafts) {
        expect(draft.locale).toBe('en');
        expect(draft.variants).toHaveLength(2);
        for (const v of draft.variants) expect(v.issues).toEqual([]);
      }
      const rsa = res.body.drafts.find((d: { kind: string }) => d.kind === 'AD_GOOGLE_RSA');
      for (const h of rsa.variants[0].content.headlines) expect([...h].length).toBeLessThanOrEqual(30);
      for (const d of rsa.variants[0].content.descriptions) expect([...d].length).toBeLessThanOrEqual(90);
    });

    it('validates generation requests (12 generations, 5 variants, known kinds)', async () => {
      expect((await generate({ brief: BRIEF, locales: ['tr'], kinds: ['SMS'], variantCount: 6 })).status).toBe(400);
      expect((await generate({ brief: BRIEF, locales: ['tr'], kinds: ['SEGMENT_SUGGESTION'] })).status).toBe(400);
      expect((await generate({ brief: BRIEF, locales: ['tr', 'en', 'de', 'fr'], kinds: ['SMS', 'EMAIL', 'AD_META', 'CTA_VARIANTS'] })).status).toBe(400);
      expect(fake.requests).toHaveLength(0);
    });

    it('a model failure other than the budget becomes a failure entry; all failing raises the error', async () => {
      fake.failNext.push('AI_TIMEOUT');
      const partial = await generate({ brief: BRIEF, locales: ['tr'], kinds: ['SMS', 'CTA_VARIANTS'], variantCount: 1 });
      expect(partial.status).toBe(200);
      expect(partial.body.failures).toEqual([{ kind: 'SMS', locale: 'tr', code: 'AI_TIMEOUT' }]);
      expect(partial.body.drafts).toHaveLength(1);
      fake.failNext.push('AI_TIMEOUT');
      const all = await generate({ brief: BRIEF, locales: ['tr'], kinds: ['SMS'], variantCount: 1 });
      expect(all.status).toBe(504);
      expect(all.body.code).toBe('AI_TIMEOUT');
    });

    it('"Kampanyaya aktar" creates a DRAFT campaign and a template, blocks unresolved brand issues, and never sends', async () => {
      const notificationsBefore = await prisma.notificationLog.count({ where: { studioId: PLATFORM } });
      // The edited e-mail draft still has blocking issues.
      const emailVariant = (await as(marketingToken).get(`/platform/marketing/studio/drafts/${emailDraftId}`)).body.variants[0].id as string;
      const blocked = await as(marketingToken).post(`/platform/marketing/studio/drafts/${emailDraftId}/export-campaign`).send({ variantId: emailVariant, segmentId });
      expect(blocked.status).toBe(409);
      expect(blocked.body.code).toBe('DRAFT_HAS_BLOCKING_ISSUES');

      const ok = await as(marketingToken)
        .post(`/platform/marketing/studio/drafts/${smsDraftId}/export-campaign`)
        .send({ variantId: smsVariantIds[1], segmentId, name: 'M2 e2e kampanya' });
      expect(ok.status).toBe(200);
      expect(ok.body).toMatchObject({ campaignStatus: 'DRAFT', templateKey: expect.stringMatching(/^MKT_[A-F0-9]{12}$/) });
      const campaign = await prisma.campaign.findUniqueOrThrow({ where: { id: ok.body.campaignId } });
      expect(campaign).toMatchObject({ studioId: PLATFORM, status: 'DRAFT', segmentId, channel: 'SMS', templateKey: ok.body.templateKey, scheduledAt: null, startedAt: null });
      expect(await prisma.campaignRecipient.count({ where: { campaignId: campaign.id } })).toBe(0);
      const template = await prisma.messageTemplate.findFirstOrThrow({ where: { studioId: PLATFORM, key: ok.body.templateKey } });
      expect(template).toMatchObject({ channel: 'SMS', locale: 'tr', isTransactional: false });
      expect(template.body).toContain('Cikis icin STOP yazin.');
      expect((await as(marketingToken).get(`/platform/marketing/studio/drafts/${smsDraftId}`)).body.exportedCampaignId).toBe(campaign.id);
      expect(await prisma.notificationLog.count({ where: { studioId: PLATFORM } })).toBe(notificationsBefore);

      // M3c: the stored A/B setup and its variants became the campaign's test (no longer stored only).
      expect(ok.body.abTest).toBe(true);
      expect(campaign.abTest).toEqual({ testShare: 25, metric: 'CLICK_RATE', waitMinutes: 720 });
      const carried = await prisma.campaignVariant.findMany({ where: { campaignId: campaign.id }, orderBy: { key: 'asc' } });
      expect(carried.map((v) => v.key)).toEqual(['A', 'B']);
      expect(carried.every((v) => v.aiDraftId === smsDraftId && v.templateKey !== null && !v.isWinner)).toBe(true);
      expect(carried[1].templateKey).toBe(ok.body.templateKey);
      expect(carried[0].templateKey).not.toBe(carried[1].templateKey);
      expect(await prisma.messageTemplate.count({ where: { studioId: PLATFORM, key: { in: carried.map((v) => v.templateKey as string) } } })).toBe(2);
      const single = await as(marketingToken)
        .post(`/platform/marketing/studio/drafts/${smsDraftId}/export-campaign`)
        .send({ variantId: smsVariantIds[1], segmentId, name: 'M2 e2e tek varyant', withAbTest: false });
      expect(single.status).toBe(200);
      expect(single.body.abTest).toBe(false);
      expect(await prisma.campaignVariant.count({ where: { campaignId: single.body.campaignId } })).toBe(0);
      expect(await prisma.campaign.findUniqueOrThrow({ where: { id: single.body.campaignId } })).toMatchObject({ abTest: null, sendTimeMode: 'FIXED' });

      // Other tenants' segments and non-message kinds are refused.
      const foreignSegment = await prisma.segment.findFirst({ where: { studioId: ZEN } });
      if (foreignSegment) {
        const cross = await as(marketingToken).post(`/platform/marketing/studio/drafts/${smsDraftId}/export-campaign`).send({ variantId: smsVariantIds[0], segmentId: foreignSegment.id });
        expect(cross.status).toBe(404);
      }
      const list = await as(marketingToken).get('/platform/marketing/studio/drafts?kind=CTA_VARIANTS');
      const cta = list.body.items[0];
      const notExportable = await as(marketingToken).post(`/platform/marketing/studio/drafts/${cta.id}/export-campaign`).send({ variantId: cta.variants[0].id, segmentId });
      expect(notExportable.status).toBe(400);
      expect(notExportable.body.code).toBe('DRAFT_KIND_NOT_EXPORTABLE');
    });

    it('an export needs the campaign right as well as the AI right', async () => {
      const role = await prisma.platformRoleTemplate.create({
        data: { key: `m2_ai_only_${runId}`, name: 'M2 ai only', permissions: { create: [{ permissionKey: 'platform.ai.use' }, { permissionKey: 'platform.marketing.view' }] } },
      });
      const phone = normalizePhone(`0539${runId}`)!;
      const user = await prisma.user.create({ data: { phone, firstName: 'Yalniz', lastName: 'Yz', passwordHash: await bcrypt.hash(DEMO_PASSWORD, 4), phoneVerifiedAt: new Date() } });
      await prisma.platformMembership.create({ data: { userId: user.id, roleTemplateId: role.id, status: 'ACTIVE', activatedAt: new Date() } });
      try {
        const token = await login(phone);
        expect((await as(token).get('/platform/marketing/studio/drafts')).status).toBe(200);
        // The studio reads the kit through its own route, so ai.use alone is enough to open it.
        const kit = await as(token).get('/platform/marketing/studio/kit');
        expect(kit.status).toBe(200);
        expect(kit.body.kit.brandName).toBe('Acme Platform');
        const res = await as(token).post(`/platform/marketing/studio/drafts/${smsDraftId}/export-campaign`).send({ variantId: smsVariantIds[0], segmentId });
        expect(res.status).toBe(403);
      } finally {
        await prisma.user.delete({ where: { id: user.id } });
        await prisma.platformRoleTemplate.delete({ where: { id: role.id } });
      }
    });

    it('archiving hides a draft from the default list and blocks edits and export', async () => {
      const archived = await as(marketingToken).patch(`/platform/marketing/studio/drafts/${smsDraftId}`).send({ status: 'ARCHIVED' });
      expect(archived.body.status).toBe('ARCHIVED');
      const visible = await as(marketingToken).get('/platform/marketing/studio/drafts?limit=100');
      expect(visible.body.items.map((d: { id: string }) => d.id)).not.toContain(smsDraftId);
      const hidden = await as(marketingToken).get('/platform/marketing/studio/drafts?status=ARCHIVED');
      expect(hidden.body.items.map((d: { id: string }) => d.id)).toContain(smsDraftId);
      const edit = await as(marketingToken).patch(`/platform/marketing/studio/drafts/${smsDraftId}/variants/${smsVariantIds[0]}`).send({ content: { text: 'x' } });
      expect(edit.status).toBe(409);
      const exp = await as(marketingToken).post(`/platform/marketing/studio/drafts/${smsDraftId}/export-campaign`).send({ variantId: smsVariantIds[0], segmentId });
      expect(exp.status).toBe(409);
    });
  });

  describe('segment suggestions and research notes', () => {
    it('the CRM insight is k-anonymous: no cell below k, no names, phones or e-mails', async () => {
      const res = await as(marketing2Token).get('/platform/marketing/studio/segment-insight');
      expect(res.status).toBe(200);
      expect(res.body.k).toBe(MARKETING_MIN_CELL);
      expect(res.body.totalContacts).toBeGreaterThanOrEqual(16);
      const cells = res.body.dimensions.flatMap((d: { cells: Array<{ label: string; count: number }> }) => d.cells);
      expect(cells.length).toBeGreaterThan(0);
      for (const cell of cells) expect(cell.count).toBeGreaterThanOrEqual(MARKETING_MIN_CELL);
      const wire = JSON.stringify(res.body);
      for (const marker of [PII_NAME, PII_EMAIL_DOMAIN, PII_PHONE_PREFIX, 'M2Marker']) expect(wire).not.toContain(marker);
      // The two French contacts and their rare source are suppressed.
      expect(wire).not.toContain('rare_source');
      const country = res.body.dimensions.find((d: { key: string }) => d.key === 'countryCode');
      expect(country.cells.map((c: { label: string }) => c.label)).not.toContain('FR');
    });

    it('suggestions never send or return personal data, rules are validated server side, small sizes are hidden', async () => {
      fake.includeInvalidSegment = true;
      const res = await as(marketing2Token).post('/platform/marketing/studio/segment-suggestions').send({ goal: 'Deneme surecindeki adaylar', count: 3 });
      expect(res.status).toBe(200);
      const { draft, insight } = res.body;
      expect(draft.kind).toBe('SEGMENT_SUGGESTION');
      expect(draft.status).toBe('DRAFT');
      // The invented field (contact.shoeSize) was rejected by the segment rule language.
      expect(draft.variants).toHaveLength(2);
      for (const v of draft.variants) {
        expect(v.content.approxCount === null || v.content.approxCount >= MARKETING_MIN_CELL).toBe(true);
        expect(JSON.stringify(v.content.rules)).not.toContain('shoeSize');
      }
      expect(insight.k).toBe(MARKETING_MIN_CELL);
      const requestWire = JSON.stringify(fake.requests);
      const responseWire = JSON.stringify(res.body);
      for (const marker of [PII_NAME, PII_EMAIL_DOMAIN, PII_PHONE_PREFIX, 'M2Marker']) {
        expect(requestWire).not.toContain(marker);
        expect(responseWire).not.toContain(marker);
      }
      const usage = await prisma.aiUsage.count({ where: { studioId: PLATFORM, task: 'MARKETING_ANALYSIS', createdAt: { gte: startedAt } } });
      expect(usage).toBe(1);
      // A suggestion is only a draft: no segment was created.
      expect(await prisma.segment.count({ where: { studioId: PLATFORM, name: { in: draft.variants.map((v: { content: { name: string } }) => v.content.name) } } })).toBe(0);
    });

    it('research mode is "cited notes": only points with a verbatim quote from a pasted source survive', async () => {
      fake.researchBadQuote = true;
      const res = await as(marketing2Token)
        .post('/platform/marketing/studio/research')
        .send({
          question: 'Rezervasyon yazilimi iptalleri azaltir mi?',
          sources: [
            { title: 'Rapor', url: 'https://example.com/rapor', text: 'Rezervasyon yazilimi kullananlar daha az iptal yasadi. Diger sonuclar belirsiz.' },
            { title: 'Not', text: 'Fiyatlar aylik faturalandirilir. Iletisim: kisi@example.org' },
          ],
        });
      expect(res.status).toBe(200);
      expect(res.body.kind).toBe('RESEARCH_NOTE');
      const content = res.body.variants[0].content;
      expect(content.mode).toBe('CITED_NOTES');
      expect(content.points).toHaveLength(2);
      for (const point of content.points) {
        expect(point.sourceId).toMatch(/^S\d$/);
        expect(point.quote.length).toBeGreaterThan(0);
      }
      expect(JSON.stringify(content.points)).not.toContain('Invented');
      expect(content.sources.map((s: { id: string }) => s.id)).toEqual(['S1', 'S2']);
      // Contact details typed into a pasted source never reach the model.
      expect(JSON.stringify(fake.requests)).not.toContain('kisi@example.org');
      const usage = await prisma.aiUsage.count({ where: { studioId: PLATFORM, task: 'MARKETING_RESEARCH', createdAt: { gte: startedAt } } });
      expect(usage).toBe(1);
      expect((await as(marketing2Token).post('/platform/marketing/studio/research').send({ question: 'x', sources: [] })).status).toBe(400);
    });
  });

  describe('content calendar', () => {
    let itemId: string;
    let draftId: string;

    it('the marketing admin creates, edits, moves and deletes items; campaigns show read-only in the same view', async () => {
      draftId = (await prisma.marketingDraft.findFirstOrThrow({ where: { studioId: PLATFORM, kind: 'EMAIL' } })).id;
      const created = await as(marketingToken)
        .post('/platform/marketing/calendar/items')
        .send({ title: 'Lansman e-postasi', channel: 'EMAIL', scheduledDate: '2026-10-21', draftId, ownerUserId: marketingUserId, notes: 'Onay bekliyor' });
      expect(created.status).toBe(201);
      itemId = created.body.id;
      expect(created.body).toMatchObject({ status: 'PLANNED', channel: 'EMAIL', scheduledDate: '2026-10-21', draftId, ownerName: 'Pazarlama Yonetici' });

      await prisma.campaign.create({
        data: { studioId: PLATFORM, name: 'M2 e2e planli', segmentId, channel: 'EMAIL', templateKey: 'BIRTHDAY', status: 'SCHEDULED', scheduledAt: new Date('2026-10-22T09:00:00.000Z') },
      });
      const view = await as(marketingToken).get('/platform/marketing/calendar?from=2026-10-01&to=2026-10-31');
      expect(view.status).toBe(200);
      expect(view.body.items.map((i: { id: string }) => i.id)).toContain(itemId);
      expect(view.body.campaigns).toContainEqual(expect.objectContaining({ name: 'M2 e2e planli', scheduledDate: '2026-10-22', status: 'SCHEDULED' }));

      const moved = await as(marketingToken).patch(`/platform/marketing/calendar/items/${itemId}`).send({ scheduledDate: '2026-10-25', status: 'DRAFTED' });
      expect(moved.status).toBe(200);
      expect(moved.body).toMatchObject({ scheduledDate: '2026-10-25', status: 'DRAFTED' });
      const outside = await as(marketingToken).get('/platform/marketing/calendar?from=2026-10-01&to=2026-10-24');
      expect(outside.body.items.map((i: { id: string }) => i.id)).not.toContain(itemId);
      const filtered = await as(marketingToken).get('/platform/marketing/calendar?from=2026-10-01&to=2026-10-31&status=APPROVED');
      expect(filtered.body.items).toEqual([]);
      expect(await prisma.auditLog.count({ where: { studioId: PLATFORM, action: 'marketing.calendar.move', entityId: itemId } })).toBe(1);
    });

    it('only planned, drafted and approved items move; sent and cancelled ones are locked; nothing is sent from the calendar', async () => {
      const notificationsBefore = await prisma.notificationLog.count({ where: { studioId: PLATFORM } });
      const sent = await as(marketingToken).patch(`/platform/marketing/calendar/items/${itemId}`).send({ status: 'SENT' });
      expect(sent.status).toBe(200);
      const locked = await as(marketingToken).patch(`/platform/marketing/calendar/items/${itemId}`).send({ scheduledDate: '2026-10-28' });
      expect(locked.status).toBe(409);
      expect(locked.body.code).toBe('CALENDAR_ITEM_LOCKED');
      // A same-day edit of a locked item is not a move.
      expect((await as(marketingToken).patch(`/platform/marketing/calendar/items/${itemId}`).send({ notes: 'Not' })).status).toBe(200);
      expect(await prisma.notificationLog.count({ where: { studioId: PLATFORM } })).toBe(notificationsBefore);
    });

    it('validates input and links: dates, channel, drafts and owners must exist on the platform side', async () => {
      const post = (body: object) => as(marketingToken).post('/platform/marketing/calendar/items').send(body);
      expect((await post({ title: 't', channel: 'EMAIL', scheduledDate: '2026-02-30' })).status).toBe(400);
      expect((await post({ title: 't', channel: 'PIGEON', scheduledDate: '2026-10-01' })).status).toBe(400);
      const foreign = await prisma.marketingDraft.create({ data: { studioId: ZEN, kind: 'SMS', locale: 'tr', title: 'M2 yabanci', brief: {} } });
      foreignDraftIds.push(foreign.id);
      expect((await post({ title: 't', channel: 'SMS', scheduledDate: '2026-10-01', draftId: foreign.id })).body.code).toBe('CALENDAR_DRAFT_NOT_FOUND');
      const zenOwner = await prisma.user.findUniqueOrThrow({ where: { phone: ZEN_OWNER_PHONE } });
      expect((await post({ title: 't', channel: 'SMS', scheduledDate: '2026-10-01', ownerUserId: zenOwner.id })).body.code).toBe('CALENDAR_OWNER_NOT_FOUND');
      expect((await as(marketingToken).get('/platform/marketing/calendar?from=2026-01-01&to=2026-12-31')).status).toBe(400);
      const owners = await as(marketingToken).get('/platform/marketing/calendar/owners');
      expect(owners.body.map((o: { id: string }) => o.id)).toContain(marketingUserId);
      expect(owners.body.map((o: { id: string }) => o.id)).not.toContain(zenOwner.id);
    });

    it('a viewer sees the calendar but cannot change it', async () => {
      expect((await as(viewerToken).get('/platform/marketing/calendar?from=2026-10-01&to=2026-10-31')).status).toBe(200);
      expect((await as(viewerToken).post('/platform/marketing/calendar/items').send({ title: 't', channel: 'EMAIL', scheduledDate: '2026-10-01' })).status).toBe(403);
      expect((await as(viewerToken).patch(`/platform/marketing/calendar/items/${itemId}`).send({ notes: 'x' })).status).toBe(403);
      expect((await as(viewerToken).delete(`/platform/marketing/calendar/items/${itemId}`)).status).toBe(403);
    });

    it('deleting an item leaves its draft and its audit trail', async () => {
      const removed = await as(marketingToken).delete(`/platform/marketing/calendar/items/${itemId}`);
      expect(removed.body).toEqual({ deleted: true });
      expect((await as(marketingToken).delete(`/platform/marketing/calendar/items/${itemId}`)).status).toBe(404);
      expect(await prisma.marketingDraft.count({ where: { id: draftId } })).toBe(1);
      expect(await prisma.auditLog.count({ where: { studioId: PLATFORM, action: 'marketing.calendar.delete', entityId: itemId } })).toBe(1);
    });
  });

  describe('tenant isolation and super admin', () => {
    it("another studio's owner and anonymous callers get 403 and 401 on every route", async () => {
      const routes: Array<[string, string]> = [
        ['get', '/platform/marketing/brand-kit'],
        ['put', '/platform/marketing/brand-kit'],
        ['post', '/platform/marketing/brand-kit/facts'],
        ['get', '/platform/marketing/studio/status'],
        ['get', '/platform/marketing/studio/segment-insight'],
        ['post', '/platform/marketing/studio/generate'],
        ['post', '/platform/marketing/studio/segment-suggestions'],
        ['post', '/platform/marketing/studio/research'],
        ['get', '/platform/marketing/studio/drafts'],
        ['get', '/platform/marketing/calendar?from=2026-10-01&to=2026-10-31'],
        ['post', '/platform/marketing/calendar/items'],
      ];
      for (const [method, url] of routes) {
        const denied = await (request(server) as unknown as Record<string, (u: string) => request.Test>)[method](url).set('Authorization', `Bearer ${ownerToken}`).set('x-studio-id', ZEN).send({});
        expect({ url, status: denied.status }).toEqual({ url, status: 403 });
        const anon = await (request(server) as unknown as Record<string, (u: string) => request.Test>)[method](url).send({});
        expect({ url, status: anon.status }).toEqual({ url, status: 401 });
      }
      expect(fake.requests).toHaveLength(0);
    });

    it("another tenant's drafts and calendar rows are invisible to the platform side (404, not listed)", async () => {
      const foreignDraft = await prisma.marketingDraft.findFirstOrThrow({ where: { studioId: ZEN } });
      const variant = await prisma.marketingDraftVariant.create({ data: { studioId: ZEN, draftId: foreignDraft.id, position: 0, key: 'A', content: { text: 'yabanci' } } });
      const foreignItem = await prisma.contentCalendarItem.create({ data: { studioId: ZEN, title: 'M2 yabanci takvim', channel: 'EMAIL', scheduledDate: new Date('2026-10-15T00:00:00.000Z') } });
      foreignItemIds.push(foreignItem.id);
      for (const token of [marketingToken, superAdminToken]) {
        expect((await as(token).get(`/platform/marketing/studio/drafts/${foreignDraft.id}`)).status).toBe(404);
        expect((await as(token).patch(`/platform/marketing/studio/drafts/${foreignDraft.id}`).send({ status: 'REVIEWED' })).status).toBe(404);
        expect((await as(token).patch(`/platform/marketing/studio/drafts/${foreignDraft.id}/variants/${variant.id}`).send({ content: { text: 'x' } })).status).toBe(404);
        expect((await as(token).patch(`/platform/marketing/calendar/items/${foreignItem.id}`).send({ notes: 'x' })).status).toBe(404);
        expect((await as(token).delete(`/platform/marketing/calendar/items/${foreignItem.id}`)).status).toBe(404);
        const list = await as(token).get('/platform/marketing/studio/drafts?limit=100');
        expect(list.body.items.map((d: { id: string }) => d.id)).not.toContain(foreignDraft.id);
        const calendar = await as(token).get('/platform/marketing/calendar?from=2026-10-01&to=2026-10-31');
        expect(calendar.body.items.map((i: { id: string }) => i.id)).not.toContain(foreignItem.id);
      }
      expect(await prisma.marketingDraft.findUniqueOrThrow({ where: { id: foreignDraft.id } })).toMatchObject({ status: 'DRAFT', studioId: ZEN });
      // The brand kit is per studio: the platform kit is the only one.
      expect(await prisma.brandKit.count({ where: { studioId: ZEN } })).toBe(0);
    });

    it('the super admin sees and edits everything on the platform side, including the marketing admin work', async () => {
      const kit = await as(superAdminToken).get('/platform/marketing/brand-kit');
      expect(kit.body).toMatchObject({ canEdit: true, kit: { brandName: 'Acme Platform' } });
      const drafts = await as(superAdminToken).get('/platform/marketing/studio/drafts?limit=100');
      expect(drafts.body.total).toBeGreaterThan(5);
      expect(drafts.body.items.some((d: { createdByUserId: string | null }) => d.createdByUserId === marketingUserId)).toBe(true);
      const edited = await as(superAdminToken).put('/platform/marketing/brand-kit').send({ ...KIT, positioning: 'Super admin duzenledi' });
      expect(edited.body.kit).toMatchObject({ positioning: 'Super admin duzenledi' });
      const own = await as(superAdminToken).get('/platform/marketing/calendar?from=2026-10-01&to=2026-10-31');
      expect(own.status).toBe(200);
    });
  });

  describe('marketing budget', () => {
    it('is a super admin setting (default 50 USD); the marketing admin cannot change it', async () => {
      const settings = await as(superAdminToken).get('/admin/ai/settings');
      expect(settings.body.marketingAiMonthlyBudgetCents).toBe(5000);
      expect(settings.body.models).toMatchObject({ MARKETING_DRAFT: 'claude-sonnet-5', MARKETING_ANALYSIS: 'claude-sonnet-5', MARKETING_RESEARCH: 'claude-sonnet-5' });
      expect((await as(marketingToken).patch('/admin/ai/settings').send({ marketingAiMonthlyBudgetCents: 999999 })).status).toBe(403);
    });

    it('is enforced before each call: 402 MARKETING_AI_BUDGET_EXCEEDED, no model call, no new usage row', async () => {
      const patched = await as(superAdminToken).patch('/admin/ai/settings').send({ marketingAiMonthlyBudgetCents: 1 });
      expect(patched.body.marketingAiMonthlyBudgetCents).toBe(1);
      try {
        const usageBefore = await prisma.aiUsage.count({ where: { studioId: PLATFORM, createdAt: { gte: startedAt } } });
        const status = await as(marketing2Token).get('/platform/marketing/studio/status');
        expect(status.body).toMatchObject({ budgetCents: 1, limitReached: true });

        const draft = await generate({ brief: BRIEF, locales: ['tr'], kinds: ['SMS'], variantCount: 1 }, marketing2Token);
        expect(draft.status).toBe(402);
        expect(draft.body.code).toBe('MARKETING_AI_BUDGET_EXCEEDED');
        const segments = await as(marketing2Token).post('/platform/marketing/studio/segment-suggestions').send({ goal: 'Adaylar', count: 1 });
        expect(segments.status).toBe(402);
        const research = await as(marketing2Token).post('/platform/marketing/studio/research').send({ question: 'Soru', sources: [{ title: 'K', text: 'Bir cumle. Ikinci.' }] });
        expect(research.status).toBe(402);
        const more = await as(marketing2Token).post(`/platform/marketing/studio/drafts/${(await prisma.marketingDraft.findFirstOrThrow({ where: { studioId: PLATFORM, kind: 'EMAIL' } })).id}/variants`).send({ count: 1 });
        expect(more.status).toBe(402);

        expect(fake.requests).toHaveLength(0);
        expect(await prisma.aiUsage.count({ where: { studioId: PLATFORM, createdAt: { gte: startedAt } } })).toBe(usageBefore);
        // Existing drafts stay readable and editable when the budget is used up.
        expect((await as(marketing2Token).get('/platform/marketing/studio/drafts')).status).toBe(200);
      } finally {
        await as(superAdminToken).patch('/admin/ai/settings').send({ marketingAiMonthlyBudgetCents: 5000 });
      }
      const again = await generate({ brief: BRIEF, locales: ['tr'], kinds: ['CTA_VARIANTS'], variantCount: 1 }, marketing2Token);
      expect(again.status).toBe(200);
    });

    it('0 switches the studio off', async () => {
      await as(superAdminToken).patch('/admin/ai/settings').send({ marketingAiMonthlyBudgetCents: 0 });
      try {
        const res = await generate({ brief: BRIEF, locales: ['tr'], kinds: ['SMS'], variantCount: 1 }, marketing2Token);
        expect(res.status).toBe(402);
        expect(res.body.code).toBe('MARKETING_AI_BUDGET_EXCEEDED');
      } finally {
        await as(superAdminToken).patch('/admin/ai/settings').send({ marketingAiMonthlyBudgetCents: 5000 });
      }
    });
  });

  describe('nothing is sent or published', () => {
    it('no message was sent by the studio or the calendar, and every campaign it made is a DRAFT', async () => {
      expect(await prisma.notificationLog.count({ where: { studioId: PLATFORM } })).toBe(baselineNotifications);
      const exported = await prisma.marketingDraft.findMany({ where: { studioId: PLATFORM, exportedCampaignId: { not: null } } });
      expect(exported.length).toBeGreaterThan(0);
      for (const draft of exported) {
        const campaign = await prisma.campaign.findUniqueOrThrow({ where: { id: draft.exportedCampaignId as string } });
        expect(campaign.status).toBe('DRAFT');
      }
    });
  });
});
