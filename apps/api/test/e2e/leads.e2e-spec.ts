import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { PrismaClient } from '@platform/database';
import { AppModule } from '../../src/app.module';

/**
 * W11: lead pipeline. Public web-form endpoint (rate limit, honeypot,
 * dedupe, constant response), staff CRUD, stage transition rules, owner
 * assignment, conversion to member, trial booking, permission denials and
 * cross-tenant isolation.
 *
 * The public-form describe block boots its own Nest application so the
 * in-memory rate-limit bucket (no Redis in this test environment) starts
 * fresh and its budget is not shared with, or exhausted by, any other test.
 */

const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Demo1234!';
const HOUR = 3600_000;
const OWNER_PHONE = '+905321000002';
const TRAINER_PHONE = '+905321000004';
const MEMBER_PHONE = '+905321000016';

describe('Leads (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let server: any;

  let ZEN: string;
  let FLOW: string;
  let ownerToken: string;
  let trainerToken: string;
  let receptionToken: string;

  let ownerMembershipId: string;
  let trainerMembershipId: string;
  let selfMemberMembershipId: string;
  let matServiceTypeId: string;

  const leadIds: string[] = [];
  const scheduleIds: string[] = [];
  const bookingIds: string[] = [];
  const membershipIds: string[] = [];
  const userIds: string[] = [];

  const login = async (phone: string) => {
    const res = await request(server).post('/auth/login').send({ emailOrPhone: phone, password: DEMO_PASSWORD });
    expect(res.status).toBe(200);
    return res.body.accessToken as string;
  };

  const as = (token: string, studioId = ZEN) => ({
    get: (url: string) => request(server).get(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId),
    post: (url: string) => request(server).post(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId),
    put: (url: string) => request(server).put(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId),
  });

  const makeMatSchedule = async (startInHours: number) => {
    const start = new Date(Date.now() + startInHours * HOUR);
    const s = await prisma.sessionSchedule.create({
      data: {
        studioId: ZEN,
        serviceTypeId: matServiceTypeId,
        title: 'E2E lead trial',
        startTime: start,
        endTime: new Date(start.getTime() + HOUR),
        capacity: 10,
      },
    });
    scheduleIds.push(s.id);
    return s.id;
  };

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer();
    prisma = new PrismaClient();

    ZEN = (await prisma.studio.findUniqueOrThrow({ where: { slug: 'zen-reformer-pilates' } })).id;
    FLOW = (await prisma.studio.findUniqueOrThrow({ where: { slug: 'flow-pilates-wellness' } })).id;
    matServiceTypeId = (
      await prisma.serviceType.findFirstOrThrow({ where: { studioId: ZEN, name: 'Mat Pilates' } })
    ).id;

    ownerMembershipId = (
      await prisma.membership.findFirstOrThrow({ where: { studioId: ZEN, user: { phone: OWNER_PHONE } } })
    ).id;
    trainerMembershipId = (
      await prisma.membership.findFirstOrThrow({ where: { studioId: ZEN, user: { phone: TRAINER_PHONE } } })
    ).id;
    selfMemberMembershipId = (
      await prisma.membership.findFirstOrThrow({ where: { studioId: ZEN, user: { phone: MEMBER_PHONE } } })
    ).id;
    const reception = await prisma.membership.findFirstOrThrow({
      where: { studioId: ZEN, roleTemplate: { key: 'reception' } },
      include: { user: true },
    });

    ownerToken = await login(OWNER_PHONE);
    trainerToken = await login(TRAINER_PHONE);
    receptionToken = await login(reception.user.phone);
  });

  afterAll(async () => {
    await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
    await prisma.sessionSchedule.deleteMany({ where: { id: { in: scheduleIds } } });
    await prisma.leadActivity.deleteMany({ where: { leadId: { in: leadIds } } });
    await prisma.lead.deleteMany({ where: { id: { in: leadIds } } });
    await prisma.lead.deleteMany({ where: { studioId: { in: [ZEN, FLOW] }, phone: { startsWith: '+90539999' } } });
    await prisma.memberProfile.deleteMany({ where: { membershipId: { in: membershipIds } } });
    await prisma.membership.deleteMany({ where: { id: { in: membershipIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
    await app.close();
  });

  describe('public web form', () => {
    let publicApp: INestApplication;
    let publicServer: any;

    beforeAll(async () => {
      const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
      publicApp = moduleRef.createNestApplication();
      await publicApp.init();
      publicServer = publicApp.getHttpServer();
    });

    afterAll(async () => {
      await publicApp.close();
    });

    it('an unknown studio slug returns 202 and creates nothing', async () => {
      const res = await request(publicServer)
        .post('/public/studios/does-not-exist/leads')
        .send({ fullName: 'Ghost Lead', phone: '+905399990199', consent: true });
      expect(res.status).toBe(202);

      const lead = await prisma.lead.findFirst({ where: { phone: '+905399990199' } });
      expect(lead).toBeNull();
    });

    it('a filled honeypot field returns 202 and creates nothing', async () => {
      const res = await request(publicServer)
        .post(`/public/studios/zen-reformer-pilates/leads`)
        .send({ fullName: 'Spam Bot', phone: '+905399990100', consent: true, website: 'http://spam.example' });
      expect(res.status).toBe(202);

      const lead = await prisma.lead.findFirst({ where: { phone: '+905399990100' } });
      expect(lead).toBeNull();
    });

    it('a well-formed submission returns 202 and creates a NEW/WEB_FORM lead', async () => {
      const res = await request(publicServer)
        .post(`/public/studios/zen-reformer-pilates/leads`)
        .send({ fullName: 'Web Formu Aday', phone: '+905399990101', email: 'aday@example.com', interest: 'Reformer', consent: true });
      expect(res.status).toBe(202);

      const lead = await prisma.lead.findFirstOrThrow({ where: { studioId: ZEN, phone: '+905399990101' } });
      leadIds.push(lead.id);
      expect(lead.stage).toBe('NEW');
      expect(lead.source).toBe('WEB_FORM');
      expect(lead.fullName).toBe('Web Formu Aday');
    });

    it('a duplicate phone with an open lead appends an activity instead of a new lead', async () => {
      const before = await prisma.lead.count({ where: { studioId: ZEN, phone: '+905399990101' } });
      const res = await request(publicServer)
        .post(`/public/studios/zen-reformer-pilates/leads`)
        .send({ fullName: 'Web Formu Aday', phone: '+905399990101', consent: true });
      expect(res.status).toBe(202);

      const after = await prisma.lead.count({ where: { studioId: ZEN, phone: '+905399990101' } });
      expect(after).toBe(before);
      const activities = await prisma.leadActivity.count({ where: { leadId: leadIds[0] } });
      expect(activities).toBeGreaterThanOrEqual(2);
    });

    it('rate limits the 6th request from the same IP within the window', async () => {
      // 4 requests already sent in this describe block; the 5th below must
      // still succeed and the 6th must be rejected with 429.
      const fifth = await request(publicServer)
        .post(`/public/studios/zen-reformer-pilates/leads`)
        .send({ fullName: 'Rate Test 5', phone: '+905399990102', consent: true });
      expect(fifth.status).toBe(202);
      leadIds.push((await prisma.lead.findFirstOrThrow({ where: { studioId: ZEN, phone: '+905399990102' } })).id);

      const sixth = await request(publicServer)
        .post(`/public/studios/zen-reformer-pilates/leads`)
        .send({ fullName: 'Rate Test 6', phone: '+905399990103', consent: true });
      expect(sixth.status).toBe(429);

      const blocked = await prisma.lead.findFirst({ where: { studioId: ZEN, phone: '+905399990103' } });
      expect(blocked).toBeNull();
    });
  });

  describe('staff CRUD and permissions', () => {
    it('trainer without leads.view -> 403', async () => {
      const res = await as(trainerToken).get(`/leads/studio/${ZEN}`);
      expect(res.status).toBe(403);
    });

    it('reception has leads.manage by default and can create a lead', async () => {
      const res = await as(receptionToken)
        .post('/leads')
        .send({ studioId: ZEN, fullName: 'Resepsiyon Aday', phone: '+905399990201', source: 'WALK_IN' });
      expect(res.status).toBe(201);
      leadIds.push(res.body.lead.id);
    });

    it('owner creates a lead', async () => {
      const res = await as(ownerToken)
        .post('/leads')
        .send({ studioId: ZEN, fullName: 'Deniz Kaya', phone: '+905399990202', source: 'INSTAGRAM', sourceDetail: '@denizkaya' });
      expect(res.status).toBe(201);
      expect(res.body.deduplicated).toBe(false);
      leadIds.push(res.body.lead.id);
    });

    it('creating with an existing open phone dedupes into an activity', async () => {
      const res = await as(ownerToken)
        .post('/leads')
        .send({ studioId: ZEN, fullName: 'Deniz Kaya', phone: '+905399990202', source: 'PHONE' });
      expect(res.status).toBe(201);
      expect(res.body.deduplicated).toBe(true);
      expect(res.body.lead.id).toBe(leadIds[leadIds.length - 1]);
    });

    it('lists leads filtered by stage and source, paginated', async () => {
      const res = await as(ownerToken).get(`/leads/studio/${ZEN}?source=INSTAGRAM&page=1&limit=10`);
      expect(res.status).toBe(200);
      expect(res.body.items.every((l: any) => l.source === 'INSTAGRAM')).toBe(true);
      expect(res.body.items.some((l: any) => l.phone === '+905399990202')).toBe(true);
      expect(res.body.limit).toBe(10);
    });

    it('caps the page size at 100', async () => {
      const res = await as(ownerToken).get(`/leads/studio/${ZEN}?limit=500`);
      expect(res.status).toBe(400);
    });

    it('search matches by name and phone', async () => {
      const res = await as(ownerToken).get(`/leads/studio/${ZEN}?search=990202`);
      expect(res.status).toBe(200);
      expect(res.body.items.some((l: any) => l.phone === '+905399990202')).toBe(true);
    });

    it('gets a lead by id and updates it', async () => {
      const leadId = leadIds[leadIds.length - 1];
      const got = await as(ownerToken).get(`/leads/${leadId}/studio/${ZEN}`);
      expect(got.status).toBe(200);
      expect(got.body.activities.length).toBeGreaterThanOrEqual(1);

      const updated = await as(ownerToken).put(`/leads/${leadId}`).send({ notes: 'Fiyat sordu, ertesi hafta arayacak' });
      expect(updated.status).toBe(200);
      expect(updated.body.notes).toBe('Fiyat sordu, ertesi hafta arayacak');
    });

    it('adds a NOTE activity', async () => {
      const leadId = leadIds[leadIds.length - 1];
      const res = await as(ownerToken).post(`/leads/${leadId}/activities`).send({ type: 'CALL', body: 'Aradik, ulasilamadi' });
      expect(res.status).toBe(201);
      expect(res.body.type).toBe('CALL');
    });

    it('overdue follow-ups filter finds a lead with a past next_follow_up_at', async () => {
      const leadId = leadIds[leadIds.length - 1];
      await prisma.lead.update({ where: { id: leadId }, data: { nextFollowUpAt: new Date(Date.now() - HOUR) } });

      const res = await as(ownerToken).get(`/leads/studio/${ZEN}?overdue=true`);
      expect(res.status).toBe(200);
      expect(res.body.items.some((l: any) => l.id === leadId)).toBe(true);
    });

    it('assigning an owner requires a staff membership; a member profile is rejected', async () => {
      const leadId = leadIds[leadIds.length - 1];
      const ok = await as(ownerToken).put(`/leads/${leadId}/owner`).send({ ownerMembershipId: trainerMembershipId });
      expect(ok.status).toBe(200);

      const bad = await as(ownerToken).put(`/leads/${leadId}/owner`).send({ ownerMembershipId: selfMemberMembershipId });
      expect(bad.status).toBe(400);
    });
  });

  describe('stage transitions', () => {
    let leadId: string;

    beforeAll(async () => {
      const res = await as(ownerToken)
        .post('/leads')
        .send({ studioId: ZEN, fullName: 'Asama Testi', phone: '+905399990301', source: 'OTHER' });
      leadId = res.body.lead.id;
      leadIds.push(leadId);
    });

    it('NEW -> CONTACTED is allowed', async () => {
      const res = await as(ownerToken).post(`/leads/${leadId}/stage`).send({ stage: 'CONTACTED' });
      expect(res.status).toBe(201);
      expect(res.body.stage).toBe('CONTACTED');
    });

    it('going backwards (CONTACTED -> NEW) is rejected', async () => {
      const res = await as(ownerToken).post(`/leads/${leadId}/stage`).send({ stage: 'NEW' });
      expect(res.status).toBe(400);
    });

    it('LOST without a reason is rejected by validation', async () => {
      const res = await as(ownerToken).post(`/leads/${leadId}/stage`).send({ stage: 'LOST' });
      expect(res.status).toBe(400);
    });

    it('LOST with a reason is accepted, then nothing may leave LOST', async () => {
      const res = await as(ownerToken).post(`/leads/${leadId}/stage`).send({ stage: 'LOST', lostReason: 'Butceyi asiyor' });
      expect(res.status).toBe(201);
      expect(res.body.stage).toBe('LOST');

      const after = await as(ownerToken).post(`/leads/${leadId}/stage`).send({ stage: 'CONTACTED' });
      expect(after.status).toBe(400);
    });

    it('nothing may leave WON', async () => {
      const won = await as(ownerToken)
        .post('/leads')
        .send({ studioId: ZEN, fullName: 'Won Testi', phone: '+905399990302', source: 'OTHER' });
      const wonLeadId = won.body.lead.id;
      leadIds.push(wonLeadId);

      const toWon = await as(ownerToken).post(`/leads/${wonLeadId}/stage`).send({ stage: 'WON' });
      expect(toWon.status).toBe(201);

      const after = await as(ownerToken).post(`/leads/${wonLeadId}/stage`).send({ stage: 'LOST', lostReason: 'x' });
      expect(after.status).toBe(400);
    });
  });

  describe('convert to member', () => {
    it('reuses an existing global user by phone and links the new membership', async () => {
      const existingUser = await prisma.user.create({
        data: { phone: '+905399990401', email: null, firstName: 'Var Olan', lastName: 'Kullanici' },
      });
      userIds.push(existingUser.id);

      const created = await as(ownerToken)
        .post('/leads')
        .send({ studioId: ZEN, fullName: 'Var Olan Kullanici', phone: '+905399990401', source: 'REFERRAL' });
      const leadId = created.body.lead.id;
      leadIds.push(leadId);

      const res = await as(ownerToken).post(`/leads/${leadId}/convert`).send({});
      expect(res.status).toBe(201);
      expect(res.body.lead.stage).toBe('WON');
      expect(res.body.member.membershipId).toBeDefined();
      membershipIds.push(res.body.member.membershipId);

      const usersWithPhone = await prisma.user.count({ where: { phone: '+905399990401' } });
      expect(usersWithPhone).toBe(1);

      const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
      expect(lead.convertedMembershipId).toBe(res.body.member.membershipId);
    });

    it('a WON lead cannot be converted again', async () => {
      const leadId = leadIds[leadIds.length - 1];
      const res = await as(ownerToken).post(`/leads/${leadId}/convert`).send({});
      expect(res.status).toBe(400);
    });
  });

  describe('trial booking', () => {
    it('books a trial without a package and moves the lead to TRIAL_BOOKED', async () => {
      const scheduleId = await makeMatSchedule(40);
      const created = await as(ownerToken)
        .post('/leads')
        .send({ studioId: ZEN, fullName: 'Deneme Dersi Aday', phone: '+905399990501', source: 'WALK_IN' });
      const leadId = created.body.lead.id;
      leadIds.push(leadId);

      const res = await as(ownerToken).post(`/leads/${leadId}/trial`).send({ scheduleId });
      expect(res.status).toBe(201);
      expect(res.body.lead.stage).toBe('TRIAL_BOOKED');
      expect(res.body.booking.memberId).toBeDefined();
      membershipIds.push(res.body.member.membershipId);
      bookingIds.push(res.body.booking.id);

      const booking = await prisma.booking.findUniqueOrThrow({ where: { id: res.body.booking.id } });
      expect(booking.memberPackageId).toBeNull();
    });
  });

  describe('cross-tenant isolation', () => {
    it('a lead from another studio is not reachable through this one', async () => {
      const flowLead = await prisma.lead.create({
        data: { studioId: FLOW, fullName: 'Flow Aday', phone: '+905399990601', source: 'OTHER' },
      });

      const res = await as(ownerToken).get(`/leads/${flowLead.id}/studio/${ZEN}`);
      expect(res.status).toBe(404);

      const list = await as(ownerToken).get(`/leads/studio/${ZEN}`);
      expect(list.body.items.some((l: any) => l.id === flowLead.id)).toBe(false);

      await prisma.lead.delete({ where: { id: flowLead.id } });
    });
  });
});
