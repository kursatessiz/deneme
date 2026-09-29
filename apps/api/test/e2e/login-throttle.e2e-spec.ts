import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { AppModule } from '../../src/app.module';
import { LOGIN_MAX_FAILURES_PER_IDENTIFIER } from '../../src/modules/auth/login-throttle.service';

/**
 * Brute-force protection on password login: failed attempts per identifier
 * are capped, successful sign-ins never consume the budget and clear it.
 * Each run uses a fresh identifier so repeated runs (and a shared Redis)
 * never interfere.
 */

const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Demo1234!';
const OWNER_PHONE = '05321000002';

describe('Login throttle (e2e)', () => {
  let app: INestApplication;
  let server: ReturnType<INestApplication['getHttpServer']>;
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    await app.init();
    server = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
  });

  const login = (emailOrPhone: string, password: string) => request(server).post('/auth/login').send({ emailOrPhone, password });

  it('locks an identifier out with 429 after repeated failures, with the same answer whether or not it exists', async () => {
    const unknown = `nobody-${runId}@example.test`;
    for (let i = 0; i < LOGIN_MAX_FAILURES_PER_IDENTIFIER; i += 1) {
      const res = await login(unknown, 'wrong-password');
      expect(res.status).toBe(401);
    }
    const blocked = await login(unknown, 'wrong-password');
    expect(blocked.status).toBe(429);
    // Even the right password is refused while locked (here it has none).
    const stillBlocked = await login(unknown, DEMO_PASSWORD);
    expect(stillBlocked.status).toBe(429);
  });

  it('a lockout on one identifier does not block another, and successful logins never count', async () => {
    for (let i = 0; i < LOGIN_MAX_FAILURES_PER_IDENTIFIER + 3; i += 1) {
      const res = await login(OWNER_PHONE, DEMO_PASSWORD);
      expect(res.status).toBe(200);
    }
  });

  it('a successful login clears earlier failures for that identifier', async () => {
    for (let i = 0; i < LOGIN_MAX_FAILURES_PER_IDENTIFIER - 1; i += 1) {
      expect((await login(OWNER_PHONE, `wrong-${runId}`)).status).toBe(401);
    }
    expect((await login(OWNER_PHONE, DEMO_PASSWORD)).status).toBe(200);
    for (let i = 0; i < LOGIN_MAX_FAILURES_PER_IDENTIFIER - 1; i += 1) {
      expect((await login(OWNER_PHONE, `wrong-${runId}`)).status).toBe(401);
    }
    expect((await login(OWNER_PHONE, DEMO_PASSWORD)).status).toBe(200);
  });
});
