import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { PrismaClient } from '@platform/database';
import { AppModule } from '../../src/app.module';

/**
 * S3: AggregateRating of a tenant site's LocalBusiness data comes from the studio's real member session
 * ratings, only from five of them, only for the studio's own site, and not at all when the owner opts out.
 */

const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Demo1234!';
const OWNER_PHONE = '+905321000002';
const TRAINER_PHONE = '+905321000004';
const MEMBER_PHONE = '+905321000016';
const ZEN_SLUG = 'zen-reformer-pilates';
const HOUR = 60 * 60 * 1000;

describe('Sites: aggregate rating from real feedback (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let server: ReturnType<INestApplication['getHttpServer']>;
  let ZEN: string;
  let ownerToken: string;
  const bookingIds: string[] = [];
  const scheduleIds: string[] = [];

  const owner = {
    get: (url: string) => request(server).get(url).set('Authorization', `Bearer ${ownerToken}`).set('x-studio-id', ZEN),
    patch: (url: string) => request(server).patch(url).set('Authorization', `Bearer ${ownerToken}`).set('x-studio-id', ZEN),
  };

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer();
    prisma = new PrismaClient();
    ZEN = (await prisma.studio.findUniqueOrThrow({ where: { slug: ZEN_SLUG } })).id;
    const login = await request(server).post('/auth/login').send({ emailOrPhone: OWNER_PHONE, password: DEMO_PASSWORD });
    expect(login.status).toBe(200);
    ownerToken = login.body.accessToken as string;

    // Five attended sessions of one member, each rated (4, 5, 5, 4, 5): mean 4.6.
    const branch = await prisma.branch.findFirstOrThrow({ where: { studioId: ZEN } });
    const serviceTypeId = (await prisma.serviceType.findFirstOrThrow({ where: { studioId: ZEN, isActive: true } })).id;
    const trainerId = (await prisma.trainerProfile.findFirstOrThrow({ where: { studioId: ZEN, membership: { user: { phone: TRAINER_PHONE } } } })).id;
    const memberId = (await prisma.memberProfile.findFirstOrThrow({ where: { studioId: ZEN, membership: { user: { phone: MEMBER_PHONE } } } })).id;
    const scores = [4, 5, 5, 4, 5];
    for (const [i, score] of scores.entries()) {
      const start = new Date(Date.now() - (i + 2) * 24 * HOUR);
      const schedule = await prisma.sessionSchedule.create({
        data: { studioId: ZEN, branchId: branch.id, serviceTypeId, trainerId, title: 'S3 puan', startTime: start, endTime: new Date(start.getTime() + HOUR), capacity: 6 },
      });
      scheduleIds.push(schedule.id);
      const booking = await prisma.booking.create({ data: { studioId: ZEN, scheduleId: schedule.id, memberId, status: 'ATTENDED' } });
      bookingIds.push(booking.id);
      await prisma.sessionRating.create({ data: { studioId: ZEN, bookingId: booking.id, memberId, trainerProfileId: trainerId, serviceTypeId, score } });
    }
  });

  afterAll(async () => {
    await prisma.sessionRating.deleteMany({ where: { bookingId: { in: bookingIds } } });
    await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
    await prisma.sessionSchedule.deleteMany({ where: { id: { in: scheduleIds } } });
    const site = await prisma.site.findUnique({ where: { studioId: ZEN } });
    if (site) await prisma.site.update({ where: { id: site.id }, data: { seoSettings: {} } });
    await app.close();
    await prisma.$disconnect();
  });

  it('publishes the real mean and count from five ratings on', async () => {
    const res = await request(server).get(`/public/sites/${ZEN_SLUG}/settings`);
    expect(res.status).toBe(200);
    expect(res.body.aggregateRating).toEqual({ ratingValue: 4.6, reviewCount: 5, bestRating: 5 });
  });

  it('never publishes another studio rating or one for the platform site', async () => {
    const flowOwner = await request(server).post('/auth/login').send({ emailOrPhone: '+905321000022', password: DEMO_PASSWORD });
    const flow = await prisma.studio.findUniqueOrThrow({ where: { slug: 'flow-pilates-wellness' } });
    await request(server).get(`/sites/studio/${flow.id}`).set('Authorization', `Bearer ${flowOwner.body.accessToken}`).set('x-studio-id', flow.id);
    expect((await request(server).get('/public/sites/flow-pilates-wellness/settings')).body.aggregateRating).toBeNull();
    expect((await request(server).get('/public/sites/platform/settings')).body.aggregateRating).toBeNull();
  });

  it('leaves it out when the owner opts out, and brings it back when they opt in again', async () => {
    expect((await owner.get(`/sites/studio/${ZEN}`)).body.seo.showAggregateRating).toBe(true);
    const off = await owner.patch(`/sites/studio/${ZEN}`).send({ seo: { showAggregateRating: false } });
    expect(off.status).toBe(200);
    expect(off.body.seo.showAggregateRating).toBe(false);
    expect((await request(server).get(`/public/sites/${ZEN_SLUG}/settings`)).body.aggregateRating).toBeNull();
    expect((await owner.patch(`/sites/studio/${ZEN}`).send({ seo: { showAggregateRating: true } })).status).toBe(200);
    expect((await request(server).get(`/public/sites/${ZEN_SLUG}/settings`)).body.aggregateRating).toMatchObject({ reviewCount: 5 });
    expect((await owner.patch(`/sites/studio/${ZEN}`).send({ seo: { showAggregateRating: 'no' } })).status).toBe(400);
  });
});
