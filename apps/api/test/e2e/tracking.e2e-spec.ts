import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { PrismaClient } from '@platform/database';
import { AppModule } from '../../src/app.module';
import { TRACKING_MAX_PER_IP, TRACKING_MAX_PER_VISITOR } from '../../src/modules/crm/tracking/tracking-rate-limit.guard';

/**
 * G1b: public POST /track/:studioSlug/touchpoint. Consent gating (nothing
 * stored without analytics consent, no click ids or Meta cookies without
 * advertising consent), query-string stripping, bot filtering, the
 * `platform` slug, validation and the per-visitor and per-IP rate limits.
 *
 * Each rate-limit case boots its own Nest application so the in-memory
 * counters (no Redis in the test environment) start empty. All visitors
 * use ids with the e2e7 prefix and are deleted (touchpoints cascade).
 */

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

function vid(n: number): string {
  return `e2e70000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
}

function body(visitorId: string, overrides: Record<string, unknown> = {}) {
  return {
    visitorId,
    sessionId: 'e2e7aaaa-0000-4000-8000-000000000001',
    landingUrl: 'https://studio.example/tr/pilates?utm_source=google&utm_medium=cpc&pw_cid=111&pw_asid=222&pw_adid=333&gclid=GCLID-1#top',
    referrer: 'https://www.google.com/search?q=private+words',
    utm: {},
    adIds: {},
    clickIds: {},
    fbp: 'fb.1.1700000000.42',
    locale: 'tr',
    consent: { analytics: true, advertising: true },
    ...overrides,
  };
}

async function bootApp() {
  const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  return app;
}

describe('Tracking (e2e)', () => {
  let app: INestApplication;
  let server: any;
  let prisma: PrismaClient;
  let ZEN: string;
  let PLATFORM: string;

  const usedVisitorIds = [...Array.from({ length: 11 }, (_, i) => vid(i)), ...Array.from({ length: 80 }, (_, i) => vid(100 + i))];
  const cleanup = () => prisma.visitor.deleteMany({ where: { id: { in: usedVisitorIds } } });

  beforeAll(async () => {
    app = await bootApp();
    server = app.getHttpServer();
    prisma = new PrismaClient();
    ZEN = (await prisma.studio.findUniqueOrThrow({ where: { slug: 'zen-reformer-pilates' } })).id;
    PLATFORM = (await prisma.studio.findFirstOrThrow({ where: { isPlatform: true } })).id;
    await cleanup();
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
    await app.close();
  });

  const track = (slug: string, payload: object, ua = UA) =>
    request(server).post(`/track/${slug}/touchpoint`).set('User-Agent', ua).set('CF-IPCountry', 'DE').send(payload);

  it('stores a touchpoint with path only, referrer host only and a coarse country', async () => {
    const res = await track('zen-reformer-pilates', body(vid(1)));
    expect(res.status).toBe(204);
    const tp = await prisma.touchpoint.findFirstOrThrow({ where: { studioId: ZEN, visitorId: vid(1) } });
    expect(tp.landingPath).toBe('/tr/pilates');
    expect(tp.landingHost).toBe('studio.example');
    expect(tp.referrerHost).toBe('www.google.com');
    expect(tp.utmSource).toBe('google');
    expect(tp.pwCid).toBe('111');
    expect(tp.gclid).toBe('GCLID-1');
    expect(tp.fbp).toBe('fb.1.1700000000.42');
    expect(tp.adPlatform).toBe('GOOGLE');
    expect(tp.countryCode).toBe('DE');
    expect(tp.deviceType).toBe('desktop');
    expect(tp.isPaidUntagged).toBe(false);
    expect(JSON.stringify(tp)).not.toContain('private');
    const visitor = await prisma.visitor.findUniqueOrThrow({ where: { studioId_id: { studioId: ZEN, id: vid(1) } } });
    expect(visitor.contactId).toBeNull();
  });

  it('without analytics consent answers 204 and stores nothing', async () => {
    const res = await track('zen-reformer-pilates', body(vid(2), { consent: { analytics: false, advertising: true } }));
    expect(res.status).toBe(204);
    expect(await prisma.visitor.count({ where: { id: vid(2) } })).toBe(0);
    expect(await prisma.touchpoint.count({ where: { visitorId: vid(2) } })).toBe(0);
  });

  it('without advertising consent drops click ids and Meta cookies but keeps campaign ids', async () => {
    const res = await track('zen-reformer-pilates', body(vid(3), { consent: { analytics: true, advertising: false }, fbc: 'fb.1.1.X' }));
    expect(res.status).toBe(204);
    const tp = await prisma.touchpoint.findFirstOrThrow({ where: { studioId: ZEN, visitorId: vid(3) } });
    expect(tp.gclid).toBeNull();
    expect(tp.fbp).toBeNull();
    expect(tp.fbc).toBeNull();
    expect(tp.pwCid).toBe('111');
    expect(tp.utmMedium).toBe('cpc');
  });

  it('flags paid traffic without our ad ids', async () => {
    await track('zen-reformer-pilates', body(vid(4), { landingUrl: 'https://studio.example/?fbclid=ABC' }));
    const tp = await prisma.touchpoint.findFirstOrThrow({ where: { studioId: ZEN, visitorId: vid(4) } });
    expect(tp.isPaidUntagged).toBe(true);
    expect(tp.adPlatform).toBe('META');
  });

  it('ignores bots and unknown studios with the same 204', async () => {
    const bot = await track('zen-reformer-pilates', body(vid(5)), 'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)');
    expect(bot.status).toBe(204);
    const unknown = await track('no-such-studio', body(vid(6)));
    expect(unknown.status).toBe(204);
    expect(await prisma.visitor.count({ where: { id: { in: [vid(5), vid(6)] } } })).toBe(0);
  });

  it('the platform slug tracks into the platform tenant', async () => {
    const res = await track('platform', body(vid(7)));
    expect(res.status).toBe(204);
    expect(await prisma.touchpoint.count({ where: { studioId: PLATFORM, visitorId: vid(7) } })).toBe(1);
  });

  it('rejects malformed bodies', async () => {
    expect((await track('zen-reformer-pilates', { ...body(vid(8)), visitorId: 'nope' })).status).toBe(400);
    expect((await track('zen-reformer-pilates', { ...body(vid(8)), extra: 1 })).status).toBe(400);
    const { consent: _consent, ...withoutConsent } = body(vid(8));
    expect((await track('zen-reformer-pilates', withoutConsent)).status).toBe(400);
  });

  it(`limits one visitor to ${TRACKING_MAX_PER_VISITOR} requests per minute`, async () => {
    const limited = await bootApp();
    try {
      const srv = limited.getHttpServer();
      const send = () =>
        request(srv).post('/track/zen-reformer-pilates/touchpoint').set('User-Agent', UA).send(body(vid(9), { consent: { analytics: false, advertising: false } }));
      for (let i = 0; i < TRACKING_MAX_PER_VISITOR; i++) expect((await send()).status).toBe(204);
      expect((await send()).status).toBe(429);
      // Another visitor from the same address is still fine.
      const other = await request(srv)
        .post('/track/zen-reformer-pilates/touchpoint')
        .set('User-Agent', UA)
        .send(body(vid(10), { consent: { analytics: false, advertising: false } }));
      expect(other.status).toBe(204);
    } finally {
      await limited.close();
    }
  });

  it(`limits one IP address to ${TRACKING_MAX_PER_IP} requests per minute`, async () => {
    const limited = await bootApp();
    try {
      const srv = limited.getHttpServer();
      const send = (n: number) =>
        request(srv)
          .post('/track/zen-reformer-pilates/touchpoint')
          .set('User-Agent', UA)
          .send(body(vid(100 + n), { consent: { analytics: false, advertising: false } }));
      for (let i = 0; i < TRACKING_MAX_PER_IP; i++) expect((await send(i)).status).toBe(204);
      expect((await send(TRACKING_MAX_PER_IP)).status).toBe(429);
    } finally {
      await limited.close();
    }
  });
});
