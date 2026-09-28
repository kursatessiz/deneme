import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { PrismaClient } from '@platform/database';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../../src/app.module';
import { ConversionService } from '../../src/modules/crm/conversions/conversion.service';
import { CrmHooksService } from '../../src/modules/crm/hooks/crm-hooks.service';

/**
 * G1b CRM: contacts, tags, custom fields, pipeline stages, tasks, merge,
 * CSV export, tenant isolation and permissions on every /crm route,
 * lifecycle hooks (member created, purchase, lapsed, trial booked and
 * attended), conversion idempotency, server-side identification through
 * the public lead form, and the attribution report on a constructed
 * scenario in a throwaway studio.
 *
 * Every row this suite creates uses the +90539777 phone prefix or lives in
 * the throwaway studio and is removed in afterAll, so the suite passes
 * twice in a row on the same database.
 */

const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Demo1234!';
const HOUR = 3600_000;
const DAY = 24 * HOUR;
const OWNER_PHONE = '+905321000002';
const RECEPTION_PHONE = '+905321000003';
const TRAINER_PHONE = '+905321000004';
const FLOW_OWNER_PHONE = '+905321000022';
const SUPER_ADMIN_PHONE = '+905321000001';
const PREFIX = '+90539777';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

function phone(n: number): string {
  return `${PREFIX}${String(n).padStart(4, '0')}`;
}

function uuid(seed: number): string {
  const hex = seed.toString(16).padStart(12, '0');
  return `e2e0c0de-0000-4000-8000-${hex}`;
}

describe('CRM (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let server: any;

  let ZEN: string;
  let FLOW: string;
  let ownerToken: string;
  let receptionToken: string;
  let trainerToken: string;
  let flowOwnerToken: string;
  let superAdminToken: string;
  let trainerMembershipId: string;

  const userPhones: string[] = [];
  const scheduleIds: string[] = [];
  const tempStudioIds: string[] = [];
  const FORM_VISITOR = uuid(0xa11ce);
  const visitorIds: string[] = [FORM_VISITOR];
  const mergeSurvivorIds: string[] = [];

  const login = async (p: string) => {
    const res = await request(server).post('/auth/login').send({ emailOrPhone: p, password: DEMO_PASSWORD });
    expect(res.status).toBe(200);
    return res.body.accessToken as string;
  };

  const as = (token: string, studioId: string) => ({
    get: (url: string) => request(server).get(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId),
    post: (url: string) => request(server).post(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId),
    patch: (url: string) => request(server).patch(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId),
    put: (url: string) => request(server).put(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId),
    delete: (url: string) => request(server).delete(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId),
  });

  const cleanup = async () => {
    const members = await prisma.membership.findMany({
      where: { user: { phone: { startsWith: PREFIX } } },
      select: { id: true, memberProfile: { select: { id: true } } },
    });
    const memberProfileIds = members.flatMap((m) => (m.memberProfile ? [m.memberProfile.id] : []));
    await prisma.contact.deleteMany({ where: { phone: { startsWith: PREFIX } } });
    await prisma.contact.deleteMany({
      where: { studioId: ZEN, email: { in: ['nehir.e2e@example.com', 'nehir.ikinci@example.com'] } },
    });
    await prisma.contact.deleteMany({ where: { membershipId: { in: members.map((m) => m.id) } } });
    await prisma.booking.deleteMany({ where: { memberId: { in: memberProfileIds } } });
    await prisma.payment.deleteMany({ where: { memberId: { in: memberProfileIds } } });
    await prisma.memberPackage.deleteMany({ where: { memberId: { in: memberProfileIds } } });
    await prisma.memberProfile.deleteMany({ where: { id: { in: memberProfileIds } } });
    await prisma.membership.deleteMany({ where: { id: { in: members.map((m) => m.id) } } });
    await prisma.user.deleteMany({ where: { phone: { startsWith: PREFIX } } });
    await prisma.sessionSchedule.deleteMany({ where: { id: { in: scheduleIds } } });
    await prisma.visitor.deleteMany({ where: { id: { in: visitorIds } } });
    await prisma.studio.deleteMany({ where: { id: { in: tempStudioIds } } });
    await prisma.studio.deleteMany({ where: { slug: { startsWith: 'e2e-crm-attr-' } } });
    await prisma.pipelineStage.deleteMany({ where: { studioId: ZEN, key: { startsWith: 'E2E_' } } });
    await prisma.contactFieldDefinition.deleteMany({ where: { studioId: ZEN, key: { startsWith: 'e2e_' } } });
    await prisma.auditLog.deleteMany({ where: { studioId: ZEN, action: 'contact.merge', entityId: { in: mergeSurvivorIds } } });
    await prisma.roleTemplate.deleteMany({ where: { studioId: ZEN, key: 'e2e_crm_only' } });
  };

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer();
    prisma = new PrismaClient();

    ZEN = (await prisma.studio.findUniqueOrThrow({ where: { slug: 'zen-reformer-pilates' } })).id;
    FLOW = (await prisma.studio.findUniqueOrThrow({ where: { slug: 'flow-pilates-wellness' } })).id;
    trainerMembershipId = (
      await prisma.membership.findFirstOrThrow({ where: { studioId: ZEN, user: { phone: TRAINER_PHONE } } })
    ).id;
    await cleanup();

    ownerToken = await login(OWNER_PHONE);
    receptionToken = await login(RECEPTION_PHONE);
    trainerToken = await login(TRAINER_PHONE);
    flowOwnerToken = await login(FLOW_OWNER_PHONE);
    superAdminToken = await login(SUPER_ADMIN_PHONE);
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
    await app.close();
  });

  // ---------------------------------------------------------------------------

  describe('contacts', () => {
    let contactId: string;
    let otherId: string;

    it('owner creates a contact with tags; phone is normalised and duplicates are refused', async () => {
      const res = await as(ownerToken, ZEN)
        .post(`/crm/studios/${ZEN}/contacts`)
        .send({ firstName: 'Nehir', lastName: 'Aydin', phone: '0539 777 00 01', email: 'nehir.e2e@example.com', tags: ['VIP', 'vip '] });
      expect(res.status).toBe(201);
      expect(res.body.phone).toBe(phone(1));
      expect(res.body.tags).toEqual(['vip']);
      expect(res.body.lifecycleStage).toBe('LEAD');
      contactId = res.body.id;

      const dup = await as(ownerToken, ZEN).post(`/crm/studios/${ZEN}/contacts`).send({ firstName: 'X', phone: phone(1) });
      expect(dup.status).toBe(409);
      const dupEmail = await as(ownerToken, ZEN)
        .post(`/crm/studios/${ZEN}/contacts`)
        .send({ firstName: 'Y', phone: phone(9), email: 'NEHIR.E2E@example.com' });
      expect(dupEmail.status).toBe(409);
    });

    it('lists and filters by tag, stage, source, owner and text', async () => {
      const other = await as(ownerToken, ZEN).post(`/crm/studios/${ZEN}/contacts`).send({
        firstName: 'Mavi',
        lastName: 'Deniz',
        phone: phone(2),
        pipelineStageKey: 'CONTACTED',
        ownerMembershipId: trainerMembershipId,
        sourceChannel: 'INSTAGRAM',
      });
      expect(other.status).toBe(201);
      otherId = other.body.id;
      expect(other.body.pipelineStage.key).toBe('CONTACTED');

      const byTag = await as(ownerToken, ZEN).get(`/crm/studios/${ZEN}/contacts?tag=VIP`);
      expect(byTag.body.items.map((c: any) => c.id)).toContain(contactId);
      expect(byTag.body.items.map((c: any) => c.id)).not.toContain(otherId);

      const byStage = await as(ownerToken, ZEN).get(`/crm/studios/${ZEN}/contacts?stage=CONTACTED`);
      expect(byStage.body.items.every((c: any) => c.pipelineStage?.key === 'CONTACTED')).toBe(true);
      expect(byStage.body.items.map((c: any) => c.id)).toContain(otherId);

      const bySource = await as(ownerToken, ZEN).get(`/crm/studios/${ZEN}/contacts?source=instagram`);
      expect(bySource.body.items.map((c: any) => c.id)).toContain(otherId);

      const byOwner = await as(ownerToken, ZEN).get(`/crm/studios/${ZEN}/contacts?ownerMembershipId=${trainerMembershipId}`);
      expect(byOwner.body.items.map((c: any) => c.id)).toEqual([otherId]);

      const byText = await as(ownerToken, ZEN).get(`/crm/studios/${ZEN}/contacts?search=${encodeURIComponent('Mavi Deniz')}`);
      expect(byText.body.items.map((c: any) => c.id)).toContain(otherId);

      const tooBig = await as(ownerToken, ZEN).get(`/crm/studios/${ZEN}/contacts?limit=500`);
      expect(tooBig.status).toBe(400);
    });

    it('custom fields are validated against the tenant definitions', async () => {
      const field = await as(ownerToken, ZEN)
        .post(`/crm/studios/${ZEN}/fields`)
        .send({ key: 'e2e_goal', label: { tr: 'Hedef', en: 'Goal' }, kind: 'enum', options: ['strength', 'mobility'] });
      expect(field.status).toBe(201);

      const bad = await as(ownerToken, ZEN).patch(`/crm/studios/${ZEN}/contacts/${contactId}`).send({ customFields: { e2e_goal: 'speed' } });
      expect(bad.status).toBe(400);
      const unknown = await as(ownerToken, ZEN).patch(`/crm/studios/${ZEN}/contacts/${contactId}`).send({ customFields: { e2e_nope: 'x' } });
      expect(unknown.status).toBe(400);
      const ok = await as(ownerToken, ZEN).patch(`/crm/studios/${ZEN}/contacts/${contactId}`).send({ customFields: { e2e_goal: 'mobility' } });
      expect(ok.status).toBe(200);
      expect(ok.body.customFields).toEqual({ e2e_goal: 'mobility' });

      const list = await as(ownerToken, ZEN).get(`/crm/studios/${ZEN}/fields`);
      expect(list.body.find((f: any) => f.key === 'e2e_goal').label).toEqual({ tr: 'Hedef', en: 'Goal' });
    });

    it('tags can be added and removed; the tag list counts contacts', async () => {
      const res = await as(ownerToken, ZEN).post(`/crm/studios/${ZEN}/contacts/${contactId}/tags`).send({ add: ['E2E Yeni'], remove: ['vip'] });
      expect(res.status).toBe(201);
      expect(res.body.tags).toEqual(['e2e yeni']);
      const tags = await as(ownerToken, ZEN).get(`/crm/studios/${ZEN}/tags`);
      expect(tags.body.find((t: any) => t.tag === 'e2e yeni').count).toBeGreaterThanOrEqual(1);
    });

    it('moving to a LOST stage needs a reason and sets the lifecycle', async () => {
      const noReason = await as(ownerToken, ZEN).patch(`/crm/studios/${ZEN}/contacts/${otherId}`).send({ pipelineStageKey: 'LOST' });
      expect(noReason.status).toBe(400);
      const lost = await as(ownerToken, ZEN)
        .patch(`/crm/studios/${ZEN}/contacts/${otherId}`)
        .send({ pipelineStageKey: 'LOST', lostReason: 'Butce' });
      expect(lost.status).toBe(200);
      expect(lost.body.lifecycleStage).toBe('LOST');
      expect(lost.body.pipelineStage.key).toBe('LOST');
    });

    it('tasks can be created, listed and completed', async () => {
      const created = await as(ownerToken, ZEN)
        .post(`/crm/studios/${ZEN}/contacts/${contactId}/tasks`)
        .send({ title: 'Geri ara', dueAt: new Date(Date.now() - HOUR).toISOString(), assigneeMembershipId: trainerMembershipId });
      expect(created.status).toBe(201);
      const overdue = await as(ownerToken, ZEN).get(`/crm/studios/${ZEN}/tasks?overdue=true`);
      expect(overdue.body.map((t: any) => t.id)).toContain(created.body.id);
      const done = await as(ownerToken, ZEN).patch(`/crm/studios/${ZEN}/tasks/${created.body.id}`).send({ status: 'DONE' });
      expect(done.status).toBe(200);
      expect(done.body.completedAt).not.toBeNull();
    });

    it('detail returns activities, tasks, touchpoints and conversions', async () => {
      await as(ownerToken, ZEN).post(`/crm/studios/${ZEN}/contacts/${contactId}/activities`).send({ type: 'CALL', body: 'Aradim' });
      const res = await as(ownerToken, ZEN).get(`/crm/studios/${ZEN}/contacts/${contactId}`);
      expect(res.status).toBe(200);
      expect(res.body.activities.some((a: any) => a.type === 'CALL')).toBe(true);
      expect(res.body.tasks).toHaveLength(1);
      expect(Array.isArray(res.body.touchpoints)).toBe(true);
      expect(Array.isArray(res.body.conversions)).toBe(true);
    });

    it('merge folds the loser into the survivor, hides it and writes an audit log', async () => {
      const loser = await as(ownerToken, ZEN)
        .post(`/crm/studios/${ZEN}/contacts`)
        .send({ firstName: 'Nehir', lastName: 'A.', email: 'nehir.ikinci@example.com', tags: ['merge-me'] });
      expect(loser.status).toBe(201);
      await as(ownerToken, ZEN).post(`/crm/studios/${ZEN}/contacts/${loser.body.id}/activities`).send({ type: 'NOTE', body: 'loser note' });

      const merged = await as(ownerToken, ZEN).post(`/crm/studios/${ZEN}/contacts/merge`).send({ survivorId: contactId, mergedId: loser.body.id });
      expect(merged.status).toBe(201);
      expect(merged.body.tags.sort()).toEqual(['e2e yeni', 'merge-me']);
      expect(merged.body.email).toBe('nehir.e2e@example.com');

      const gone = await as(ownerToken, ZEN).get(`/crm/studios/${ZEN}/contacts/${loser.body.id}`);
      expect(gone.status).toBe(404);
      const detail = await as(ownerToken, ZEN).get(`/crm/studios/${ZEN}/contacts/${contactId}`);
      expect(detail.body.activities.map((a: any) => a.body)).toEqual(expect.arrayContaining(['loser note']));
      expect(detail.body.activities.some((a: any) => a.type === 'MERGE')).toBe(true);

      mergeSurvivorIds.push(contactId);
      const audit = await prisma.auditLog.findFirst({ where: { studioId: ZEN, action: 'contact.merge', entityId: contactId } });
      expect(audit).not.toBeNull();
      const row = await prisma.contact.findUniqueOrThrow({ where: { id: loser.body.id } });
      expect(row.mergedIntoId).toBe(contactId);

      const self = await as(ownerToken, ZEN).post(`/crm/studios/${ZEN}/contacts/merge`).send({ survivorId: contactId, mergedId: contactId });
      expect(self.status).toBe(400);
      await prisma.contact.delete({ where: { id: loser.body.id } });
    });

    it('owner exports CSV; reception (no crm.export) cannot', async () => {
      const res = await as(ownerToken, ZEN).get(`/crm/studios/${ZEN}/contacts/export?search=Nehir`);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.text).toContain('firstName');
      expect(res.text).toContain('Nehir');
      const denied = await as(receptionToken, ZEN).get(`/crm/studios/${ZEN}/contacts/export`);
      expect(denied.status).toBe(403);
    });
  });

  // ---------------------------------------------------------------------------

  describe('pipeline stages', () => {
    it('lists the system stages, supports custom stages and protects system ones', async () => {
      const list = await as(ownerToken, ZEN).get(`/crm/studios/${ZEN}/pipeline-stages`);
      expect(list.body.filter((s: any) => s.isSystem).map((s: any) => s.key)).toEqual([
        'NEW',
        'CONTACTED',
        'TRIAL_BOOKED',
        'TRIAL_DONE',
        'WON',
        'LOST',
      ]);
      const created = await as(ownerToken, ZEN)
        .post(`/crm/studios/${ZEN}/pipeline-stages`)
        .send({ key: 'E2E_QUOTE', name: 'Teklif verildi', sortOrder: 3 });
      expect(created.status).toBe(201);
      const renamed = await as(ownerToken, ZEN).patch(`/crm/studios/${ZEN}/pipeline-stages/${created.body.id}`).send({ name: 'Teklif' });
      expect(renamed.body.name).toBe('Teklif');
      const system = list.body.find((s: any) => s.key === 'NEW');
      const noDelete = await as(ownerToken, ZEN).delete(`/crm/studios/${ZEN}/pipeline-stages/${system.id}`);
      expect(noDelete.status).toBe(400);
      const deleted = await as(ownerToken, ZEN).delete(`/crm/studios/${ZEN}/pipeline-stages/${created.body.id}`);
      expect(deleted.status).toBe(200);
    });

    it('a new tenant gets the default stages', async () => {
      const temp = await prisma.studio.create({ data: { name: 'E2E CRM gecici', slug: `e2e-crm-attr-${Date.now()}` } });
      tempStudioIds.push(temp.id);
      const res = await as(superAdminToken, temp.id).get(`/crm/studios/${temp.id}/pipeline-stages`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(6);
    });
  });

  // ---------------------------------------------------------------------------

  describe('tenant isolation and permissions', () => {
    let zenContactId: string;

    beforeAll(async () => {
      const res = await as(ownerToken, ZEN).post(`/crm/studios/${ZEN}/contacts`).send({ firstName: 'Izole', phone: phone(20) });
      zenContactId = res.body.id;
    });

    const routes = (studioId: string, contactId: string) => [
      { method: 'get' as const, url: `/crm/studios/${studioId}/contacts` },
      { method: 'get' as const, url: `/crm/studios/${studioId}/contacts/export` },
      { method: 'get' as const, url: `/crm/studios/${studioId}/contacts/${contactId}` },
      { method: 'post' as const, url: `/crm/studios/${studioId}/contacts`, body: { firstName: 'Z', phone: phone(21) } },
      { method: 'patch' as const, url: `/crm/studios/${studioId}/contacts/${contactId}`, body: { notes: 'x' } },
      { method: 'post' as const, url: `/crm/studios/${studioId}/contacts/${contactId}/tags`, body: { add: ['x'] } },
      { method: 'post' as const, url: `/crm/studios/${studioId}/contacts/${contactId}/activities`, body: { type: 'NOTE', body: 'x' } },
      { method: 'post' as const, url: `/crm/studios/${studioId}/contacts/${contactId}/tasks`, body: { title: 'x' } },
      { method: 'post' as const, url: `/crm/studios/${studioId}/contacts/merge`, body: { survivorId: contactId, mergedId: uuid(1) } },
      { method: 'get' as const, url: `/crm/studios/${studioId}/tags` },
      { method: 'get' as const, url: `/crm/studios/${studioId}/tasks` },
      { method: 'get' as const, url: `/crm/studios/${studioId}/pipeline-stages` },
      { method: 'post' as const, url: `/crm/studios/${studioId}/pipeline-stages`, body: { key: 'E2E_X', name: 'x' } },
      { method: 'get' as const, url: `/crm/studios/${studioId}/fields` },
      { method: 'post' as const, url: `/crm/studios/${studioId}/fields`, body: { key: 'e2e_x', label: { tr: 'x' }, kind: 'string' } },
      {
        method: 'get' as const,
        url: `/crm/studios/${studioId}/attribution?from=2026-01-01T00:00:00.000Z&to=2027-01-01T00:00:00.000Z`,
      },
    ];

    it("another studio's owner is refused on every CRM route of this studio", async () => {
      for (const r of routes(ZEN, zenContactId)) {
        const res = await as(flowOwnerToken, ZEN)[r.method](r.url).send(r.body ?? {});
        expect({ url: r.url, status: res.status }).toEqual({ url: r.url, status: 403 });
      }
    });

    it("another studio's owner cannot reach this studio's contact through their own studio", async () => {
      const own = [
        as(flowOwnerToken, FLOW).get(`/crm/studios/${FLOW}/contacts/${zenContactId}`),
        as(flowOwnerToken, FLOW).patch(`/crm/studios/${FLOW}/contacts/${zenContactId}`).send({ notes: 'x' }),
        as(flowOwnerToken, FLOW).post(`/crm/studios/${FLOW}/contacts/${zenContactId}/tags`).send({ add: ['x'] }),
        as(flowOwnerToken, FLOW).post(`/crm/studios/${FLOW}/contacts/${zenContactId}/tasks`).send({ title: 'x' }),
        as(flowOwnerToken, FLOW).post(`/crm/studios/${FLOW}/contacts/${zenContactId}/activities`).send({ type: 'NOTE', body: 'x' }),
      ];
      for (const res of await Promise.all(own)) expect(res.status).toBe(404);
      const list = await as(flowOwnerToken, FLOW).get(`/crm/studios/${FLOW}/contacts?search=Izole`);
      expect(list.body.items.map((c: any) => c.id)).not.toContain(zenContactId);
      const row = await prisma.contact.findUniqueOrThrow({ where: { id: zenContactId } });
      expect(row.notes).toBeNull();
    });

    it('a trainer without crm.view is refused; reception has crm.view and crm.manage by default', async () => {
      expect((await as(trainerToken, ZEN).get(`/crm/studios/${ZEN}/contacts`)).status).toBe(403);
      expect((await as(receptionToken, ZEN).get(`/crm/studios/${ZEN}/contacts`)).status).toBe(200);
      const created = await as(receptionToken, ZEN).post(`/crm/studios/${ZEN}/contacts`).send({ firstName: 'Resepsiyon', phone: phone(22) });
      expect(created.status).toBe(201);
    });

    it('crm.view without members.contact.view hides member phone and email and does not match them in search', async () => {
      const role = await prisma.roleTemplate.create({
        data: {
          studioId: ZEN,
          key: 'e2e_crm_only',
          name: 'E2E yalnizca CRM',
          permissions: { create: [{ permissionKey: 'crm.view' }] },
        },
      });
      const user = await prisma.user.create({
        data: { phone: phone(71), firstName: 'Crm', lastName: 'Gorevli', passwordHash: await bcrypt.hash(DEMO_PASSWORD, 10) },
      });
      await prisma.membership.create({
        data: { userId: user.id, studioId: ZEN, roleTemplateId: role.id, status: 'ACTIVE', joinedAt: new Date() },
      });
      const token = await login(phone(71));
      const member = await prisma.contact.findFirstOrThrow({
        where: { studioId: ZEN, membershipId: { not: null }, phone: { not: null }, mergedIntoId: null, isTest: false },
      });

      const detail = await as(token, ZEN).get(`/crm/studios/${ZEN}/contacts/${member.id}`);
      expect(detail.status).toBe(200);
      expect(detail.body.phone).toBeNull();
      expect(detail.body.email).toBeNull();

      const digits = (member.phone ?? '').slice(-7);
      const search = await as(token, ZEN).get(`/crm/studios/${ZEN}/contacts?search=${digits}`);
      expect(search.status).toBe(200);
      expect(search.body.items.map((c: { id: string }) => c.id)).not.toContain(member.id);

      // The owner (who has members.contact.view) still sees and finds it.
      const ownerSearch = await as(ownerToken, ZEN).get(`/crm/studios/${ZEN}/contacts?search=${digits}`);
      const found = ownerSearch.body.items.find((c: { id: string }) => c.id === member.id);
      expect(found?.phone).toBe(member.phone);
    });

    it('unauthenticated requests are refused', async () => {
      const res = await request(server).get(`/crm/studios/${ZEN}/contacts`);
      expect(res.status).toBe(401);
    });
  });

  // ---------------------------------------------------------------------------

  describe('lifecycle hooks and conversions', () => {
    let memberProfileId: string;
    let membershipId: string;

    it('creating a member creates a linked MEMBER contact', async () => {
      const res = await as(ownerToken, ZEN)
        .post('/members')
        .send({ studioId: ZEN, firstName: 'Kanca', lastName: 'Uye', phone: phone(30) });
      expect(res.status).toBe(201);
      memberProfileId = res.body.id;
      membershipId = res.body.membershipId;
      const contact = await prisma.contact.findFirstOrThrow({ where: { studioId: ZEN, phone: phone(30) } });
      expect(contact.membershipId).toBe(membershipId);
      expect(contact.lifecycleStage).toBe('MEMBER');
    });

    it('a package sale records one purchase conversion with its value; re-running the hook adds nothing', async () => {
      const pkg = await prisma.packageDefinition.findFirstOrThrow({ where: { studioId: ZEN, name: '10 Seans Birebir Reformer' } });
      const sold = await as(ownerToken, ZEN).post('/members/packages/assign').send({
        studioId: ZEN,
        memberId: memberProfileId,
        packageDefinitionId: pkg.id,
        paymentMethod: 'CASH',
        paidAmount: 1250,
      });
      expect(sold.status).toBe(201);
      const payment = await prisma.payment.findFirstOrThrow({ where: { memberId: memberProfileId } });
      const events = await prisma.conversionEvent.findMany({ where: { studioId: ZEN, sourceKind: 'payment', sourceId: payment.id } });
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('purchase');
      expect(events[0].valueAmount?.toFixed(2)).toBe('1250.00');
      expect(events[0].currency).toBe(payment.currency);

      const hooks = app.get(CrmHooksService);
      await hooks.onPaymentCompleted(ZEN, payment.id);
      await hooks.onPaymentCompleted(ZEN, payment.id);
      expect(await prisma.conversionEvent.count({ where: { studioId: ZEN, sourceKind: 'payment', sourceId: payment.id } })).toBe(1);
      expect(await prisma.conversionDelivery.count({ where: { conversionEventId: events[0].id } })).toBe(0);
    });

    it('ConversionService.record is idempotent on the source record', async () => {
      const contact = await prisma.contact.findFirstOrThrow({ where: { studioId: ZEN, phone: phone(30) } });
      const conversions = app.get(ConversionService);
      const input = { studioId: ZEN, type: 'lead' as const, contactId: contact.id, source: { kind: 'e2e_form', id: 'form-1' } };
      const [a, b] = await Promise.all([conversions.record(input), conversions.record(input)]);
      expect(a.event.id).toBe(b.event.id);
      expect([a.created, b.created].filter(Boolean)).toHaveLength(1);
      const again = await conversions.record(input);
      expect(again.created).toBe(false);
      expect(await prisma.conversionEvent.count({ where: { studioId: ZEN, sourceKind: 'e2e_form' } })).toBe(1);
    });

    it('a member whose packages all ended lapses on the scheduler sweep', async () => {
      await prisma.memberPackage.updateMany({ where: { memberId: memberProfileId }, data: { status: 'EXPIRED', endDate: new Date(Date.now() - DAY) } });
      const hooks = app.get(CrmHooksService);
      const result = await hooks.sweepLapsed(new Date());
      expect(result.lapsed).toBeGreaterThanOrEqual(1);
      const contact = await prisma.contact.findFirstOrThrow({ where: { studioId: ZEN, phone: phone(30) } });
      expect(contact.lifecycleStage).toBe('LAPSED');
    });

    it('a lead trial booking records trial_booked; checking in records trial_attended and TRIAL_DONE', async () => {
      const service = await prisma.serviceType.findFirstOrThrow({ where: { studioId: ZEN, name: 'Mat Pilates' } });
      const start = new Date(Date.now() + 30 * HOUR);
      const schedule = await prisma.sessionSchedule.create({
        data: { studioId: ZEN, serviceTypeId: service.id, title: 'E2E CRM trial', startTime: start, endTime: new Date(start.getTime() + HOUR), capacity: 5 },
      });
      scheduleIds.push(schedule.id);

      const lead = await as(ownerToken, ZEN).post('/leads').send({ studioId: ZEN, fullName: 'Deneme Kisi', phone: phone(31), source: 'WALK_IN' });
      expect(lead.status).toBe(201);
      const leadId = lead.body.lead.id;
      expect(await prisma.conversionEvent.count({ where: { studioId: ZEN, contactId: leadId, type: 'lead' } })).toBe(1);

      const trial = await as(ownerToken, ZEN).post(`/leads/${leadId}/trial`).send({ scheduleId: schedule.id });
      expect(trial.status).toBe(201);
      const contact = await prisma.contact.findUniqueOrThrow({ where: { id: leadId } });
      expect(contact.lifecycleStage).toBe('TRIAL');
      expect(await prisma.conversionEvent.count({ where: { contactId: leadId, type: 'trial_booked' } })).toBe(1);

      const checkIn = await as(ownerToken, ZEN).patch(`/schedules/check-in/${trial.body.booking.id}`).send({});
      expect(checkIn.status).toBe(200);
      expect(await prisma.conversionEvent.count({ where: { contactId: leadId, type: 'trial_attended' } })).toBe(1);
      const after = await prisma.contact.findUniqueOrThrow({ where: { id: leadId }, include: { pipelineStage: true } });
      expect(after.pipelineStage?.key).toBe('TRIAL_DONE');
    });
  });

  // ---------------------------------------------------------------------------

  describe('identification through the public lead form', () => {
    it('attaches the visitor touchpoints to the new contact and attributes the lead conversion', async () => {
      const vid = FORM_VISITOR;
      const tp = await request(server)
        .post('/track/zen-reformer-pilates/touchpoint')
        .set('User-Agent', UA)
        .send({
          visitorId: vid,
          sessionId: uuid(0xa11cf),
          landingUrl: 'https://studio.example/embed/zen?utm_source=facebook&utm_medium=paid_social&pw_cid=cmp-1&pw_asid=as-1&pw_adid=ad-1&fbclid=F1',
          utm: {},
          adIds: {},
          clickIds: {},
          consent: { analytics: true, advertising: true },
        });
      expect(tp.status).toBe(204);

      const form = await request(server)
        .post('/public/studios/zen-reformer-pilates/leads')
        .set('X-PW-VID', vid)
        .send({ fullName: 'Reklam Gelen', phone: phone(40), consent: true });
      expect(form.status).toBe(202);

      const contact = await prisma.contact.findFirstOrThrow({ where: { studioId: ZEN, phone: phone(40) } });
      expect(contact.firstSource).toBe('facebook');
      expect(contact.firstCampaignId).toBe('cmp-1');
      expect(contact.lastAdId).toBe('ad-1');
      const touch = await prisma.touchpoint.findFirstOrThrow({ where: { studioId: ZEN, visitorId: vid } });
      expect(touch.contactId).toBe(contact.id);
      expect(touch.landingPath).toBe('/embed/zen');
      const lead = await prisma.conversionEvent.findFirstOrThrow({ where: { contactId: contact.id, type: 'lead' } });
      expect(lead.attributedTouchpointId).toBe(touch.id);

      // The contact detail shows the touchpoint and the conversion.
      const detail = await as(ownerToken, ZEN).get(`/crm/studios/${ZEN}/contacts/${contact.id}`);
      expect(detail.body.touchpoints[0].pwCid).toBe('cmp-1');
      expect(detail.body.conversions.map((c: any) => c.type)).toContain('lead');
    });
  });

  // ---------------------------------------------------------------------------

  describe('attribution report (constructed scenario)', () => {
    let T: string;

    beforeAll(async () => {
      const studio = await prisma.studio.create({ data: { name: 'E2E Atif', slug: `e2e-crm-attr-${Date.now()}-r` } });
      T = studio.id;
      tempStudioIds.push(T);
      const now = Date.now();
      const at = (daysAgo: number) => new Date(now - daysAgo * DAY);

      const mkContact = (id: number, fields: Record<string, unknown> = {}) =>
        prisma.contact.create({ data: { id: uuid(0xc000 + id), studioId: T, firstName: `K${id}`, phone: phone(100 + id), ...fields } });
      const k1 = await mkContact(1);
      const k2 = await mkContact(2);
      const k3 = await mkContact(3, { isTest: true });
      const k4 = await mkContact(4, { firstSource: 'instagram', lastSource: 'instagram', firstCampaignName: 'legacy-campaign' });

      const visitor = async (n: number, contactId: string | null) =>
        prisma.visitor.create({ data: { id: uuid(0xd000 + n), studioId: T, contactId } });
      await visitor(1, k1.id);
      await visitor(2, k2.id);
      await visitor(3, k3.id);
      await visitor(5, null);

      const touch = (n: number, visitorN: number, contactId: string | null, daysAgo: number, fields: Record<string, unknown>) =>
        prisma.touchpoint.create({
          data: {
            id: uuid(0xe000 + n),
            studioId: T,
            visitorId: uuid(0xd000 + visitorN),
            sessionId: uuid(0xf000 + n),
            occurredAt: at(daysAgo),
            landingPath: '/',
            contactId,
            ...fields,
          },
        });
      await touch(1, 1, k1.id, 40, { utmSource: 'google', pwCid: 'c-google', adPlatform: 'GOOGLE' });
      await touch(2, 1, k1.id, 10, { utmSource: 'facebook', pwCid: 'c-meta', pwAsid: 'as-meta', pwAdid: 'ad-meta' });
      await touch(3, 1, k1.id, 2, {});
      await touch(4, 2, k2.id, 5, { utmSource: 'facebook', pwCid: 'c-meta', pwAsid: 'as-meta', pwAdid: 'ad-meta' });
      await touch(6, 3, k3.id, 5, { utmSource: 'facebook', pwCid: 'c-meta' });
      await touch(5, 5, null, 1, { gclid: 'G-untagged', adPlatform: 'GOOGLE', isPaidUntagged: true });

      const conversions = app.get(ConversionService);
      const rec = (contactId: string, type: 'lead' | 'purchase', daysAgo: number, id: string, amount?: string) =>
        conversions.record({
          studioId: T,
          type,
          contactId,
          occurredAt: at(daysAgo),
          source: { kind: 'e2e', id },
          ...(amount ? { value: { amount, currency: 'TRY' } } : {}),
        });
      await rec(k1.id, 'lead', 1, 'k1-lead');
      await rec(k1.id, 'purchase', 1, 'k1-buy', '1000.00');
      await rec(k2.id, 'lead', 4, 'k2-lead');
      await rec(k2.id, 'purchase', 3, 'k2-buy', '500.00');
      await rec(k3.id, 'purchase', 3, 'k3-buy', '9999.00');
      await rec(k4.id, 'lead', 2, 'k4-lead');
    });

    const report = (query: string) =>
      as(superAdminToken, T).get(
        `/crm/studios/${T}/attribution?from=${new Date(Date.now() - 60 * DAY).toISOString()}&to=${new Date(Date.now() + DAY).toISOString()}&${query}`,
      );
    const row = (body: any, key: string) => body.rows.find((r: any) => r.key === key);

    it('stores the last touch in the window on each event', async () => {
      const k1Lead = await prisma.conversionEvent.findFirstOrThrow({ where: { studioId: T, sourceId: 'k1-lead' } });
      expect(k1Lead.attributedTouchpointId).toBe(uuid(0xe000 + 3));
      const k3 = await prisma.conversionEvent.findFirstOrThrow({ where: { studioId: T, sourceId: 'k3-buy' } });
      expect(k3.isTest).toBe(true);
    });

    it('LAST_TOUCH by source (default model), excluding test contacts', async () => {
      const res = await report('groupBy=source');
      expect(res.status).toBe(200);
      expect(res.body.model).toBe('LAST_TOUCH');
      expect(row(res.body, '(direct)')).toEqual({ key: '(direct)', conversions: { lead: 1, purchase: 1 }, revenue: { TRY: '1000.00' } });
      expect(row(res.body, 'facebook')).toEqual({ key: 'facebook', conversions: { lead: 1, purchase: 1 }, revenue: { TRY: '500.00' } });
      expect(row(res.body, 'instagram')).toEqual({ key: 'instagram', conversions: { lead: 1 }, revenue: {} });
      expect(res.body.totals).toEqual({ conversions: { lead: 3, purchase: 2 }, revenue: { TRY: '1500.00' } });
      expect(res.body.untaggedPaidTouchpoints).toBe(1);
      expect(res.body.windowDays).toBe(30);
    });

    it('FIRST_TOUCH by source credits the earliest touch even outside the window', async () => {
      const res = await report('model=FIRST_TOUCH&groupBy=source');
      expect(row(res.body, 'google')).toEqual({ key: 'google', conversions: { lead: 1, purchase: 1 }, revenue: { TRY: '1000.00' } });
      expect(row(res.body, 'facebook').conversions).toEqual({ lead: 1, purchase: 1 });
      expect(row(res.body, 'instagram').conversions).toEqual({ lead: 1 });
      expect(row(res.body, '(direct)')).toBeUndefined();
    });

    it('LINEAR by source splits credit across touches in the window', async () => {
      const res = await report('model=LINEAR&groupBy=source');
      expect(row(res.body, 'facebook')).toEqual({ key: 'facebook', conversions: { lead: 1.5, purchase: 1.5 }, revenue: { TRY: '1000.00' } });
      expect(row(res.body, '(direct)')).toEqual({ key: '(direct)', conversions: { lead: 0.5, purchase: 0.5 }, revenue: { TRY: '500.00' } });
      expect(res.body.totals.revenue).toEqual({ TRY: '1500.00' });
    });

    it('groups by campaign, ad set and ad ids', async () => {
      const campaign = await report('model=LAST_TOUCH&groupBy=campaign');
      expect(row(campaign.body, 'c-meta').conversions).toEqual({ lead: 1, purchase: 1 });
      // K1's last touch has no ids; K4 has no touchpoints and no stored campaign.
      expect(row(campaign.body, '(none)').conversions).toEqual({ lead: 2, purchase: 1 });
      const firstCampaign = await report('model=FIRST_TOUCH&groupBy=campaign');
      expect(row(firstCampaign.body, 'legacy-campaign').conversions).toEqual({ lead: 1 });
      const ad = await report('model=LAST_TOUCH&groupBy=ad');
      expect(row(ad.body, 'ad-meta').conversions).toEqual({ lead: 1, purchase: 1 });
    });

    it('validates the query', async () => {
      expect((await report('model=U_SHAPED')).status).toBe(400);
      expect((await as(superAdminToken, T).get(`/crm/studios/${T}/attribution`)).status).toBe(400);
    });
  });
});
