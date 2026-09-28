import { Test, TestingModule } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import * as request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureBodyParsers } from '../../src/common/body-parsers';

/**
 * Body parsing exactly as src/main.ts sets it up (bodyParser: false plus
 * configureBodyParsers). Other e2e suites use Nest's default parsers, so
 * this is the only place that would catch a production-only parsing bug,
 * such as a path-scoped parser silently disabling the global one.
 */

const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Demo1234!';
const SUPER_ADMIN_PHONE = '+905321000001';
const OWNER_PHONE = '+905321000002';

describe('Body parsers (e2e, production setup)', () => {
  let app: NestExpressApplication;
  let server: Parameters<typeof request>[0];

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
    configureBodyParsers(app);
    await app.init();
    server = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
  });

  it('parses ordinary JSON bodies on every route', async () => {
    const res = await request(server).post('/auth/login').send({ emailOrPhone: OWNER_PHONE, password: DEMO_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
  });

  it('rejects oversized bodies on ordinary routes', async () => {
    const res = await request(server)
      .post('/auth/login')
      .send({ emailOrPhone: OWNER_PHONE, password: 'x'.repeat(200 * 1024) });
    expect(res.status).toBe(413);
  });

  it('accepts a language pack larger than the default limit on the import route', async () => {
    const login = await request(server).post('/auth/login').send({ emailOrPhone: SUPER_ADMIN_PHONE, password: DEMO_PASSWORD });
    expect(login.status).toBe(200);
    const pack = JSON.stringify({
      format: 'platform.language-pack',
      formatVersion: 1,
      locale: 'en',
      baseLocale: 'tr',
      messages: { 'common.save': 'Save' },
      padding: 'x'.repeat(300 * 1024),
    });
    const res = await request(server)
      .post('/admin/i18n/languages/en/import')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .send({ format: 'json', content: pack, dryRun: true });
    // Parsed and handled by the controller (the pack itself is rejected for
    // its unknown "padding" field), never cut off by the body size limit.
    expect(res.status).not.toBe(413);
    expect(res.status).toBe(400);
  });

  it('parses the Stripe webhook route as raw bytes, not JSON, and rejects an unverifiable signature', async () => {
    // With no STRIPE_WEBHOOK_SECRET configured in this test env, the
    // adapter's verifyWebhook rejects every signature. What this proves is
    // that the route went through the raw-body middleware (not the JSON
    // parser -- a JSON-parsing failure would also be a 400, but from Express
    // itself, before the controller ever runs) and reached the controller's
    // ordinary "invalid webhook signature" handling, the same 400 every
    // other provider's webhook gives for a bad signature.
    const res = await request(server)
      .post('/payments/webhook/stripe')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', 't=1,v1=deadbeef')
      .send('{"id":"evt_test","type":"payment_intent.succeeded"}');
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('imza');
  });
});
