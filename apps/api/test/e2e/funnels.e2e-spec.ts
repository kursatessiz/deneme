import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { PrismaClient } from '@platform/database';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../../src/app.module';

/**
 * G5d-1 conversion funnels end to end (docs/HUNILER.md): step counts, rates
 * and medians computed in SQL over a constructed scenario (one contact
 * completing, others dropping, an out-of-order contact, a test contact, a
 * test event, a contact outside the range, a step-to-step window), the
 * breakdowns by source, campaign and branch, the previous-period comparison,
 * the visitor funnel over touchpoints, tenant isolation and permissions.
 *
 * All rows live in throwaway studios named e2e-funnels-* or carry the name
 * prefix "E2E funnel" in the seeded Zen studio; afterAll removes them, so the
 * suite passes twice in a row on the same database.
 */

const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Demo1234!';
const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.now();
const OWNER_PHONE = '+905321000002';
const RECEPTION_PHONE = '+905321000003';
const TRAINER_PHONE = '+905321000004';
const FLOW_OWNER_PHONE = '+905321000022';
const SUPER_ADMIN_PHONE = '+905321000001';
const VIEWER_PHONE = '+90539666';
const PREFIX = '+90539666';

const at = (daysAgo: number) => new Date(NOW - daysAgo * DAY);
const uuid = (seed: number) => `f00d0000-0000-4000-8000-${seed.toString(16).padStart(12, '0')}`;

interface StepStat {
  key: string;
  reached: number;
  rateFromPrevious: number | null;
  rateFromFirst: number | null;
  medianSecondsFromPrevious: number | null;
}
interface Group {
  key: string;
  label: string | null;
  steps: StepStat[];
}

describe('Funnels G5d-1 (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let server: Parameters<typeof request>[0];

  let ZEN: string;
  let FLOW: string;
  let T: string;
  let T2: string;
  let branchId: string;
  let ownerToken: string;
  let receptionToken: string;
  let trainerToken: string;
  let viewerToken: string;
  let flowOwnerToken: string;
  let superAdminToken: string;

  const login = async (p: string) => {
    const res = await request(server).post('/auth/login').send({ emailOrPhone: p, password: DEMO_PASSWORD });
    expect(res.status).toBe(200);
    return res.body.accessToken as string;
  };
  const as = (token: string, studioId: string) => ({
    get: (url: string) => request(server).get(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId),
    post: (url: string) => request(server).post(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId),
    patch: (url: string) => request(server).patch(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId),
    delete: (url: string) => request(server).delete(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId),
  });

  const RANGE = () => `from=${new Date(NOW - 40 * DAY).toISOString()}&to=${new Date(NOW + 3600_000).toISOString()}`;
  const report = (studioId: string, id: string, extra = '', token = superAdminToken) =>
    as(token, studioId).get(`/studios/${studioId}/funnels/${encodeURIComponent(id)}/report?${RANGE()}${extra ? `&${extra}` : ''}`);
  const reached = (steps: StepStat[]) => steps.map((s) => s.reached);
  const group = (groups: Group[], key: string) => groups.find((g) => g.key === key);

  async function cleanup() {
    await prisma.studio.deleteMany({ where: { slug: { startsWith: 'e2e-funnels-' } } });
    await prisma.funnel.deleteMany({ where: { studioId: ZEN, name: { startsWith: 'E2E funnel' } } });
    await prisma.auditLog.deleteMany({ where: { studioId: ZEN, entityType: 'Funnel' } });
    await prisma.membership.deleteMany({ where: { user: { phone: { startsWith: PREFIX } } } });
    await prisma.user.deleteMany({ where: { phone: { startsWith: PREFIX } } });
    await prisma.roleTemplate.deleteMany({ where: { studioId: ZEN, key: 'e2e_funnels_viewer' } });
  }

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer();
    prisma = new PrismaClient();

    ZEN = (await prisma.studio.findUniqueOrThrow({ where: { slug: 'zen-reformer-pilates' } })).id;
    FLOW = (await prisma.studio.findUniqueOrThrow({ where: { slug: 'flow-pilates-wellness' } })).id;
    await cleanup();

    T = (await prisma.studio.create({ data: { name: 'E2E Funnels A', slug: `e2e-funnels-${NOW}-a` } })).id;
    T2 = (await prisma.studio.create({ data: { name: 'E2E Funnels B', slug: `e2e-funnels-${NOW}-b` } })).id;
    branchId = (await prisma.branch.create({ data: { studioId: T, name: 'E2E Sube' } })).id;

    // Seeds the constructed scenario (see the expectations below).
    let n = 0;
    const contact = (id: number, fields: Record<string, unknown> = {}) =>
      prisma.contact.create({ data: { id: uuid(0x100 + id), studioId: T, firstName: `F${id}`, phone: `${PREFIX}${String(100 + id).padStart(4, '0')}`, ...fields } });
    const event = (contactId: string, type: string, daysAgo: number, isTest = false) =>
      prisma.conversionEvent.create({
        data: { studioId: T, contactId, type, occurredAt: at(daysAgo), eventId: `e2e-funnel-${++n}-${NOW}`, sourceKind: 'e2e', sourceId: `e2e-funnel-${n}-${NOW}`, isTest },
      });

    // A completes every step.
    const a = await contact(1, { firstSource: 'google', firstCampaignId: 'c1', firstCampaignName: 'Camp1', branchId });
    await event(a.id, 'lead', 20);
    await event(a.id, 'trial_booked', 19);
    await event(a.id, 'trial_attended', 18);
    await event(a.id, 'purchase', 17);
    // B drops after the trial booking.
    const b = await contact(2, { firstSource: 'facebook', firstCampaignId: 'c2', firstCampaignName: 'Camp2' });
    await event(b.id, 'lead', 20);
    await event(b.id, 'trial_booked', 19);
    // C attended BEFORE booking: out of order, the funnel stops at trial_booked.
    const c = await contact(3, { firstSource: 'google', firstCampaignId: 'c1', firstCampaignName: 'Camp1' });
    await event(c.id, 'lead', 20);
    await event(c.id, 'trial_attended', 15);
    await event(c.id, 'trial_booked', 14);
    await event(c.id, 'purchase', 10);
    // D is a test contact with the full journey: never counted.
    const d = await contact(4, { isTest: true, firstSource: 'google' });
    for (const [type, days] of [['lead', 20], ['trial_booked', 19], ['trial_attended', 18], ['purchase', 17]] as const) await event(d.id, type, days);
    // E has a test EVENT for trial_booked: the funnel stops at the lead.
    const e = await contact(5);
    await event(e.id, 'lead', 20);
    await event(e.id, 'trial_booked', 19, true);
    // F books a trial and buys 28 days later (outside a 7 day window).
    const f = await contact(6, { firstSource: 'facebook' });
    await event(f.id, 'lead', 30);
    await event(f.id, 'trial_booked', 29);
    await event(f.id, 'purchase', 1);
    // G entered long before the range.
    const g = await contact(7, { firstSource: 'google' });
    await event(g.id, 'lead', 100);
    await event(g.id, 'purchase', 5);
    // H belongs to the previous period only.
    const h = await contact(8, { firstSource: 'google' });
    await event(h.id, 'lead', 60);
    await event(h.id, 'trial_booked', 59);

    // Visitor funnel: A and B were seen before their lead, J was seen after it.
    const j = await contact(9);
    await event(j.id, 'lead', 20);
    const touch = async (seed: number, contactId: string, daysAgo: number) => {
      await prisma.visitor.create({ data: { id: uuid(0x200 + seed), studioId: T, contactId } });
      await prisma.touchpoint.create({
        data: { id: uuid(0x300 + seed), studioId: T, visitorId: uuid(0x200 + seed), sessionId: uuid(0x400 + seed), occurredAt: at(daysAgo), landingPath: '/', contactId },
      });
    };
    await touch(1, a.id, 25);
    await touch(2, b.id, 22);
    await touch(3, j.id, 10);
    await touch(4, d.id, 30);

    // A visitor role that may see reports but not manage funnels.
    const role = await prisma.roleTemplate.create({
      data: { studioId: ZEN, key: 'e2e_funnels_viewer', name: 'E2E funnel viewer', permissions: { create: [{ permissionKey: 'reports.view' }] } },
    });
    const viewer = await prisma.user.create({
      data: { phone: VIEWER_PHONE + '0001', firstName: 'Huni', lastName: 'Izleyici', passwordHash: await bcrypt.hash(DEMO_PASSWORD, 10) },
    });
    await prisma.membership.create({ data: { userId: viewer.id, studioId: ZEN, roleTemplateId: role.id, status: 'ACTIVE', joinedAt: new Date() } });

    ownerToken = await login(OWNER_PHONE);
    receptionToken = await login(RECEPTION_PHONE);
    trainerToken = await login(TRAINER_PHONE);
    flowOwnerToken = await login(FLOW_OWNER_PHONE);
    superAdminToken = await login(SUPER_ADMIN_PHONE);
    viewerToken = await login(VIEWER_PHONE + '0001');
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
    await app.close();
  });

  describe('ready-made funnel: lead to member', () => {
    it('counts contacts per step in order, excluding test contacts, test events, out-of-order events and entries outside the range', async () => {
      const res = await report(T, 'ready.lead-to-member');
      expect(res.status).toBe(200);
      expect(res.body.funnel).toMatchObject({ id: 'ready.lead-to-member', kind: 'READY_MADE', slug: 'lead-to-member', windowDays: null });
      const steps: StepStat[] = res.body.steps;
      expect(steps.map((s) => s.key)).toEqual(['lead', 'trial_booked', 'trial_attended', 'purchase']);
      // Entered: A, B, C, E, F, J (D is test, G is outside the range, H is in the previous period).
      // trial_booked: A, B, C, F (E only has a test event, J has none).
      // trial_attended: A (C attended before booking).
      // purchase: A (F never attended).
      expect(reached(steps)).toEqual([6, 4, 1, 1]);
      expect(steps[0].rateFromPrevious).toBeNull();
      expect(steps[0].rateFromFirst).toBe(1);
      expect(steps[1].rateFromPrevious).toBeCloseTo(4 / 6);
      expect(steps[2].rateFromPrevious).toBeCloseTo(1 / 4);
      expect(steps[3].rateFromPrevious).toBe(1);
      expect(steps[3].rateFromFirst).toBeCloseTo(1 / 6);
      // lead -> trial_booked: A 1d, B 1d, C 6d, F 1d -> median 1 day.
      expect(steps[1].medianSecondsFromPrevious).toBe(86400);
      expect(steps[2].medianSecondsFromPrevious).toBe(86400);
      expect(steps[3].medianSecondsFromPrevious).toBe(86400);
      expect(res.body.breakdown).toBeNull();
      expect(res.body.groups).toEqual([]);
      expect(res.body.previous).toBeNull();
    });

    it('takes the median step time and only counts purchases at or after the booking', async () => {
      const res = await report(T, 'ready.trial-to-member');
      expect(res.status).toBe(200);
      // Entered: A(-19), B(-19), C(-14), F(-29); purchase at or after the booking: A, C, F.
      expect(reached(res.body.steps)).toEqual([4, 3]);
      // A 2 days, C 4 days, F 28 days -> median 4 days.
      expect(res.body.steps[1].medianSecondsFromPrevious).toBe(4 * 86400);
    });
  });

  describe('window', () => {
    it('drops contacts whose step took longer than the window and keeps the ones inside', async () => {
      const created = await as(superAdminToken, T).post(`/studios/${T}/funnels`).send({ name: 'E2E funnel window', steps: ['trial_booked', 'purchase'], windowDays: 7 });
      expect(created.status).toBe(201);
      const res = await report(T, created.body.id);
      // A (2 days) and C (4 days) inside 7 days; F (28 days) and B (none) are not.
      expect(reached(res.body.steps)).toEqual([4, 2]);
      const noWindow = await as(superAdminToken, T).patch(`/studios/${T}/funnels/${created.body.id}`).send({ windowDays: null });
      expect(noWindow.status).toBe(200);
      expect(noWindow.body.windowDays).toBeNull();
      expect(reached((await report(T, created.body.id)).body.steps)).toEqual([4, 3]);
    });
  });

  describe('breakdowns', () => {
    it('by source uses the first source and puts contacts without one under (direct)', async () => {
      const res = await report(T, 'ready.lead-to-member', 'breakdown=source');
      expect(res.status).toBe(200);
      expect(res.body.breakdown).toBe('source');
      const groups: Group[] = res.body.groups;
      // google: A, C; facebook: B, F; (direct): E, J (no first source).
      expect(reached(group(groups, 'google')!.steps)).toEqual([2, 2, 1, 1]);
      expect(reached(group(groups, 'facebook')!.steps)).toEqual([2, 2, 0, 0]);
      expect(reached(group(groups, '(direct)')!.steps)).toEqual([2, 0, 0, 0]);
      expect(groups.map((g) => g.steps[0].reached)).toEqual([2, 2, 2]);
      // The total row is not part of the groups and still counts everybody.
      expect(reached(res.body.steps)).toEqual([6, 4, 1, 1]);
    });

    it('by campaign groups by campaign id with the campaign name as label', async () => {
      const res = await report(T, 'ready.lead-to-member', 'breakdown=campaign');
      expect(res.status).toBe(200);
      const groups: Group[] = res.body.groups;
      const c1 = group(groups, 'c1')!;
      expect(c1.label).toBe('Camp1');
      expect(reached(c1.steps)).toEqual([2, 2, 1, 1]);
      expect(reached(group(groups, 'c2')!.steps)).toEqual([1, 1, 0, 0]);
      expect(reached(group(groups, '(none)')!.steps)).toEqual([3, 1, 0, 0]);
    });

    it('by branch uses the contact branch and its name', async () => {
      const res = await report(T, 'ready.lead-to-member', 'breakdown=branch');
      expect(res.status).toBe(200);
      const groups: Group[] = res.body.groups;
      const branch = group(groups, branchId)!;
      expect(branch.label).toBe('E2E Sube');
      expect(reached(branch.steps)).toEqual([1, 1, 1, 1]);
      expect(reached(group(groups, '(none)')!.steps)).toEqual([5, 3, 0, 0]);
    });

    it('filters by branch and rejects an unknown breakdown', async () => {
      const res = await report(T, 'ready.lead-to-member', `branchId=${branchId}`);
      expect(res.status).toBe(200);
      expect(reached(res.body.steps)).toEqual([1, 1, 1, 1]);
      expect((await report(T, 'ready.lead-to-member', 'breakdown=nope')).status).toBe(400);
    });
  });

  describe('previous-period comparison', () => {
    it('returns the same funnel over the previous same-length window', async () => {
      const res = await report(T, 'ready.lead-to-member', 'compare=previous');
      expect(res.status).toBe(200);
      expect(res.body.previous).not.toBeNull();
      expect(Date.parse(res.body.previous.to)).toBe(NOW - 40 * DAY - 1);
      // Only H (lead -60d, trial_booked -59d) entered in the previous window.
      expect(reached(res.body.previous.steps)).toEqual([1, 1, 0, 0]);
      expect(reached(res.body.steps)).toEqual([6, 4, 1, 1]);
    });
  });

  describe('ready-made funnel: visitor to member', () => {
    it('starts at the first tracked touchpoint and requires the lead after it', async () => {
      const res = await report(T, 'ready.visitor-to-member');
      expect(res.status).toBe(200);
      expect(res.body.funnel.requiresSiteTracking).toBe(true);
      // Entered: A (-25), B (-22), J (-10); D is a test contact. J's lead (-20) came before its visit, so it stops.
      // purchase: A only.
      expect(reached(res.body.steps)).toEqual([3, 2, 1]);
      // visit -> lead: A 5 days, B 2 days -> median 3.5 days.
      expect(res.body.steps[1].medianSecondsFromPrevious).toBe(3.5 * 86400);
    });

    it('is empty (not an error) for a studio without tracking data', async () => {
      const res = await report(T2, 'ready.visitor-to-member', 'breakdown=source&compare=previous');
      expect(res.status).toBe(200);
      expect(reached(res.body.steps)).toEqual([0, 0, 0]);
      expect(res.body.steps[1].rateFromFirst).toBeNull();
      expect(res.body.groups).toEqual([]);
      expect(reached(res.body.previous.steps)).toEqual([0, 0, 0]);
    });
  });

  describe('tenant funnels (CRUD, validation, isolation)', () => {
    let funnelId: string;

    it('lists the ready-made funnels and only the caller studio tenant funnels', async () => {
      const created = await as(ownerToken, ZEN).post(`/studios/${ZEN}/funnels`).send({ name: 'E2E funnel zen', steps: ['lead', 'trial_booked', 'purchase'], windowDays: 30 });
      expect(created.status).toBe(201);
      funnelId = created.body.id;
      expect(created.body).toMatchObject({ kind: 'TENANT', name: 'E2E funnel zen', steps: ['lead', 'trial_booked', 'purchase'], windowDays: 30 });

      const zen = await as(ownerToken, ZEN).get(`/studios/${ZEN}/funnels`);
      expect(zen.status).toBe(200);
      const ids: string[] = zen.body.items.map((f: { id: string }) => f.id);
      expect(ids.slice(0, 3)).toEqual(['ready.lead-to-member', 'ready.trial-to-member', 'ready.visitor-to-member']);
      expect(ids).toContain(funnelId);

      const t2 = await as(superAdminToken, T2).get(`/studios/${T2}/funnels`);
      expect(t2.body.items.map((f: { id: string }) => f.id)).not.toContain(funnelId);
    });

    it('validates steps, names and windows', async () => {
      const post = (body: unknown) => as(ownerToken, ZEN).post(`/studios/${ZEN}/funnels`).send(body as object);
      expect((await post({ name: 'E2E funnel x', steps: ['lead'] })).status).toBe(400);
      expect((await post({ name: 'E2E funnel x', steps: ['lead', 'trial_booked', 'trial_attended', 'purchase', 'subscription_started', 'subscription_renewed', 'studio_signup'] })).status).toBe(400);
      expect((await post({ name: 'E2E funnel x', steps: ['lead', 'lead'] })).status).toBe(400);
      expect((await post({ name: 'E2E funnel x', steps: ['visit', 'lead'] })).status).toBe(400);
      expect((await post({ name: 'E2E funnel x', steps: ['lead', 'purchase'], windowDays: 0 })).status).toBe(400);
      expect((await post({ name: '', steps: ['lead', 'purchase'] })).status).toBe(400);
      // A studioId in the body is refused (by the tenant guard or the strict schema), never honoured.
      expect([400, 403]).toContain((await post({ name: 'E2E funnel x', steps: ['lead', 'purchase'], studioId: FLOW })).status);
      expect(await prisma.funnel.count({ where: { studioId: FLOW, name: 'E2E funnel x' } })).toBe(0);
      expect((await as(ownerToken, ZEN).patch(`/studios/${ZEN}/funnels/${funnelId}`).send({})).status).toBe(400);
    });

    it('updates and reports on a tenant funnel', async () => {
      const upd = await as(ownerToken, ZEN).patch(`/studios/${ZEN}/funnels/${funnelId}`).send({ name: 'E2E funnel zen 2', steps: ['lead', 'purchase'] });
      expect(upd.status).toBe(200);
      expect(upd.body).toMatchObject({ name: 'E2E funnel zen 2', steps: ['lead', 'purchase'], windowDays: 30 });
      const rep = await as(ownerToken, ZEN).get(`/studios/${ZEN}/funnels/${funnelId}/report`);
      expect(rep.status).toBe(200);
      expect(rep.body.steps).toHaveLength(2);
      expect(rep.body.funnel.id).toBe(funnelId);
    });

    it('another studio can neither read, change nor delete it, and the studio path is checked against the caller', async () => {
      const flow = as(flowOwnerToken, FLOW);
      expect((await flow.get(`/studios/${FLOW}/funnels/${funnelId}/report`)).status).toBe(404);
      expect((await flow.patch(`/studios/${FLOW}/funnels/${funnelId}`).send({ name: 'E2E funnel hijack' })).status).toBe(404);
      expect((await flow.delete(`/studios/${FLOW}/funnels/${funnelId}`)).status).toBe(404);
      expect((await flow.get(`/studios/${ZEN}/funnels`)).status).toBe(403);
      expect((await flow.get(`/studios/${ZEN}/funnels/${funnelId}/report`)).status).toBe(403);
      const still = await prisma.funnel.findUniqueOrThrow({ where: { id: funnelId } });
      expect(still.studioId).toBe(ZEN);
      expect(still.name).toBe('E2E funnel zen 2');
    });

    it('unknown ids are 404 and a malformed id on write is 400', async () => {
      expect((await report(T, 'ready.nope')).status).toBe(404);
      expect((await report(T, 'not-a-uuid')).status).toBe(404);
      expect((await report(T, uuid(0xdead))).status).toBe(404);
      expect((await as(ownerToken, ZEN).patch(`/studios/${ZEN}/funnels/not-a-uuid`).send({ name: 'x' })).status).toBe(400);
    });

    it('deletes a tenant funnel and audits the changes', async () => {
      const del = await as(ownerToken, ZEN).delete(`/studios/${ZEN}/funnels/${funnelId}`);
      expect(del.status).toBe(204);
      expect(await prisma.funnel.findUnique({ where: { id: funnelId } })).toBeNull();
      expect((await as(ownerToken, ZEN).delete(`/studios/${ZEN}/funnels/${funnelId}`)).status).toBe(404);
      const actions = (await prisma.auditLog.findMany({ where: { studioId: ZEN, entityType: 'Funnel', entityId: funnelId } })).map((x) => x.action).sort();
      expect(actions).toEqual(['funnel.create', 'funnel.delete', 'funnel.update']);
    });
  });

  describe('permissions', () => {
    it('viewing needs reports.view, managing needs funnels.manage (owner only by default)', async () => {
      // Reception and trainer hold neither permission.
      for (const token of [receptionToken, trainerToken]) {
        expect((await as(token, ZEN).get(`/studios/${ZEN}/funnels`)).status).toBe(403);
        expect((await as(token, ZEN).get(`/studios/${ZEN}/funnels/ready.lead-to-member/report`)).status).toBe(403);
        expect((await as(token, ZEN).post(`/studios/${ZEN}/funnels`).send({ name: 'E2E funnel no', steps: ['lead', 'purchase'] })).status).toBe(403);
      }
      // A role with reports.view only may read but not write.
      expect((await as(viewerToken, ZEN).get(`/studios/${ZEN}/funnels`)).status).toBe(200);
      expect((await as(viewerToken, ZEN).get(`/studios/${ZEN}/funnels/ready.lead-to-member/report`)).status).toBe(200);
      expect((await as(viewerToken, ZEN).post(`/studios/${ZEN}/funnels`).send({ name: 'E2E funnel no', steps: ['lead', 'purchase'] })).status).toBe(403);
      expect((await as(viewerToken, ZEN).patch(`/studios/${ZEN}/funnels/${uuid(1)}`).send({ name: 'x' })).status).toBe(403);
      expect((await as(viewerToken, ZEN).delete(`/studios/${ZEN}/funnels/${uuid(1)}`)).status).toBe(403);
      // The owner holds funnels.manage through the migration grant (existing studios) or the owner rule.
      expect((await as(ownerToken, ZEN).post(`/studios/${ZEN}/funnels`).send({ name: 'E2E funnel owner', steps: ['lead', 'purchase'] })).status).toBe(201);
    });

    it('requires authentication', async () => {
      expect((await request(server).get(`/studios/${ZEN}/funnels`)).status).toBe(401);
    });

    it('the migration granted funnels.manage to existing owner role templates', async () => {
      const owners = await prisma.roleTemplate.findMany({ where: { studioId: { in: [ZEN, FLOW] }, isOwner: true }, include: { permissions: true } });
      expect(owners).toHaveLength(2);
      for (const role of owners) expect(role.permissions.map((p) => p.permissionKey)).toContain('funnels.manage');
    });
  });
});
