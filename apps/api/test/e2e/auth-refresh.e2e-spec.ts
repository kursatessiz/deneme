import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import * as bcrypt from 'bcrypt';
import { PrismaClient } from '@platform/database';
import { AppModule } from '../../src/app.module';

/**
 * Refresh token rotation: only the latest refresh token works, an older
 * one is rejected, and changing the PIN revokes the stored refresh token
 * while handing the caller a fresh pair. Uses a throwaway user per run.
 */
describe('Auth refresh rotation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let server: ReturnType<INestApplication['getHttpServer']>;
  const phone = `+90539${Date.now().toString().slice(-7)}`;
  const PIN = '482613';

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    await app.init();
    server = app.getHttpServer();
    prisma = new PrismaClient();
    await prisma.user.create({
      data: { phone, firstName: 'Rotation', lastName: 'Test', pinHash: await bcrypt.hash(PIN, 10), phoneVerifiedAt: new Date() },
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { phone } });
    await prisma.$disconnect();
    await app.close();
  });

  const pinLogin = () => request(server).post('/auth/pin/login').send({ phone, pin: PIN });
  const refresh = (refreshToken: string) => request(server).post('/auth/refresh').send({ refreshToken });

  it('rejects an old refresh token after rotation', async () => {
    const login = await pinLogin();
    expect(login.status).toBe(200);
    const first = login.body.refreshToken as string;

    const rotated = await refresh(first);
    expect(rotated.status).toBe(200);
    const second = rotated.body.refreshToken as string;
    expect(second).not.toBe(first);

    expect((await refresh(first)).status).toBe(401);
    expect((await refresh(second)).status).toBe(200);
  });

  it('stores a SHA-256 hex digest, not a bcrypt hash', async () => {
    await pinLogin();
    const user = await prisma.user.findUniqueOrThrow({ where: { phone }, select: { refreshTokenHash: true } });
    expect(user.refreshTokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changing the PIN revokes the previous refresh token and returns a fresh pair', async () => {
    const login = await pinLogin();
    const before = login.body.refreshToken as string;

    const changed = await request(server).put('/auth/pin').set('Authorization', `Bearer ${login.body.accessToken}`).send({ pin: PIN });
    expect(changed.status).toBe(200);
    expect(typeof changed.body.accessToken).toBe('string');
    expect(typeof changed.body.refreshToken).toBe('string');

    expect((await refresh(before)).status).toBe(401);
    expect((await refresh(changed.body.refreshToken)).status).toBe(200);
  });
});
