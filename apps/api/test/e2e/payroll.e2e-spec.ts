import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { PrismaClient } from '@platform/database';
import { AppModule } from '../../src/app.module';

/**
 * W14: trainer commission payroll. Builds deterministic sessions and
 * bookings for February 2025 (well before the seed's "now") in the Zen
 * studio, and never touches the seed's own catalogue or schedules.
 *
 * Formula under test (see docs/PAYROLL.md):
 * - PER_SESSION_FIXED: rule.value per session taught, any attendee count.
 * - PERCENTAGE: sum over ATTENDED/NO_SHOW/CANCELLED_LATE(penalty>0) bookings
 *   of (package price / package totalUnits) * units consumed * value%.
 * - ServiceType.commissionRuleId overrides TrainerProfile.commissionRuleId.
 * - The teaching trainer (SessionSchedule.trainerId) earns the session, a
 *   substituted-out trainer (originalTrainerId) earns nothing.
 */

const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Demo1234!';
const HOUR = 3600_000;
const OWNER_PHONE = '+905321000002';
const TRAINER_PHONE = '+905321000004';
const MEMBER_PHONE = '+905321000016';

const FEB_START = new Date('2025-02-01T00:00:00.000Z');
const FEB_END = new Date('2025-03-01T00:00:00.000Z');

describe('Payroll (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let server: any;

  let ZEN: string;
  let ownerToken: string;
  let trainerToken: string;
  let memberToken: string;

  let mainBranch: string;
  let secondBranch: string;

  let trainer1Id: string; // Selin Aydin, +905321000004, seed commissionRuleId = PER_SESSION_FIXED 350
  let trainer2Id: string; // Burak Sahin, substituted out, must earn nothing

  let percentRuleId: string;
  let percentServiceTypeId: string; // overrides trainer rule with PERCENTAGE 50
  let fallbackServiceTypeId: string; // no own rule -> falls back to trainer's PER_SESSION_FIXED 350
  let packageDefId: string;

  const scheduleIds: string[] = [];
  const memberPackageIds: string[] = [];
  const bookingIds: string[] = [];
  const runIds: string[] = [];

  const login = async (phone: string) => {
    const res = await request(server).post('/auth/login').send({ emailOrPhone: phone, password: DEMO_PASSWORD });
    expect(res.status).toBe(200);
    return res.body.accessToken as string;
  };
  const as = (token: string) => ({
    get: (url: string) => request(server).get(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', ZEN),
    post: (url: string) => request(server).post(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', ZEN),
    patch: (url: string) => request(server).patch(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', ZEN),
  });

  const makeSchedule = async (opts: { start: Date; branchId: string; serviceTypeId: string; trainerId: string; originalTrainerId?: string }) => {
    const s = await prisma.sessionSchedule.create({
      data: {
        studioId: ZEN,
        branchId: opts.branchId,
        serviceTypeId: opts.serviceTypeId,
        trainerId: opts.trainerId,
        originalTrainerId: opts.originalTrainerId ?? null,
        title: 'E2E hakedis',
        startTime: opts.start,
        endTime: new Date(opts.start.getTime() + HOUR),
        capacity: 6,
      },
    });
    scheduleIds.push(s.id);
    return s.id;
  };

  const makeMemberPackage = async (memberId: string) => {
    const p = await prisma.memberPackage.create({
      data: {
        studioId: ZEN,
        memberId,
        packageDefinitionId: packageDefId,
        entitlementKind: 'SESSION_COUNT',
        totalUnits: 10,
        remainingUnits: 10,
        endDate: new Date('2025-04-01'),
        startDate: new Date('2025-01-01'),
      },
    });
    memberPackageIds.push(p.id);
    return p.id;
  };

  const makeBooking = async (opts: {
    scheduleId: string;
    memberId: string;
    status: 'ATTENDED' | 'NO_SHOW' | 'CANCELLED_LATE' | 'CANCELLED_EARLY' | 'CONFIRMED';
    unitsCharged?: number;
    penaltyUnits?: number;
    memberPackageId?: string | null;
  }) => {
    const b = await prisma.booking.create({
      data: {
        studioId: ZEN,
        scheduleId: opts.scheduleId,
        memberId: opts.memberId,
        status: opts.status,
        unitsCharged: opts.unitsCharged ?? 1,
        penaltyUnits: opts.penaltyUnits ?? 0,
        memberPackageId: opts.memberPackageId ?? null,
      },
    });
    bookingIds.push(b.id);
    return b.id;
  };

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer();
    prisma = new PrismaClient();

    ZEN = (await prisma.studio.findUniqueOrThrow({ where: { slug: 'zen-reformer-pilates' } })).id;
    mainBranch = (await prisma.branch.findFirstOrThrow({ where: { studioId: ZEN, name: 'Nisantasi Merkez Sube' } })).id;
    secondBranch = (await prisma.branch.findFirstOrThrow({ where: { studioId: ZEN, name: 'Kadikoy Sube' } })).id;

    trainer1Id = (await prisma.trainerProfile.findFirstOrThrow({ where: { studioId: ZEN, membership: { user: { phone: TRAINER_PHONE } } } })).id;
    trainer2Id = (
      await prisma.trainerProfile.findFirstOrThrow({ where: { studioId: ZEN, id: { not: trainer1Id } } })
    ).id;

    ownerToken = await login(OWNER_PHONE);
    trainerToken = await login(TRAINER_PHONE);
    memberToken = await login(MEMBER_PHONE);

    const suffix = Date.now().toString(36);
    const rule = await prisma.commissionRule.create({
      data: { studioId: ZEN, name: `E2E Yuzde ${suffix}`, type: 'PERCENTAGE', value: 50 },
    });
    percentRuleId = rule.id;

    const percentServiceType = await prisma.serviceType.create({
      data: { studioId: ZEN, name: `E2E Yuzdeli Hizmet ${suffix}`, durationMin: 50, capacity: 6, commissionRuleId: percentRuleId },
    });
    percentServiceTypeId = percentServiceType.id;

    const fallbackServiceType = await prisma.serviceType.create({
      data: { studioId: ZEN, name: `E2E Sabit Hizmet ${suffix}`, durationMin: 50, capacity: 6 },
    });
    fallbackServiceTypeId = fallbackServiceType.id;

    const def = await prisma.packageDefinition.create({
      data: { studioId: ZEN, name: `E2E Paket ${suffix}`, entitlementKind: 'SESSION_COUNT', totalUnits: 10, validityDays: 60, price: 10000 },
    });
    packageDefId = def.id;

    const members = await prisma.memberProfile.findMany({ where: { studioId: ZEN, membership: { user: { phone: { not: MEMBER_PHONE } } } }, take: 5, orderBy: { id: 'asc' } });
    expect(members.length).toBeGreaterThanOrEqual(5);
    const [m1, m2, m3, m4, m5] = members.map((m) => m.id);

    // -- Session S1: percentage service, main branch, four booking kinds --
    const s1 = await makeSchedule({ start: new Date('2025-02-05T09:00:00.000Z'), branchId: mainBranch, serviceTypeId: percentServiceTypeId, trainerId: trainer1Id });
    const pkg1 = await makeMemberPackage(m1);
    const pkg2 = await makeMemberPackage(m2);
    const pkg3 = await makeMemberPackage(m3);
    const pkg4 = await makeMemberPackage(m4);
    // unit price = 10000/10 = 1000; 50% => 500 per unit consumed.
    await makeBooking({ scheduleId: s1, memberId: m1, status: 'ATTENDED', unitsCharged: 1, memberPackageId: pkg1 }); // +500
    await makeBooking({ scheduleId: s1, memberId: m2, status: 'CANCELLED_LATE', unitsCharged: 1, penaltyUnits: 1, memberPackageId: pkg2 }); // +500 (kept penalty)
    await makeBooking({ scheduleId: s1, memberId: m3, status: 'CANCELLED_LATE', unitsCharged: 1, penaltyUnits: 0, memberPackageId: pkg3 }); // +0 (fully refunded)
    await makeBooking({ scheduleId: s1, memberId: m4, status: 'NO_SHOW', unitsCharged: 1, memberPackageId: pkg4 }); // +500
    await makeBooking({ scheduleId: s1, memberId: m5, status: 'ATTENDED', unitsCharged: 1, memberPackageId: null }); // +0 (no package)
    // S1 total: 1500, attendees: 2 (m1 ATTENDED, m5 ATTENDED)

    // -- Session S2: fallback service (no own rule) -> trainer's PER_SESSION_FIXED 350, main branch --
    const s2 = await makeSchedule({ start: new Date('2025-02-10T09:00:00.000Z'), branchId: mainBranch, serviceTypeId: fallbackServiceTypeId, trainerId: trainer1Id });
    await makeBooking({ scheduleId: s2, memberId: m1, status: 'ATTENDED', unitsCharged: 0, memberPackageId: null }); // fixed rule ignores units
    // S2 total: 350, attendees: 1

    // -- Session S3: substitution. Booked for trainer2, taught by trainer1. Trainer1 earns it. --
    const s3 = await makeSchedule({
      start: new Date('2025-02-12T09:00:00.000Z'),
      branchId: mainBranch,
      serviceTypeId: percentServiceTypeId,
      trainerId: trainer1Id,
      originalTrainerId: trainer2Id,
    });
    const pkg5 = await makeMemberPackage(m1);
    await makeBooking({ scheduleId: s3, memberId: m1, status: 'ATTENDED', unitsCharged: 1, memberPackageId: pkg5 }); // +500
    // S3 total: 500, attendees: 1

    // -- Session S4: same trainer, second branch: excluded from a mainBranch-only run --
    const s4 = await makeSchedule({ start: new Date('2025-02-15T09:00:00.000Z'), branchId: secondBranch, serviceTypeId: percentServiceTypeId, trainerId: trainer1Id });
    const pkg6 = await makeMemberPackage(m2);
    await makeBooking({ scheduleId: s4, memberId: m2, status: 'ATTENDED', unitsCharged: 1, memberPackageId: pkg6 }); // +500

    // -- Session outside the period: must never appear in a February run --
    await makeSchedule({ start: new Date('2025-01-31T20:00:00.000Z'), branchId: mainBranch, serviceTypeId: percentServiceTypeId, trainerId: trainer1Id });
  });

  afterAll(async () => {
    await prisma.payrollLine.deleteMany({ where: { studioId: ZEN, runId: { in: runIds } } });
    await prisma.payrollRun.deleteMany({ where: { id: { in: runIds } } });
    await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
    await prisma.sessionSchedule.deleteMany({ where: { id: { in: scheduleIds } } });
    await prisma.memberPackage.deleteMany({ where: { id: { in: memberPackageIds } } });
    await prisma.packageDefinition.deleteMany({ where: { id: packageDefId } });
    await prisma.serviceType.deleteMany({ where: { id: { in: [percentServiceTypeId, fallbackServiceTypeId] } } });
    await prisma.commissionRule.deleteMany({ where: { id: percentRuleId } });
    await prisma.$disconnect();
    await app.close();
  });

  describe('generate (draft, idempotent)', () => {
    let runId: string;

    it('owner generates a branch-scoped draft run with the exact expected amounts', async () => {
      const res = await as(ownerToken)
        .post(`/payroll/studio/${ZEN}/runs`)
        .send({ periodStart: FEB_START.toISOString(), periodEnd: FEB_END.toISOString(), branchId: mainBranch });
      expect(res.status).toBe(201);
      runId = res.body.id;
      runIds.push(runId);
      expect(res.body.status).toBe('DRAFT');
      expect(res.body.totalGross).toBe('2350.00');
      expect(res.body.totalNet).toBe('2350.00');

      const line = res.body.lines.find((l: any) => l.trainerProfileId === trainer1Id);
      expect(line).toBeTruthy();
      expect(line.sessions).toBe(3);
      expect(line.attendees).toBe(4);
      expect(line.grossAmount).toBe('2350.00');
      expect(line.netAmount).toBe('2350.00');

      // The out-of-period and other-branch sessions never appear.
      const scheduleIdsInLine = line.lines.map((d: any) => d.scheduleId);
      expect(new Set(scheduleIdsInLine).size).toBeLessThanOrEqual(3);

      // Trainer2 (substituted out) earns nothing and has no line.
      const trainer2Line = res.body.lines.find((l: any) => l.trainerProfileId === trainer2Id);
      expect(trainer2Line).toBeUndefined();
    });

    it('a studio-wide run (no branchId) also includes the second-branch session', async () => {
      const res = await as(ownerToken)
        .post(`/payroll/studio/${ZEN}/runs`)
        .send({ periodStart: FEB_START.toISOString(), periodEnd: FEB_END.toISOString() });
      expect(res.status).toBe(201);
      runIds.push(res.body.id);
      expect(res.body.totalGross).toBe('2850.00');
    });

    it('an adjustment requires a note and is applied to net, not gross', async () => {
      const line = (await as(ownerToken).get(`/payroll/studio/${ZEN}/runs/${runId}`)).body.lines.find((l: any) => l.trainerProfileId === trainer1Id);

      const noNote = await as(ownerToken).patch(`/payroll/studio/${ZEN}/runs/${runId}/lines/${line.id}/adjust`).send({ amount: 100.5 });
      expect(noNote.status).toBe(400);

      const res = await as(ownerToken).patch(`/payroll/studio/${ZEN}/runs/${runId}/lines/${line.id}/adjust`).send({ amount: 100.5, note: 'Yol masrafi iadesi' });
      expect(res.status).toBe(200);
      expect(res.body.grossAmount).toBe('2350.00');
      expect(res.body.adjustments).toBe('100.50');
      expect(res.body.netAmount).toBe('2450.50');

      const run = await as(ownerToken).get(`/payroll/studio/${ZEN}/runs/${runId}`);
      expect(run.body.totalNet).toBe('2450.50');
    });

    it('regenerating the same draft run replaces lines and resets adjustments (idempotent)', async () => {
      const res = await as(ownerToken)
        .post(`/payroll/studio/${ZEN}/runs`)
        .send({ periodStart: FEB_START.toISOString(), periodEnd: FEB_END.toISOString(), branchId: mainBranch });
      expect(res.status).toBe(201);
      expect(res.body.id).toBe(runId); // same run, not a duplicate

      const line = res.body.lines.find((l: any) => l.trainerProfileId === trainer1Id);
      expect(line.adjustments).toBe('0.00');
      expect(line.grossAmount).toBe('2350.00');
      expect(line.netAmount).toBe('2350.00');
      expect(res.body.totalNet).toBe('2350.00');
    });

    it('CSV export uses a UTF-8 BOM, semicolons and Turkish headers', async () => {
      const res = await as(ownerToken).get(`/payroll/studio/${ZEN}/runs/${runId}/export.csv`);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/csv/);
      const text = res.text as string;
      expect(text.charCodeAt(0)).toBe(0xfeff);
      const firstLine = text.replace(/^﻿/, '').split('\r\n')[0];
      expect(firstLine).toBe('Eğitmen;Seans;Katılımcı;Brüt;Düzeltme;Net');
      expect(text).toContain('2350.00');
    });

    it('permission denials: trainer cannot generate, list, or adjust', async () => {
      expect((await as(trainerToken).post(`/payroll/studio/${ZEN}/runs`).send({ periodStart: FEB_START.toISOString(), periodEnd: FEB_END.toISOString() })).status).toBe(403);
      expect((await as(trainerToken).get(`/payroll/studio/${ZEN}/runs`)).status).toBe(403);
      expect((await as(trainerToken).get(`/payroll/studio/${ZEN}/runs/${runId}`)).status).toBe(403);
    });

    it('owner lists runs for the studio', async () => {
      const res = await as(ownerToken).get(`/payroll/studio/${ZEN}/runs`);
      expect(res.status).toBe(200);
      expect(res.body.map((r: any) => r.id)).toEqual(expect.arrayContaining(runIds));
    });
  });

  describe('approve, pay, and immutability', () => {
    let runId: string;
    let secondBranchRunId: string;

    beforeAll(async () => {
      const res = await as(ownerToken)
        .post(`/payroll/studio/${ZEN}/runs`)
        .send({ periodStart: FEB_START.toISOString(), periodEnd: FEB_END.toISOString(), branchId: mainBranch });
      runId = res.body.id;
      if (!runIds.includes(runId)) runIds.push(runId);

      const second = await as(ownerToken)
        .post(`/payroll/studio/${ZEN}/runs`)
        .send({ periodStart: FEB_START.toISOString(), periodEnd: FEB_END.toISOString(), branchId: secondBranch });
      secondBranchRunId = second.body.id;
      runIds.push(secondBranchRunId);
    });

    it('mark-paid before approval -> 400', async () => {
      const res = await as(ownerToken).post(`/payroll/studio/${ZEN}/runs/${secondBranchRunId}/mark-paid`);
      expect(res.status).toBe(400);
    });

    it('trainer cannot approve -> 403; owner approves', async () => {
      expect((await as(trainerToken).post(`/payroll/studio/${ZEN}/runs/${runId}/approve`)).status).toBe(403);

      const res = await as(ownerToken).post(`/payroll/studio/${ZEN}/runs/${runId}/approve`);
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('APPROVED');
      expect(res.body.approvedAt).toBeTruthy();
    });

    it('approved runs are immutable: regenerate, adjust and re-approve all fail', async () => {
      const regenerate = await as(ownerToken)
        .post(`/payroll/studio/${ZEN}/runs`)
        .send({ periodStart: FEB_START.toISOString(), periodEnd: FEB_END.toISOString(), branchId: mainBranch });
      // Overlapping approved period for the same branch is rejected.
      expect(regenerate.status).toBe(409);

      const reapprove = await as(ownerToken).post(`/payroll/studio/${ZEN}/runs/${runId}/approve`);
      expect(reapprove.status).toBe(409);

      const run = await as(ownerToken).get(`/payroll/studio/${ZEN}/runs/${runId}`);
      const line = run.body.lines.find((l: any) => l.trainerProfileId === trainer1Id);
      const adjust = await as(ownerToken).patch(`/payroll/studio/${ZEN}/runs/${runId}/lines/${line.id}/adjust`).send({ amount: 10, note: 'Reddedilmeli' });
      expect(adjust.status).toBe(409);
    });

    it('owner marks the approved run as paid', async () => {
      const approveSecond = await as(ownerToken).post(`/payroll/studio/${ZEN}/runs/${secondBranchRunId}/approve`);
      expect(approveSecond.status).toBe(201);

      const res = await as(ownerToken).post(`/payroll/studio/${ZEN}/runs/${secondBranchRunId}/mark-paid`);
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('PAID');
      expect(res.body.paidAt).toBeTruthy();
    });

    it('trainer sees their own line of the approved run via the self-service endpoint, nothing more', async () => {
      const res = await as(trainerToken).get(`/payroll/studio/${ZEN}/me/lines`);
      expect(res.status).toBe(200);
      const line = res.body.find((l: any) => l.runId === runId);
      expect(line).toBeTruthy();
      expect(line.trainerProfileId).toBe(trainer1Id);
      expect(line.netAmount).toBe('2350.00');
    });

    it('a member (no trainer profile) is refused the trainer self-service view', async () => {
      const res = await as(memberToken).get(`/payroll/studio/${ZEN}/me/lines`);
      expect(res.status).toBe(403);
    });
  });
});
