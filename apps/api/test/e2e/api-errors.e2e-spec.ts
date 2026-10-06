import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { randomUUID } from 'crypto';
import { PrismaClient } from '@platform/database';
import { translateApiErrorBody, BUNDLED_MESSAGES, BASE_MESSAGES, createTranslator } from '@platform/shared';
import { AppModule } from '../../src/app.module';

/**
 * API error bodies (docs/I18N.md, "API hata mesajları"): every user-facing
 * failure carries a stable `code` (the apiErrors key), the Turkish `message`
 * and, for dynamic text, `params`; clients translate from the code.
 */

const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Demo1234!';
const OWNER_PHONE = '+905321000002';

describe('API error bodies (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let server: ReturnType<INestApplication['getHttpServer']>;
  let zenId: string;
  let ownerToken: string;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    await app.init();
    server = app.getHttpServer();
    prisma = new PrismaClient();
    zenId = (await prisma.studio.findUniqueOrThrow({ where: { slug: 'zen-reformer-pilates' } })).id;
    const login = await request(server).post('/auth/login').send({ emailOrPhone: OWNER_PHONE, password: DEMO_PASSWORD });
    expect(login.status).toBe(200);
    ownerToken = login.body.accessToken as string;
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('carries code, Turkish message and status on a not-found error', async () => {
    const res = await request(server)
      .get(`/members/${randomUUID()}/studio/${zenId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-studio-id', zenId);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ statusCode: 404, code: 'apiErrors.common.memberNotFound', message: 'Üye bulunamadı' });
  });

  it('carries code and message on a failed login, without leaking which part was wrong', async () => {
    const res = await request(server)
      .post('/auth/login')
      .send({ emailOrPhone: `nobody-${randomUUID()}@example.test`, password: 'wrong-password' });
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ code: 'apiErrors.auth.incorrectEmailPhonePassword', message: 'Hatalı e-posta/telefon veya şifre' });
  });

  it('carries code and message next to the field errors of a rejected body', async () => {
    const res = await request(server)
      .post('/catalog/resource-types')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-studio-id', zenId)
      .send({ studioId: zenId });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'apiErrors.common.invalidRequest', message: 'Geçersiz istek' });
    expect(Array.isArray(res.body.errors)).toBe(true);
  });

  it('leaves a framework error without a code as it is', async () => {
    const res = await request(server)
      .get(`/members/${randomUUID()}/studio/${zenId}`)
      .set('Authorization', 'Bearer not-a-token');
    expect(res.status).toBe(401);
    // A framework 401 has no code: its message stays as the framework sends it.
    expect(res.body.code).toBeUndefined();
  });

  it('is translatable from the code alone (what web and mobile do)', async () => {
    const res = await request(server)
      .get(`/members/${randomUUID()}/studio/${zenId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-studio-id', zenId);
    const en = createTranslator({ locale: 'en', messages: BUNDLED_MESSAGES.en, fallback: BASE_MESSAGES });
    expect(translateApiErrorBody(res.body as Record<string, unknown>, en)?.message).toBe('Member not found');
  });
});
