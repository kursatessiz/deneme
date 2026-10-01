import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { PrismaClient } from '@platform/database';
import { BRANDING_HIDE_BADGE_FLAG } from '@platform/shared';
import { AppModule } from '../../src/app.module';

/**
 * S3: the plan-gated "Powered by" badge. The public embed config (booking page, event pages, widget) and the
 * public site settings (page engine footer) expose `showPoweredBy`, default shown; the `branding.hide_badge`
 * flag, set per tenant by the super admin like any other flag, hides it; the platform tenant never shows it.
 */

const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Demo1234!';
const SUPER_ADMIN_PHONE = '+905321000001';
const ZEN_SLUG = 'zen-reformer-pilates';

describe('Branding: powered-by badge (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let server: ReturnType<INestApplication['getHttpServer']>;
  let zenId: string;
  let superAdminToken: string;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer();
    prisma = new PrismaClient();
    zenId = (await prisma.studio.findUniqueOrThrow({ where: { slug: ZEN_SLUG } })).id;
    const login = await request(server).post('/auth/login').send({ emailOrPhone: SUPER_ADMIN_PHONE, password: DEMO_PASSWORD });
    expect(login.status).toBe(200);
    superAdminToken = login.body.accessToken as string;
  });

  afterAll(async () => {
    await prisma.featureFlag.deleteMany({ where: { key: BRANDING_HIDE_BADGE_FLAG, studioId: zenId } });
    await app.close();
    await prisma.$disconnect();
  });

  const setFlag = (enabled: boolean) =>
    request(server)
      .post('/admin/feature-flags')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ key: BRANDING_HIDE_BADGE_FLAG, scope: 'TENANT', studioId: zenId, enabled });

  it('is part of the super admin flag catalog', async () => {
    const res = await request(server).get('/admin/feature-flags/catalog').set('Authorization', `Bearer ${superAdminToken}`);
    expect(res.status).toBe(200);
    expect((res.body.items as Array<{ key: string }>).map((i) => i.key)).toContain(BRANDING_HIDE_BADGE_FLAG);
  });

  it('shows the badge by default with the tenant attribution link', async () => {
    const res = await request(server).get(`/public/studios/${ZEN_SLUG}/embed/config`);
    expect(res.status).toBe(200);
    expect(res.body.showPoweredBy).toBe(true);
    const url = new URL(res.body.poweredByUrl as string);
    expect(url.searchParams.get('utm_source')).toBe('tenant-site');
    expect(url.searchParams.get('utm_medium')).toBe('badge');
    expect(url.searchParams.get('utm_campaign')).toBe(ZEN_SLUG);

    const settings = await request(server).get(`/public/sites/${ZEN_SLUG}/settings`);
    expect(settings.status).toBe(200);
    expect(settings.body).toEqual({ showPoweredBy: true, poweredByUrl: res.body.poweredByUrl });
  });

  it('hides the badge once the super admin turns the tenant flag on, and shows it again when off', async () => {
    expect((await setFlag(true)).status).toBeLessThan(300);
    const hidden = await request(server).get(`/public/studios/${ZEN_SLUG}/embed/config`);
    expect(hidden.body).toMatchObject({ showPoweredBy: false, poweredByUrl: null });
    const hiddenSettings = await request(server).get(`/public/sites/${ZEN_SLUG}/settings`);
    expect(hiddenSettings.body).toEqual({ showPoweredBy: false, poweredByUrl: null });

    expect((await setFlag(false)).status).toBeLessThan(300);
    const shown = await request(server).get(`/public/studios/${ZEN_SLUG}/embed/config`);
    expect(shown.body.showPoweredBy).toBe(true);
  });

  it('never shows the badge on the platform tenant', async () => {
    const res = await request(server).get('/public/studios/platform/embed/config');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ showPoweredBy: false, poweredByUrl: null });
    const settings = await request(server).get('/public/sites/platform/settings');
    expect(settings.body).toEqual({ showPoweredBy: false, poweredByUrl: null });
  });

  it('answers 404 for the settings of an unknown site', async () => {
    const res = await request(server).get('/public/sites/no-such-studio-xyz/settings');
    expect(res.status).toBe(404);
  });
});
