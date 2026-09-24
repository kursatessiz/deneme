import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { PrismaClient } from '@platform/database';
import { AppModule } from '../../src/app.module';

/** W3: user appearance and studio theme families. Restores everything it changes. */

const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Demo1234!';
const MEMBER_PHONE = '+905321000016';

describe('Appearance and studio theme (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let server: any;
  let ZEN: string;
  let FLOW: string;
  let ownerToken: string;
  let trainerToken: string;
  let memberToken: string;
  let originalTheme: { themeFamily: string; themePrimary: string; gradientPresetKey: string; logoUrl: string | null };

  const login = async (phone: string) => {
    const res = await request(server).post('/auth/login').send({ emailOrPhone: phone, password: DEMO_PASSWORD });
    expect(res.status).toBe(200);
    return res.body.accessToken as string;
  };

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer();
    prisma = new PrismaClient();
    const zen = await prisma.studio.findUniqueOrThrow({ where: { slug: 'zen-reformer-pilates' } });
    ZEN = zen.id;
    originalTheme = {
      themeFamily: zen.themeFamily,
      themePrimary: zen.themePrimary,
      gradientPresetKey: zen.gradientPresetKey,
      logoUrl: zen.logoUrl,
    };
    FLOW = (await prisma.studio.findUniqueOrThrow({ where: { slug: 'flow-pilates-wellness' } })).id;
    ownerToken = await login('+905321000002');
    trainerToken = await login('+905321000004');
    memberToken = await login(MEMBER_PHONE);
  });

  afterAll(async () => {
    await prisma.studio.update({ where: { id: ZEN }, data: originalTheme });
    await prisma.user.update({ where: { phone: MEMBER_PHONE }, data: { themeFamily: null, colorScheme: 'SYSTEM' } });
    await prisma.auditLog.deleteMany({ where: { entityId: ZEN, action: 'studio.theme.update' } });
    await prisma.$disconnect();
    await app.close();
  });

  describe('user appearance', () => {
    it('defaults to the studio theme and the system mode', async () => {
      const res = await request(server).get('/me/appearance').set('Authorization', `Bearer ${memberToken}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ themeFamily: null, colorScheme: 'SYSTEM' });
    });

    it('requires authentication', async () => {
      expect((await request(server).get('/me/appearance')).status).toBe(401);
    });

    it('saves a family and mode and returns it in /auth/me', async () => {
      const put = await request(server)
        .put('/me/appearance')
        .set('Authorization', `Bearer ${memberToken}`)
        .send({ themeFamily: 'nefes', colorScheme: 'DARK' });
      expect(put.status).toBe(200);
      expect(put.body).toEqual({ themeFamily: 'nefes', colorScheme: 'DARK' });

      const me = await request(server).get('/auth/me').set('Authorization', `Bearer ${memberToken}`);
      expect(me.body.appearance).toEqual({ themeFamily: 'nefes', colorScheme: 'DARK' });
    });

    it('rejects unknown families and modes', async () => {
      for (const body of [
        { themeFamily: 'mor', colorScheme: 'SYSTEM' },
        { themeFamily: null, colorScheme: 'NEON' },
      ]) {
        const res = await request(server).put('/me/appearance').set('Authorization', `Bearer ${memberToken}`).send(body);
        expect(res.status).toBe(400);
      }
    });
  });

  describe('studio theme', () => {
    const sahaTheme = { logoUrl: null, themeFamily: 'saha', themePrimary: '#1FA37A', gradientPresetKey: 'saha-yesil' };

    it('memberships in /auth/me carry the studio theme', async () => {
      const me = await request(server).get('/auth/me').set('Authorization', `Bearer ${memberToken}`);
      const zen = me.body.memberships.find((m: any) => m.studioId === ZEN);
      expect(zen.theme.themeFamily).toBe(originalTheme.themeFamily);
      expect(zen.theme.gradientPresetKey).toBe(originalTheme.gradientPresetKey);
    });

    it('owner updates the theme; members see it and it is audited', async () => {
      const res = await request(server).put(`/studios/${ZEN}/theme`).set('Authorization', `Bearer ${ownerToken}`).send(sahaTheme);
      expect(res.status).toBe(200);
      expect(res.body).toEqual(sahaTheme);

      const me = await request(server).get('/auth/me').set('Authorization', `Bearer ${memberToken}`);
      expect(me.body.memberships.find((m: any) => m.studioId === ZEN).theme).toEqual(sahaTheme);

      const audit = await prisma.auditLog.findFirst({ where: { entityId: ZEN, action: 'studio.theme.update' } });
      expect(audit).not.toBeNull();
    });

    it('a gradient from another family -> 400', async () => {
      const res = await request(server)
        .put(`/studios/${ZEN}/theme`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ ...sahaTheme, gradientPresetKey: 'nefes-lavanta' });
      expect(res.status).toBe(400);
    });

    it('free-form colors are rejected', async () => {
      const res = await request(server)
        .put(`/studios/${ZEN}/theme`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ ...sahaTheme, themePrimary: 'purple' });
      expect(res.status).toBe(400);
    });

    it('trainer and member cannot change the theme', async () => {
      for (const token of [trainerToken, memberToken]) {
        const res = await request(server).put(`/studios/${ZEN}/theme`).set('Authorization', `Bearer ${token}`).send(sahaTheme);
        expect(res.status).toBe(403);
      }
    });

    it('owner cannot change another tenant theme', async () => {
      const res = await request(server).put(`/studios/${FLOW}/theme`).set('Authorization', `Bearer ${ownerToken}`).send(sahaTheme);
      expect(res.status).toBe(403);
    });

    it('public studio page exposes the theme family', async () => {
      const res = await request(server).get('/studios/public/zen-reformer-pilates');
      expect(res.status).toBe(200);
      expect(res.body.themeFamily).toBe('saha');
    });
  });
});
