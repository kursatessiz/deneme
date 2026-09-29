import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { PrismaClient } from '@platform/database';
import type { JourneyDefinition } from '@platform/shared';
import { AppModule } from '../../src/app.module';
import { MessagingService } from '../../src/modules/messaging/engine/messaging.service';
import { OptOutService } from '../../src/modules/messaging/engine/opt-out.service';

/**
 * G2a growth engagement end to end: segment preview and tenant isolation,
 * contact-level commercial consent in the messaging engine (and its
 * revocation by an opt-out), campaigns (idempotent per contact across two
 * heartbeats, consent and frequency cap respected), journeys (event
 * enrollment, wait, branch, goal exit, re-entry) and the permission
 * checks. Every contact uses the +90539777 prefix and is removed in
 * afterAll together with the segments, campaigns and journeys it created,
 * so the suite passes twice in a row on the same database.
 */

const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Demo1234!';
const PREFIX = '+90539777';
const TAG = 'e2e-g2a';
const MINUTE = 60_000;

function phone(n: number): string {
  return `${PREFIX}${String(n).padStart(4, '0')}`;
}

/** An IANA zone where it is currently around noon, so commercial sends are never in quiet hours. */
function daytimeZone(): string {
  const offset = 12 - new Date().getUTCHours();
  if (offset === 0) return 'Etc/GMT';
  return offset > 0 ? `Etc/GMT-${offset}` : `Etc/GMT+${-offset}`;
}

describe('Growth engagement G2a (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let server: Parameters<typeof request>[0];
  let messaging: MessagingService;

  let ZEN: string;
  let FLOW: string;
  let ownerToken: string;
  let trainerToken: string;
  let memberToken: string;
  let flowOwnerToken: string;
  let superAdminToken: string;
  let originalMessagingSettings: unknown;
  let originalWallet: number;

  const contacts: Record<string, string> = {};
  const segmentIds: string[] = [];
  const campaignIds: string[] = [];
  const journeyIds: string[] = [];

  const login = async (p: string) => {
    const res = await request(server).post('/auth/login').send({ emailOrPhone: p, password: DEMO_PASSWORD });
    expect(res.status).toBe(200);
    return res.body.accessToken as string;
  };
  const as = (token: string, studioId: string) => ({
    get: (url: string) => request(server).get(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId),
    post: (url: string) => request(server).post(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId),
    put: (url: string) => request(server).put(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId),
    patch: (url: string) => request(server).patch(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId),
    delete: (url: string) => request(server).delete(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId),
  });
  const runScheduler = (now: Date) =>
    request(server).post('/admin/scheduler/run').set('Authorization', `Bearer ${superAdminToken}`).send({ now: now.toISOString() });

  async function cleanup() {
    const rows = await prisma.contact.findMany({ where: { phone: { startsWith: PREFIX } }, select: { id: true } });
    const ids = rows.map((r) => r.id);
    await prisma.journey.deleteMany({ where: { studioId: ZEN, name: { startsWith: 'E2E G2A' } } });
    await prisma.campaign.deleteMany({ where: { studioId: ZEN, name: { startsWith: 'E2E G2A' } } });
    await prisma.segment.deleteMany({ where: { studioId: { in: [ZEN, FLOW] }, name: { startsWith: 'E2E G2A' } } });
    await prisma.notificationLog.deleteMany({ where: { OR: [{ contactId: { in: ids } }, { recipientPhone: { startsWith: PREFIX } }] } });
    await prisma.messageSuppression.deleteMany({ where: { address: { startsWith: PREFIX } } });
    await prisma.contactTask.deleteMany({ where: { contactId: { in: ids } } });
    await prisma.contact.deleteMany({ where: { id: { in: ids } } });
  }

  async function makeContact(key: string, n: number, extra: { tags?: string[]; consent?: boolean } = {}) {
    const contact = await prisma.contact.create({
      data: {
        studioId: ZEN,
        firstName: `G2a${key}`,
        lastName: 'E2E',
        phone: phone(n),
        timezone: daytimeZone(),
        lifecycleStage: 'LEAD',
        tags: [TAG, ...(extra.tags ?? [])],
        isTest: true,
      },
    });
    contacts[key] = contact.id;
    if (extra.consent) {
      await prisma.contactConsent.create({
        data: { studioId: ZEN, contactId: contact.id, channel: 'SMS', status: 'GRANTED', source: 'e2e', grantedAt: new Date() },
      });
    }
    return contact.id;
  }

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer();
    prisma = new PrismaClient();
    messaging = app.get(MessagingService);

    const zen = await prisma.studio.findUniqueOrThrow({ where: { slug: 'zen-reformer-pilates' } });
    ZEN = zen.id;
    originalMessagingSettings = zen.messagingSettings;
    FLOW = (await prisma.studio.findUniqueOrThrow({ where: { slug: 'flow-pilates-wellness' } })).id;
    originalWallet = (await prisma.smsWallet.findUniqueOrThrow({ where: { studioId: ZEN } })).balance;
    await cleanup();

    ownerToken = await login('+905321000002');
    trainerToken = await login('+905321000004');
    memberToken = await login('+905321000016');
    flowOwnerToken = await login('+905321000022');
    superAdminToken = await login('+905321000001');

    await makeContact('reach', 1, { consent: true });
    await makeContact('noConsent', 2);
    await makeContact('capped', 3, { consent: true });
  });

  afterAll(async () => {
    await cleanup();
    await prisma.studio.update({ where: { id: ZEN }, data: { messagingSettings: originalMessagingSettings as object } });
    await prisma.smsWallet.update({ where: { studioId: ZEN }, data: { balance: originalWallet } });
    await prisma.$disconnect();
    await app.close();
  });

  // ---------------------------------------------------------------------------

  describe('segments', () => {
    const rules = { combinator: 'and', rules: [{ field: 'contact.tags', op: 'has_any', value: [TAG] }] };

    it('previews the count and a sample of this studio only', async () => {
      const res = await as(ownerToken, ZEN).post(`/studios/${ZEN}/segments/preview`).send({ rules });
      expect(res.status).toBe(201);
      expect(res.body.count).toBe(3);
      expect(res.body.sample.map((s: { id: string }) => s.id).sort()).toEqual(Object.values(contacts).sort());

      // Same rules evaluated in another tenant never see Zen's contacts.
      const flow = await as(superAdminToken, FLOW).post(`/studios/${FLOW}/segments/preview`).send({ rules });
      expect(flow.status).toBe(201);
      expect(flow.body.count).toBe(0);
    });

    it('compiles nested groups, relation and aggregate conditions', async () => {
      const res = await as(ownerToken, ZEN)
        .post(`/studios/${ZEN}/segments/preview`)
        .send({
          rules: {
            combinator: 'and',
            rules: [
              { field: 'contact.tags', op: 'has_any', value: [TAG] },
              { field: 'consent.commercialAllowed', op: 'is_true' },
              {
                combinator: 'or',
                rules: [
                  { field: 'activity.attendedTotal', op: 'eq', value: 0 },
                  { field: 'package.hasActive', op: 'is_true' },
                ],
              },
              { field: 'activity.lastAttendedDaysAgo', op: 'is_empty' },
            ],
          },
        });
      expect(res.status).toBe(201);
      expect(res.body.count).toBe(2);
    });

    it('rejects invalid and not yet available rules with 400', async () => {
      const unknown = await as(ownerToken, ZEN)
        .post(`/studios/${ZEN}/segments/preview`)
        .send({ rules: { combinator: 'and', rules: [{ field: 'contact.nope', op: 'eq', value: 'x' }] } });
      expect(unknown.status).toBe(400);
      const loyalty = await as(ownerToken, ZEN)
        .post(`/studios/${ZEN}/segments/preview`)
        .send({ rules: { combinator: 'and', rules: [{ field: 'loyalty.pointsBalance', op: 'gt', value: 1 }] } });
      expect(loyalty.status).toBe(400);
    });

    it('stores a segment, keeps its members, and hides it from other tenants', async () => {
      const create = await as(ownerToken, ZEN).post(`/studios/${ZEN}/segments`).send({ name: 'E2E G2A kitle', kind: 'DYNAMIC', rules });
      expect(create.status).toBe(201);
      segmentIds.push(create.body.id);
      expect(create.body.cachedCount).toBe(3);

      const members = await as(ownerToken, ZEN).get(`/studios/${ZEN}/segments/${create.body.id}/contacts`);
      expect(members.status).toBe(200);
      expect(members.body.total).toBe(3);

      expect((await as(superAdminToken, FLOW).get(`/studios/${FLOW}/segments/${create.body.id}`)).status).toBe(404);
      expect((await as(flowOwnerToken, ZEN).get(`/studios/${ZEN}/segments`)).status).toBe(403);
    });
  });

  // ---------------------------------------------------------------------------

  describe('contact-level consent', () => {
    const send = () =>
      messaging.send({ studioId: ZEN, recipient: { contactId: contacts.noConsent }, channel: 'SMS', purpose: 'COMMERCIAL', templateKey: 'WIN_BACK' });

    it('blocks a commercial message without consent, allows it once staff records consent, blocks it again after revocation', async () => {
      expect(await send()).toMatchObject({ success: false, reasonCode: 'CONSENT_REQUIRED' });

      const missingEvidence = await as(ownerToken, ZEN).put(`/crm/studios/${ZEN}/contacts/${contacts.noConsent}/consents`).send({ channel: 'SMS', granted: true });
      expect(missingEvidence.status).toBe(400);

      const grant = await as(ownerToken, ZEN)
        .put(`/crm/studios/${ZEN}/contacts/${contacts.noConsent}/consents`)
        .send({ channel: 'SMS', granted: true, evidence: 'E2E imzali form' });
      expect(grant.status).toBe(200);
      expect(grant.body.items.find((c: { channel: string }) => c.channel === 'SMS')).toMatchObject({ status: 'GRANTED', decidedBy: 'contact' });
      expect(await send()).toMatchObject({ success: true, channel: 'SMS' });

      const revoke = await as(ownerToken, ZEN).put(`/crm/studios/${ZEN}/contacts/${contacts.noConsent}/consents`).send({ channel: 'SMS', granted: false });
      expect(revoke.status).toBe(200);
      expect(await send()).toMatchObject({ success: false, reasonCode: 'CONSENT_REQUIRED' });
    });

    it('an opt-out (STOP) revokes the contact consent and suppresses the address', async () => {
      await app.get(OptOutService).optOut({
        studioId: ZEN,
        channel: 'SMS',
        address: phone(1),
        reason: 'STOP_KEYWORD',
        contactId: contacts.reach,
        countryCode: 'TR',
        source: 'stop-keyword',
      });
      const detail = await as(ownerToken, ZEN).get(`/crm/studios/${ZEN}/contacts/${contacts.reach}`);
      expect(detail.status).toBe(200);
      expect(detail.body.consents.find((c: { channel: string }) => c.channel === 'SMS')).toMatchObject({ status: 'REVOKED', suppressed: true });

      // Restore for the campaign tests below.
      await prisma.messageSuppression.deleteMany({ where: { address: phone(1) } });
      await prisma.contactConsent.update({
        where: { contactId_channel: { contactId: contacts.reach, channel: 'SMS' } },
        data: { status: 'GRANTED', grantedAt: new Date(), revokedAt: null },
      });
    });

    it('trainers cannot read or change contact consent', async () => {
      expect((await as(trainerToken, ZEN).get(`/crm/studios/${ZEN}/contacts/${contacts.reach}/consents`)).status).toBe(403);
    });
  });

  // ---------------------------------------------------------------------------

  describe('campaigns', () => {
    it('sends once per contact across two heartbeats and respects consent and the frequency cap', async () => {
      // Cap commercial messages at one a day, and use it up for "capped".
      await prisma.studio.update({ where: { id: ZEN }, data: { messagingSettings: { frequencyCap: { perDay: 1, perWeek: 10 } } } });
      expect(
        await messaging.send({ studioId: ZEN, recipient: { contactId: contacts.capped }, channel: 'SMS', purpose: 'COMMERCIAL', templateKey: 'WIN_BACK' }),
      ).toMatchObject({ success: true });

      const segment = await as(ownerToken, ZEN)
        .post(`/studios/${ZEN}/segments`)
        .send({ name: 'E2E G2A kampanya kitlesi', kind: 'STATIC' });
      expect(segment.status).toBe(201);
      segmentIds.push(segment.body.id);
      const members = await as(ownerToken, ZEN)
        .post(`/studios/${ZEN}/segments/${segment.body.id}/members`)
        .send({ add: [contacts.reach, contacts.noConsent, contacts.capped] });
      expect(members.status).toBe(201);
      expect(members.body.cachedCount).toBe(3);

      const create = await as(ownerToken, ZEN)
        .post(`/studios/${ZEN}/campaigns`)
        .send({ name: 'E2E G2A kampanya', segmentId: segment.body.id, channel: 'SMS', templateKey: 'WIN_BACK' });
      expect(create.status).toBe(201);
      expect(create.body.status).toBe('DRAFT');
      campaignIds.push(create.body.id);

      const test = await as(ownerToken, ZEN).post(`/studios/${ZEN}/campaigns/${create.body.id}/test-send`);
      expect(test.status).toBe(201);
      expect(typeof test.body.success).toBe('boolean');

      const scheduled = await as(ownerToken, ZEN).post(`/studios/${ZEN}/campaigns/${create.body.id}/schedule`).send({});
      expect(scheduled.status).toBe(201);
      expect(scheduled.body.status).toBe('SCHEDULED');

      const now = new Date();
      expect((await runScheduler(now)).status).toBe(201);
      expect((await runScheduler(new Date(now.getTime() + MINUTE))).status).toBe(201);

      const recipients = await prisma.campaignRecipient.findMany({ where: { campaignId: create.body.id } });
      const byContact = Object.fromEntries(recipients.map((r) => [r.contactId, r]));
      expect(recipients).toHaveLength(3);
      expect(byContact[contacts.reach]).toMatchObject({ status: 'SENT' });
      expect(byContact[contacts.noConsent]).toMatchObject({ status: 'SKIPPED', reasonCode: 'CONSENT_REQUIRED' });
      expect(byContact[contacts.capped]).toMatchObject({ status: 'SKIPPED', reasonCode: 'FREQUENCY_CAP' });
      expect(await prisma.notificationLog.count({ where: { campaignId: create.body.id, status: 'SENT' } })).toBe(1);

      const detail = await as(ownerToken, ZEN).get(`/studios/${ZEN}/campaigns/${create.body.id}`);
      expect(detail.status).toBe(200);
      expect(detail.body).toMatchObject({ status: 'SENT', stats: { audience: 3, sent: 1, skipped: 2, pending: 0 } });
      expect(detail.body.stats.skippedByReason).toMatchObject({ CONSENT_REQUIRED: 1, FREQUENCY_CAP: 1 });

      // A sent campaign cannot be changed or rescheduled.
      expect((await as(ownerToken, ZEN).patch(`/studios/${ZEN}/campaigns/${create.body.id}`).send({ name: 'x' })).status).toBe(409);
      await prisma.studio.update({ where: { id: ZEN }, data: { messagingSettings: originalMessagingSettings as object } });
    });

    it('cannot be read in another tenant', async () => {
      expect((await as(superAdminToken, FLOW).get(`/studios/${FLOW}/campaigns/${campaignIds[0]}`)).status).toBe(404);
    });
  });

  // ---------------------------------------------------------------------------

  describe('journeys', () => {
    it('enrolls on an event, waits, branches, exits on the goal and never sends twice', async () => {
      const vip = await makeContact('vip', 11, { consent: true, tags: ['e2e-vip'] });
      const plain = await makeContact('plain', 12);
      const goal = await makeContact('goal', 13, { consent: true, tags: ['e2e-vip'] });

      const definition: JourneyDefinition = {
        trigger: {
          kind: 'event',
          event: 'tag_added',
          filter: { combinator: 'and', rules: [{ field: 'contact.tags', op: 'has_any', value: ['e2e-start'] }] },
        },
        entryStepId: 'wait_hour',
        steps: {
          wait_hour: { type: 'wait', minutes: 60, next: 'is_vip' },
          is_vip: {
            type: 'branch',
            condition: { combinator: 'and', rules: [{ field: 'contact.tags', op: 'has_any', value: ['e2e-vip'] }] },
            ifTrue: 'offer',
            ifFalse: 'mark',
          },
          offer: { type: 'send', channel: 'SMS', allowFallback: false, templateKey: 'WIN_BACK', purpose: 'COMMERCIAL', next: 'follow_up' },
          follow_up: { type: 'create_task', titleKey: 'journeys.task.followUpLead', assignTo: 'CONTACT_OWNER', dueInMinutes: 60, next: null },
          mark: { type: 'update_contact', addTags: ['e2e-not-vip'], removeTags: [], setFields: {}, next: null },
        },
        goal: { combinator: 'and', rules: [{ field: 'contact.tags', op: 'has_any', value: ['e2e-goal'] }] },
        reentry: 'NEVER',
      };

      const invalid = await as(ownerToken, ZEN)
        .post(`/studios/${ZEN}/journeys`)
        .send({ name: 'E2E G2A gecersiz', definition: { ...definition, steps: { ...definition.steps, mark: { ...definition.steps.mark, next: 'wait_hour' } } } });
      expect(invalid.status).toBe(400);
      const points = await as(ownerToken, ZEN)
        .post(`/studios/${ZEN}/journeys`)
        .send({ name: 'E2E G2A puan', definition: { ...definition, steps: { ...definition.steps, mark: { type: 'award_points', points: 5, reasonKey: 'x', next: null } } } });
      expect(points.status).toBe(400);

      const create = await as(ownerToken, ZEN).post(`/studios/${ZEN}/journeys`).send({ name: 'E2E G2A akis', definition });
      expect(create.status).toBe(201);
      journeyIds.push(create.body.id);
      const journeyId = create.body.id as string;
      expect((await as(ownerToken, ZEN).post(`/studios/${ZEN}/journeys/${journeyId}/activate`)).status).toBe(201);

      for (const id of [vip, plain, goal]) {
        const res = await as(ownerToken, ZEN).post(`/crm/studios/${ZEN}/contacts/${id}/tags`).send({ add: ['e2e-start'] });
        expect(res.status).toBe(201);
      }
      expect(await prisma.journeyEnrollment.count({ where: { journeyId } })).toBe(3);

      // First heartbeat: everyone is waiting.
      const start = new Date();
      await runScheduler(start);
      const waiting = await prisma.journeyEnrollment.findMany({ where: { journeyId } });
      expect(waiting.every((e) => e.status === 'ACTIVE' && e.currentStepId === 'wait_hour')).toBe(true);

      // The goal becomes true for one contact during the wait; re-tagging never re-enrolls (NEVER).
      await as(ownerToken, ZEN).post(`/crm/studios/${ZEN}/contacts/${goal}/tags`).send({ add: ['e2e-goal'] });
      expect(await prisma.journeyEnrollment.count({ where: { journeyId } })).toBe(3);

      const later = new Date(start.getTime() + 61 * MINUTE);
      await runScheduler(later);
      await runScheduler(new Date(later.getTime() + MINUTE));

      const done = Object.fromEntries((await prisma.journeyEnrollment.findMany({ where: { journeyId } })).map((e) => [e.contactId, e]));
      expect(done[vip]).toMatchObject({ status: 'COMPLETED' });
      expect(done[plain]).toMatchObject({ status: 'COMPLETED' });
      expect(done[goal]).toMatchObject({ status: 'EXITED_GOAL', exitReason: 'GOAL' });

      expect(await prisma.notificationLog.count({ where: { journeyRunId: done[vip].id, status: 'SENT' } })).toBe(1);
      expect(await prisma.notificationLog.count({ where: { journeyRunId: { in: [done[plain].id, done[goal].id] } } })).toBe(0);
      expect(await prisma.contactTask.count({ where: { contactId: vip } })).toBe(1);
      expect((await prisma.contact.findUniqueOrThrow({ where: { id: plain } })).tags).toContain('e2e-not-vip');

      const detail = await as(ownerToken, ZEN).get(`/studios/${ZEN}/journeys/${journeyId}`);
      expect(detail.status).toBe(200);
      expect(detail.body.stats.enrollments).toMatchObject({ COMPLETED: 2, EXITED_GOAL: 1 });
      expect(detail.body.stats.steps.offer).toMatchObject({ done: 1 });

      // A running journey's steps cannot be edited.
      expect((await as(ownerToken, ZEN).patch(`/studios/${ZEN}/journeys/${journeyId}`).send({ definition })).status).toBe(409);
      expect((await as(ownerToken, ZEN).post(`/studios/${ZEN}/journeys/${journeyId}/archive`)).status).toBe(201);
    });

    it('creates a journey from the template gallery as a draft', async () => {
      const templates = await as(ownerToken, ZEN).get(`/studios/${ZEN}/journeys/templates`);
      expect(templates.status).toBe(200);
      expect(templates.body.items.map((t: { key: string }) => t.key)).toEqual(
        expect.arrayContaining(['booking_reminder', 'win_back', 'new_lead_follow_up']),
      );
      const res = await as(ownerToken, ZEN).post(`/studios/${ZEN}/journeys/from-template`).send({ templateKey: 'win_back', name: 'E2E G2A geri kazanma' });
      expect(res.status).toBe(201);
      journeyIds.push(res.body.id);
      expect(res.body).toMatchObject({ status: 'DRAFT', templateKey: 'win_back', legacyRuleType: 'WIN_BACK' });
      const segmentId = res.body.definition.trigger.segmentId as string;
      const segment = await prisma.segment.findFirstOrThrow({ where: { id: segmentId, studioId: ZEN } });
      await prisma.segment.update({ where: { id: segment.id }, data: { name: 'E2E G2A geri kazanma kitlesi' } });
    });
  });

  // ---------------------------------------------------------------------------

  describe('permissions', () => {
    it('trainers and members get 403 on every G2a route', async () => {
      for (const token of [trainerToken, memberToken]) {
        expect((await as(token, ZEN).get(`/studios/${ZEN}/segments`)).status).toBe(403);
        expect((await as(token, ZEN).post(`/studios/${ZEN}/segments/preview`).send({ rules: { combinator: 'and', rules: [{ field: 'contact.locale', op: 'eq', value: 'tr' }] } })).status).toBe(403);
        expect((await as(token, ZEN).get(`/studios/${ZEN}/campaigns`)).status).toBe(403);
        expect((await as(token, ZEN).get(`/studios/${ZEN}/journeys`)).status).toBe(403);
        expect((await as(token, ZEN).post(`/studios/${ZEN}/journeys/from-template`).send({ templateKey: 'birthday' })).status).toBe(403);
      }
    });

    it('a role without the marketing keys cannot manage, the owner can', async () => {
      expect((await as(ownerToken, ZEN).get(`/studios/${ZEN}/campaigns`)).status).toBe(200);
      const reception = await login('+905321000003');
      expect((await as(reception, ZEN).get(`/studios/${ZEN}/journeys`)).status).toBe(403);
    });
  });
});
