import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { Prisma, PrismaClient } from '@platform/database';
import { nextLocalTime } from '@platform/shared';
import { AppModule } from '../../src/app.module';

/**
 * M3c campaign A/B test and send time modes (docs/PAZARLAMA_MODULU.md 4.3,
 * 7.4). The A/B test is a campaign feature (any tenant); the platform tenant
 * keeps its approval gate and the approval is bound to the variants.
 *
 * Determinism: the scheduler takes an injected `now`. Send tests use contacts
 * whose local clock is around noon *now* (the messaging engine judges quiet
 * hours on the real clock). Planning tests use a fixed instant in 2030 and
 * fixed zones and never let a message come due, so only the due times are
 * asserted. Everything created here is removed in afterAll.
 */

const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Demo1234!';
const SUPER_ADMIN_PHONE = '+905321000001';
const ZEN_OWNER_PHONE = '+905321000002';
const ZEN_TRAINER_PHONE = '+905321000004';
const FLOW_OWNER_PHONE = '+905321000022';
const PREFIX = '+90539777';
const MINUTE = 60_000;
const NAME = 'M3c e2e';
/** Fixed planning instant: 09:00 in Tokyo, 20:00 the day before in New York (EDT), 03:00 in Istanbul. */
const T0 = new Date('2030-10-05T00:00:00.000Z');

/** A zone where the wall clock reads `hour` right now (Etc/GMT zones have no DST). */
function zoneWithLocalHour(hour: number): string {
  // Etc/GMT zones exist for UTC-12 to UTC+14 only: fold the offset into that range.
  let offset = hour - new Date().getUTCHours();
  if (offset < -12) offset += 24;
  if (offset > 14) offset -= 24;
  if (offset === 0) return 'Etc/GMT';
  return offset > 0 ? `Etc/GMT-${offset}` : `Etc/GMT+${-offset}`;
}

describe('Campaign A/B test and send time (M3c) e2e', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let server: ReturnType<INestApplication['getHttpServer']>;
  const runId = Date.now().toString().slice(-7);
  const startedAt = new Date();

  let ZEN: string;
  let FLOW: string;
  let PLATFORM: string;
  let zenTimezone: string;
  let ownerToken: string;
  let trainerToken: string;
  let flowOwnerToken: string;
  let superAdminToken: string;
  let previousZen: { messagingSettings: Prisma.JsonValue };
  let previousWallet: number | null = null;
  let previousPlatform: { address: string | null; messagingSettings: Prisma.JsonValue };
  let previousPlatformWallet: number | null = null;
  let previousMfaPolicy: boolean | undefined;

  const smsKey = `M3C_SMS_${runId}`;
  const otherKey = `M3C_OTHER_${runId}`;
  let phoneSeq = 0;
  const nextPhone = () => `${PREFIX}${String(phoneSeq++).padStart(4, '0')}`;

  const as = (token: string, studioId: string) => ({
    get: (url: string) => request(server).get(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId),
    post: (url: string) => request(server).post(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId),
    patch: (url: string) => request(server).patch(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId),
  });
  const platformAs = (token: string) => ({
    get: (url: string) => request(server).get(url).set('Authorization', `Bearer ${token}`),
    post: (url: string) => request(server).post(url).set('Authorization', `Bearer ${token}`),
  });
  const login = async (phone: string): Promise<string> => {
    const res = await request(server).post('/auth/login').send({ emailOrPhone: phone, password: DEMO_PASSWORD });
    expect(res.status).toBe(200);
    return res.body.accessToken as string;
  };
  const runScheduler = (now: Date) => request(server).post('/admin/scheduler/run').set('Authorization', `Bearer ${superAdminToken}`).send({ now: now.toISOString() });

  async function makeContact(studioId: string, label: string, extra: { timezone?: string | null; countryCode?: string | null; consent?: boolean } = {}): Promise<string> {
    const contact = await prisma.contact.create({
      data: {
        studioId,
        firstName: `M3c${label}`,
        lastName: 'M3cMarker',
        phone: nextPhone(),
        countryCode: extra.countryCode ?? null,
        timezone: extra.timezone === undefined ? zoneWithLocalHour(12) : extra.timezone,
        locale: 'tr',
        lifecycleStage: 'LEAD',
      },
    });
    if (extra.consent !== false) {
      await prisma.contactConsent.create({ data: { studioId, contactId: contact.id, channel: 'SMS', status: 'GRANTED', source: 'e2e', grantedAt: new Date() } });
    }
    return contact.id;
  }

  async function staticSegment(studioId: string, token: string, label: string, members: string[]): Promise<string> {
    const seg = await as(token, studioId).post(`/studios/${studioId}/segments`).send({ name: `${NAME} ${label}`, kind: 'STATIC' });
    expect(seg.status).toBe(201);
    const add = await as(token, studioId).post(`/studios/${studioId}/segments/${seg.body.id}/members`).send({ add: members });
    expect(add.status).toBe(201);
    return seg.body.id as string;
  }

  async function newCampaign(studioId: string, token: string, label: string, segmentId: string, extra: Record<string, unknown> = {}) {
    const res = await as(token, studioId)
      .post(`/studios/${studioId}/campaigns`)
      .send({ name: `${NAME} ${label}`, segmentId, channel: 'SMS', templateKey: smsKey, ...extra });
    return res;
  }

  const variantsAB = [
    { key: 'A', overrides: { body: 'A-metni {firstName}. Cikis icin RET yazin.' } },
    { key: 'B', overrides: { body: 'B-metni {firstName}. Cikis icin RET yazin.' } },
  ];
  const campaignRow = (id: string) => prisma.campaign.findUniqueOrThrow({ where: { id } });
  const recipientsOf = (campaignId: string) => prisma.campaignRecipient.findMany({ where: { campaignId }, orderBy: { createdAt: 'asc' } });
  const logsOf = (campaignId: string) => prisma.notificationLog.findMany({ where: { campaignId } });

  async function cleanup(): Promise<void> {
    const campaigns = await prisma.campaign.findMany({ where: { name: { startsWith: NAME } }, select: { id: true } });
    const ids = campaigns.map((c) => c.id);
    const contacts = await prisma.contact.findMany({ where: { lastName: 'M3cMarker' }, select: { id: true } });
    const cids = contacts.map((c) => c.id);
    await prisma.approvalRequest.deleteMany({ where: { targetId: { in: ids } } });
    await prisma.notificationLog.deleteMany({ where: { OR: [{ campaignId: { in: ids } }, { contactId: { in: cids } }] } });
    await prisma.campaign.deleteMany({ where: { id: { in: ids } } });
    await prisma.segment.deleteMany({ where: { name: { startsWith: NAME } } });
    await prisma.contact.deleteMany({ where: { id: { in: cids } } });
    await prisma.messageTemplate.deleteMany({ where: { key: { startsWith: 'M3C_' } } });
    await prisma.auditLog.deleteMany({
      where: { createdAt: { gte: startedAt }, OR: [{ action: 'campaign.ab.winner' }, { action: { startsWith: 'marketing.approval.' } }, { action: { startsWith: 'marketing.campaign.' } }] },
    });
  }

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer();
    prisma = new PrismaClient();

    const zen = await prisma.studio.findUniqueOrThrow({ where: { slug: 'zen-reformer-pilates' } });
    ZEN = zen.id;
    zenTimezone = zen.timezone;
    previousZen = { messagingSettings: zen.messagingSettings };
    FLOW = (await prisma.studio.findUniqueOrThrow({ where: { slug: 'flow-pilates-wellness' } })).id;
    const platform = await prisma.studio.findFirstOrThrow({ where: { isPlatform: true } });
    PLATFORM = platform.id;
    previousPlatform = { address: platform.address, messagingSettings: platform.messagingSettings };
    await cleanup();

    // Generous frequency caps and SMS credit: several campaigns reach the same contacts today.
    const cap = { frequencyCap: { perDay: 50, perWeek: 200 } };
    await prisma.studio.update({ where: { id: ZEN }, data: { messagingSettings: cap } });
    await prisma.studio.update({ where: { id: PLATFORM }, data: { messagingSettings: cap } });
    const zenWallet = await prisma.smsWallet.findUnique({ where: { studioId: ZEN } });
    previousWallet = zenWallet?.balance ?? null;
    await prisma.smsWallet.upsert({ where: { studioId: ZEN }, create: { studioId: ZEN, balance: 1000 }, update: { balance: 1000 } });
    const platformWallet = await prisma.smsWallet.findUnique({ where: { studioId: PLATFORM } });
    previousPlatformWallet = platformWallet?.balance ?? null;
    await prisma.smsWallet.upsert({ where: { studioId: PLATFORM }, create: { studioId: PLATFORM, balance: 1000 }, update: { balance: 1000 } });
    const policy = await prisma.platformAccessSettings.findUnique({ where: { id: 'platform' } });
    previousMfaPolicy = policy?.require2faForPlatformRoles;
    await prisma.platformAccessSettings.upsert({ where: { id: 'platform' }, create: { id: 'platform', require2faForPlatformRoles: false }, update: { require2faForPlatformRoles: false } });

    for (const studioId of [ZEN, PLATFORM]) {
      for (const [key, body] of [
        [smsKey, 'Merhaba {firstName}, M3c temel metin. Cikis icin RET yazin.'],
        [otherKey, 'Merhaba {firstName}, M3c baska sablon. Cikis icin RET yazin.'],
      ] as const) {
        await prisma.messageTemplate.create({ data: { studioId, key, channel: 'SMS', locale: 'tr', body, isTransactional: false, isActive: true } });
      }
    }

    ownerToken = await login(ZEN_OWNER_PHONE);
    trainerToken = await login(ZEN_TRAINER_PHONE);
    flowOwnerToken = await login(FLOW_OWNER_PHONE);
    superAdminToken = await login(SUPER_ADMIN_PHONE);
  });

  afterAll(async () => {
    await cleanup();
    await prisma.studio.update({ where: { id: ZEN }, data: { messagingSettings: (previousZen.messagingSettings ?? {}) as Prisma.InputJsonValue } });
    await prisma.studio.update({ where: { id: PLATFORM }, data: { address: previousPlatform.address, messagingSettings: (previousPlatform.messagingSettings ?? {}) as Prisma.InputJsonValue } });
    if (previousWallet !== null) await prisma.smsWallet.update({ where: { studioId: ZEN }, data: { balance: previousWallet } });
    if (previousPlatformWallet !== null) await prisma.smsWallet.update({ where: { studioId: PLATFORM }, data: { balance: previousPlatformWallet } });
    else await prisma.smsWallet.deleteMany({ where: { studioId: PLATFORM } });
    if (previousMfaPolicy !== undefined) await prisma.platformAccessSettings.update({ where: { id: 'platform' }, data: { require2faForPlatformRoles: previousMfaPolicy } });
    await prisma.$disconnect();
    await app.close();
  });

  // ---------------------------------------------------------------------------

  describe('validation', () => {
    let segmentId: string;
    beforeAll(async () => {
      segmentId = await staticSegment(ZEN, ownerToken, 'dogrulama', [await makeContact(ZEN, 'v1')]);
    });

    it('needs two variants, an A/B setup for variants, a local time and known templates and placeholders', async () => {
      const ab = { testShare: 20, metric: 'CLICK_RATE', waitMinutes: 30 };
      expect((await newCampaign(ZEN, ownerToken, 'tek varyant', segmentId, { abTest: ab, variants: [variantsAB[0]] })).status).toBe(400);
      expect((await newCampaign(ZEN, ownerToken, 'varyantsiz', segmentId, { abTest: ab })).status).toBe(400);
      expect((await newCampaign(ZEN, ownerToken, 'ayarsiz', segmentId, { variants: variantsAB })).status).toBe(400);
      expect((await newCampaign(ZEN, ownerToken, 'pay', segmentId, { abTest: { ...ab, testShare: 90 }, variants: variantsAB })).status).toBe(400);
      expect((await newCampaign(ZEN, ownerToken, 'yerel', segmentId, { sendTimeMode: 'RECIPIENT_LOCAL' })).status).toBe(400);
      expect((await newCampaign(ZEN, ownerToken, 'saat', segmentId, { sendTimeMode: 'RECIPIENT_LOCAL', sendTimeLocal: '25:00' })).status).toBe(400);
      expect((await newCampaign(ZEN, ownerToken, 'sablon', segmentId, { abTest: ab, variants: [variantsAB[0], { key: 'B', templateKey: 'M3C_YOK' }] })).status).toBe(400);
      expect((await newCampaign(ZEN, ownerToken, 'yer tutucu', segmentId, { abTest: ab, variants: [variantsAB[0], { key: 'B', overrides: { body: 'Merhaba {gizli}' } }] })).status).toBe(400);
      expect((await newCampaign(ZEN, ownerToken, 'taslak yok', segmentId, { abTest: ab, variants: [variantsAB[0], { key: 'B', aiDraftId: '11111111-1111-4111-8111-111111111111' }] })).status).toBe(400);
      expect((await newCampaign(ZEN, ownerToken, 'whatsapp', segmentId, { channel: 'WHATSAPP', abTest: ab, variants: variantsAB })).status).toBe(400);
      expect(await prisma.campaign.count({ where: { studioId: ZEN, name: { startsWith: NAME } } })).toBe(0);
    });

    it('stores the setup, replaces variants on edit and removes them with the test', async () => {
      const ab = { testShare: 20, metric: 'CLICK_RATE', waitMinutes: 30 };
      const created = await newCampaign(ZEN, ownerToken, 'kayit', segmentId, { abTest: ab, variants: [variantsAB[0], { key: 'B', templateKey: otherKey }], sendTimeMode: 'BEST_TIME', sendTimeLocal: '09:30' });
      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({
        abTest: ab,
        abPhase: 'NOT_STARTED',
        winnerKey: null,
        sendTimeMode: 'BEST_TIME',
        sendTimeLocal: '09:30',
        variants: [
          { key: 'A', templateKey: null, overrides: variantsAB[0].overrides, isWinner: false, stats: null },
          { key: 'B', templateKey: otherKey, overrides: null, isWinner: false },
        ],
      });
      const id = created.body.id as string;

      const edited = await as(ownerToken, ZEN).patch(`/studios/${ZEN}/campaigns/${id}`).send({ variants: [variantsAB[0], variantsAB[1], { key: 'C', overrides: { subject: 'Konu' } }] });
      expect(edited.status).toBe(200);
      expect(edited.body.variants.map((v: { key: string }) => v.key)).toEqual(['A', 'B', 'C']);
      // Switching back to a fixed time drops the stored local time; removing the test removes its variants.
      const fixed = await as(ownerToken, ZEN).patch(`/studios/${ZEN}/campaigns/${id}`).send({ sendTimeMode: 'FIXED', abTest: null });
      expect(fixed.status).toBe(200);
      expect(fixed.body).toMatchObject({ abTest: null, abPhase: null, variants: [], sendTimeMode: 'FIXED', sendTimeLocal: null });
      expect(await prisma.campaignVariant.count({ where: { campaignId: id } })).toBe(0);
      // A test needs its variants again.
      expect((await as(ownerToken, ZEN).patch(`/studios/${ZEN}/campaigns/${id}`).send({ abTest: ab })).status).toBe(400);
    });

    it('is tenant scoped and needs the campaign right', async () => {
      const created = await newCampaign(ZEN, ownerToken, 'izin', segmentId, { abTest: { testShare: 20, metric: 'CLICK_RATE', waitMinutes: 30 }, variants: variantsAB });
      const id = created.body.id as string;
      expect((await as(flowOwnerToken, FLOW).get(`/studios/${FLOW}/campaigns/${id}`)).status).toBe(404);
      expect((await as(flowOwnerToken, FLOW).post(`/studios/${FLOW}/campaigns/${id}/pick-winner`).send({})).status).toBe(404);
      expect((await as(trainerToken, ZEN).post(`/studios/${ZEN}/campaigns/${id}/pick-winner`).send({})).status).toBe(403);
      // Not started: nothing to pick yet; a plain campaign has no test at all.
      expect((await as(ownerToken, ZEN).post(`/studios/${ZEN}/campaigns/${id}/pick-winner`).send({})).status).toBe(409);
      const plain = await newCampaign(ZEN, ownerToken, 'duz', segmentId);
      expect((await as(ownerToken, ZEN).post(`/studios/${ZEN}/campaigns/${plain.body.id}/pick-winner`).send({})).status).toBe(409);
      expect(plain.body).toMatchObject({ abTest: null, variants: [], winnerKey: null, sendTimeMode: 'FIXED' });
    });
  });

  // ---------------------------------------------------------------------------

  describe('A/B test on the send path (a tenant other than the platform)', () => {
    let segmentId: string;
    const contactIds: string[] = [];
    beforeAll(async () => {
      for (let i = 0; i < 20; i += 1) contactIds.push(await makeContact(ZEN, `ab${i}`));
      segmentId = await staticSegment(ZEN, ownerToken, 'ab kitlesi', contactIds);
    });

    it('sends the test share evenly, holds the rest back and sends the winner to the remainder after the wait', async () => {
      const created = await newCampaign(ZEN, ownerToken, 'test payi', segmentId, { abTest: { testShare: 40, metric: 'CLICK_RATE', waitMinutes: 60 }, variants: variantsAB });
      expect(created.status).toBe(201);
      const id = created.body.id as string;
      expect((await as(ownerToken, ZEN).post(`/studios/${ZEN}/campaigns/${id}/schedule`).send({})).status).toBe(201);

      const t0 = new Date();
      expect((await runScheduler(t0)).status).toBe(201);

      let recipients = await recipientsOf(id);
      expect(recipients).toHaveLength(20);
      const test = recipients.filter((r) => r.variantKey !== null);
      const held = recipients.filter((r) => r.variantKey === null);
      expect(test).toHaveLength(8);
      expect(test.filter((r) => r.variantKey === 'A')).toHaveLength(4);
      expect(test.filter((r) => r.variantKey === 'B')).toHaveLength(4);
      expect(test.every((r) => r.status === 'SENT')).toBe(true);
      expect(held).toHaveLength(12);
      expect(held.every((r) => r.status === 'PENDING' && r.nextAttemptAt === null)).toBe(true);
      // Each test recipient got its own variant's text.
      const logs = await logsOf(id);
      expect(logs).toHaveLength(8);
      for (const r of test) {
        const log = logs.find((l) => l.contactId === r.contactId);
        expect(log?.content).toContain(`${r.variantKey}-metni`);
      }
      let detail = await as(ownerToken, ZEN).get(`/studios/${ZEN}/campaigns/${id}`);
      expect(detail.body).toMatchObject({ status: 'SENDING', abPhase: 'WAITING', winnerKey: null });
      expect(detail.body.variants.map((v: { stats: { sent: number } }) => v.stats.sent)).toEqual([4, 4]);

      // The assignment is deterministic: the audience of a second campaign with the same id-independent input differs, this one is fixed.
      const assigned = new Map(test.map((r) => [r.contactId, r.variantKey]));

      // Engagement: B is clicked three times, A once.
      const clicked = (variantKey: string, n: number) =>
        Promise.all(
          test
            .filter((r) => r.variantKey === variantKey)
            .slice(0, n)
            .map((r) => prisma.notificationLog.update({ where: { id: r.notificationLogId as string }, data: { clickedAt: t0 } })),
        );
      await clicked('A', 1);
      await clicked('B', 3);

      // Before the wait is over nothing more goes out, and the manual state stays visible.
      expect((await runScheduler(new Date(t0.getTime() + 59 * MINUTE))).status).toBe(201);
      expect(await logsOf(id)).toHaveLength(8);
      expect((await recipientsOf(id)).filter((r) => r.variantKey === null)).toHaveLength(12);
      expect((await prisma.campaignVariant.findMany({ where: { campaignId: id } })).some((v) => v.isWinner)).toBe(false);

      // After the wait: the winner by click rate (B: 3/4 against 1/4) goes to the remainder.
      expect((await runScheduler(new Date(t0.getTime() + 61 * MINUTE))).status).toBe(201);
      const variants = await prisma.campaignVariant.findMany({ where: { campaignId: id }, orderBy: { key: 'asc' } });
      expect(variants.map((v) => v.isWinner)).toEqual([false, true]);
      expect(variants[0].stats).toEqual({ sent: 4, opened: 0, clicked: 1, converted: 0 });
      expect(variants[1].stats).toEqual({ sent: 4, opened: 0, clicked: 3, converted: 0 });
      recipients = await recipientsOf(id);
      expect(recipients.every((r) => r.status === 'SENT')).toBe(true);
      expect(recipients.filter((r) => r.variantKey === 'B')).toHaveLength(16);
      expect(recipients.filter((r) => r.variantKey === 'A')).toHaveLength(4);
      for (const r of recipients.filter((x) => assigned.has(x.contactId))) expect(r.variantKey).toBe(assigned.get(r.contactId));
      const allLogs = await logsOf(id);
      expect(allLogs).toHaveLength(20);
      expect(allLogs.filter((l) => l.content.includes('B-metni'))).toHaveLength(16);
      detail = await as(ownerToken, ZEN).get(`/studios/${ZEN}/campaigns/${id}`);
      expect(detail.body).toMatchObject({ status: 'SENT', abPhase: 'DECIDED', winnerKey: 'B', stats: { sent: 20, pending: 0 } });
      expect(detail.body.variants.find((v: { key: string }) => v.key === 'B')).toMatchObject({ isWinner: true, stats: { sent: 4, clicked: 3 } });
      // No approval machinery outside the platform tenant.
      expect(await prisma.approvalRequest.count({ where: { targetId: id } })).toBe(0);
      expect(await prisma.auditLog.count({ where: { studioId: ZEN, action: 'campaign.ab.winner', entityId: id } })).toBe(1);
    });

    it('a tie goes to the first variant', async () => {
      const created = await newCampaign(ZEN, ownerToken, 'esitlik', segmentId, { abTest: { testShare: 25, metric: 'OPEN_RATE', waitMinutes: 1 }, variants: variantsAB });
      const id = created.body.id as string;
      expect((await as(ownerToken, ZEN).post(`/studios/${ZEN}/campaigns/${id}/schedule`).send({})).status).toBe(201);
      const t0 = new Date();
      await runScheduler(t0);
      expect((await recipientsOf(id)).filter((r) => r.variantKey !== null)).toHaveLength(5);
      await runScheduler(new Date(t0.getTime() + 2 * MINUTE));
      const variants = await prisma.campaignVariant.findMany({ where: { campaignId: id }, orderBy: { key: 'asc' } });
      expect(variants.map((v) => v.isWinner)).toEqual([true, false]);
      expect((await recipientsOf(id)).every((r) => r.status === 'SENT')).toBe(true);
      expect((await recipientsOf(id)).filter((r) => r.variantKey === 'A')).toHaveLength(3 + 15);
    });

    it('the owner can pick the winner now; the choice is final', async () => {
      const created = await newCampaign(ZEN, ownerToken, 'elle secim', segmentId, { abTest: { testShare: 50, metric: 'CLICK_RATE', waitMinutes: 1440 }, variants: variantsAB });
      const id = created.body.id as string;
      expect((await as(ownerToken, ZEN).post(`/studios/${ZEN}/campaigns/${id}/pick-winner`).send({ variantKey: 'B' })).status).toBe(409);
      expect((await as(ownerToken, ZEN).post(`/studios/${ZEN}/campaigns/${id}/schedule`).send({})).status).toBe(201);
      const t0 = new Date();
      await runScheduler(t0);
      expect((await recipientsOf(id)).filter((r) => r.variantKey === null && r.status === 'PENDING')).toHaveLength(10);

      expect((await as(ownerToken, ZEN).post(`/studios/${ZEN}/campaigns/${id}/pick-winner`).send({ variantKey: 'Z' })).status).toBe(400);
      expect((await as(ownerToken, ZEN).post(`/studios/${ZEN}/campaigns/${id}/pick-winner`).send({ variantKey: 'E' })).status).toBe(400);
      const picked = await as(ownerToken, ZEN).post(`/studios/${ZEN}/campaigns/${id}/pick-winner`).send({ variantKey: 'B' });
      expect(picked.status).toBe(201);
      expect(picked.body).toMatchObject({ winnerKey: 'B', abPhase: 'DECIDED' });
      expect((await as(ownerToken, ZEN).post(`/studios/${ZEN}/campaigns/${id}/pick-winner`).send({})).status).toBe(409);
      expect((await recipientsOf(id)).filter((r) => r.variantKey === 'B')).toHaveLength(10 + 5);

      await runScheduler(new Date(t0.getTime() + MINUTE));
      const logs = await logsOf(id);
      expect(logs).toHaveLength(20);
      expect(logs.filter((l) => l.content.includes('B-metni'))).toHaveLength(15);
      expect(await prisma.auditLog.findFirst({ where: { studioId: ZEN, action: 'campaign.ab.winner', entityId: id } })).toMatchObject({ metadata: { winnerKey: 'B', manual: true } });
      expect((await campaignRow(id)).status).toBe('SENT');
    });

    it('cancelling during the wait also cancels the held-back recipients', async () => {
      const created = await newCampaign(ZEN, ownerToken, 'iptal', segmentId, { abTest: { testShare: 25, metric: 'CLICK_RATE', waitMinutes: 600 }, variants: variantsAB });
      const id = created.body.id as string;
      await as(ownerToken, ZEN).post(`/studios/${ZEN}/campaigns/${id}/schedule`).send({});
      const t0 = new Date();
      await runScheduler(t0);
      expect((await as(ownerToken, ZEN).post(`/studios/${ZEN}/campaigns/${id}/cancel`)).status).toBe(201);
      await runScheduler(new Date(t0.getTime() + 700 * MINUTE));
      const recipients = await recipientsOf(id);
      expect(recipients.filter((r) => r.status === 'CANCELLED')).toHaveLength(15);
      expect(await logsOf(id)).toHaveLength(5);
    });
  });

  // ---------------------------------------------------------------------------

  describe('send time modes', () => {
    async function startAt(id: string, now: Date) {
      expect((await as(ownerToken, ZEN).post(`/studios/${ZEN}/campaigns/${id}/schedule`).send({})).status).toBe(201);
      expect((await runScheduler(now)).status).toBe(201);
    }
    const dueOf = async (id: string) => Object.fromEntries((await recipientsOf(id)).map((r) => [r.contactId, r.nextAttemptAt?.toISOString() ?? null]));

    it('RECIPIENT_LOCAL schedules each recipient on their own clock: contact zone, then country default, then the studio zone', async () => {
      const tokyo = await makeContact(ZEN, 'tokyo', { timezone: 'Asia/Tokyo' });
      const newYork = await makeContact(ZEN, 'ny', { timezone: 'America/New_York' });
      const germany = await makeContact(ZEN, 'de', { timezone: null, countryCode: 'DE' });
      const studioZone = await makeContact(ZEN, 'studio', { timezone: null, countryCode: null });
      const segmentId = await staticSegment(ZEN, ownerToken, 'yerel saat', [tokyo, newYork, germany, studioZone]);
      const created = await newCampaign(ZEN, ownerToken, 'yerel saat', segmentId, { sendTimeMode: 'RECIPIENT_LOCAL', sendTimeLocal: '10:00' });
      expect(created.status).toBe(201);
      const id = created.body.id as string;
      await startAt(id, T0);

      const due = await dueOf(id);
      expect(due[tokyo]).toBe('2030-10-05T01:00:00.000Z');
      expect(due[newYork]).toBe('2030-10-05T14:00:00.000Z');
      expect(due[germany]).toBe('2030-10-05T08:00:00.000Z');
      expect(due[studioZone]).toBe(nextLocalTime(new Date(T0.getTime() - 1), '10:00', zenTimezone).toISOString());
      // Nothing is due yet, so nothing was sent and the campaign keeps sending later.
      expect((await recipientsOf(id)).every((r) => r.status === 'PENDING' && r.variantKey === null)).toBe(true);
      expect(await logsOf(id)).toHaveLength(0);
      const detail = await as(ownerToken, ZEN).get(`/studios/${ZEN}/campaigns/${id}`);
      expect(detail.body).toMatchObject({ status: 'SENDING', sendTimeMode: 'RECIPIENT_LOCAL', sendTimeLocal: '10:00' });
      const list = await as(ownerToken, ZEN).get(`/studios/${ZEN}/campaigns/${id}/recipients`);
      expect(list.body.items.find((r: { contactId: string }) => r.contactId === tokyo)).toMatchObject({ status: 'PENDING', dueAt: '2030-10-05T01:00:00.000Z', variantKey: null });
      await as(ownerToken, ZEN).post(`/studios/${ZEN}/campaigns/${id}/cancel`);
    });

    it('a local time in quiet hours is moved to the next allowed slot', async () => {
      const tokyo = await makeContact(ZEN, 'tokyoq', { timezone: 'Asia/Tokyo' });
      const segmentId = await staticSegment(ZEN, ownerToken, 'sessiz saat', [tokyo]);
      const created = await newCampaign(ZEN, ownerToken, 'sessiz saat', segmentId, { sendTimeMode: 'RECIPIENT_LOCAL', sendTimeLocal: '23:00' });
      const id = created.body.id as string;
      await startAt(id, T0);
      // 23:00 Tokyo is closed for commercial messages: the next 08:00 Tokyo is 23:00Z the same UTC day.
      expect((await dueOf(id))[tokyo]).toBe('2030-10-05T23:00:00.000Z');
      await as(ownerToken, ZEN).post(`/studios/${ZEN}/campaigns/${id}/cancel`);
    });

    it('the messaging engine still holds a due message back inside the recipient quiet hours', async () => {
      // Local time is 03:00 for this contact right now: their 10:00 comes in a few hours, and even then the engine judges "now" on the real clock.
      const night = await makeContact(ZEN, 'night', { timezone: zoneWithLocalHour(3) });
      const segmentId = await staticSegment(ZEN, ownerToken, 'gece', [night]);
      const created = await newCampaign(ZEN, ownerToken, 'gece', segmentId, { sendTimeMode: 'RECIPIENT_LOCAL', sendTimeLocal: '10:00' });
      const id = created.body.id as string;
      // The scheduler's clock is a moment after "schedule now" so the campaign is due.
      const now = new Date(Date.now() + 5_000);
      await startAt(id, now);
      const first = (await recipientsOf(id))[0];
      expect(first.status).toBe('PENDING');
      expect(first.nextAttemptAt!.getTime()).toBeGreaterThan(now.getTime());
      expect(first.nextAttemptAt!.getTime() - now.getTime()).toBeLessThan(24 * 60 * MINUTE);

      const due = new Date(first.nextAttemptAt!.getTime() + MINUTE);
      await runScheduler(due);
      const after = (await recipientsOf(id))[0];
      expect(after.status).toBe('PENDING');
      expect(after.attempts).toBe(1);
      expect(after.nextAttemptAt!.getTime()).toBeGreaterThan(due.getTime());
      expect(await logsOf(id)).toHaveLength(0);
      await as(ownerToken, ZEN).post(`/studios/${ZEN}/campaigns/${id}/cancel`);
    });

    it('BEST_TIME uses the recipient history, then the tenant histogram, then the fallback local time', async () => {
      const own = await makeContact(ZEN, 'bt-own', { timezone: 'Asia/Tokyo' });
      const noHistory = await makeContact(ZEN, 'bt-none', { timezone: 'Asia/Tokyo' });
      const machineOnly = await makeContact(ZEN, 'bt-machine', { timezone: 'Asia/Tokyo' });
      const otherReader = await makeContact(ZEN, 'bt-reader', { timezone: 'Asia/Tokyo' });
      const segmentId = await staticSegment(ZEN, ownerToken, 'en iyi saat', [own, noHistory, machineOnly]);

      async function interact(contactId: string, type: 'OPEN' | 'CLICK', at: string, isMachine = false) {
        const log = await prisma.notificationLog.create({
          data: { studioId: ZEN, contactId, channel: 'EMAIL', purpose: 'COMMERCIAL', type: 'M3C_HISTORY', content: 'gecmis', status: 'SENT', recipientEmail: 'gecmis@example.com' },
        });
        await prisma.messageTrackingEvent.create({ data: { studioId: ZEN, notificationLogId: log.id, type, isMachine, occurredAt: new Date(at) } });
      }
      // 05:xxZ is 14:xx in Tokyo; 07:xxZ is 16:xx.
      await interact(own, 'OPEN', '2030-10-03T05:05:00Z');
      await interact(own, 'OPEN', '2030-10-03T05:40:00Z');
      await interact(own, 'CLICK', '2030-10-04T05:15:00Z');
      for (let i = 0; i < 5; i += 1) await interact(machineOnly, 'OPEN', `2030-10-04T03:0${i}:00Z`, true);
      // An event before the 90 day look-back window does not count.
      await interact(noHistory, 'OPEN', '2030-06-01T03:00:00Z');

      // Tenant histogram is thin (3 human interactions): contacts without history fall back to the campaign's local time.
      const first = await newCampaign(ZEN, ownerToken, 'en iyi saat 1', segmentId, { sendTimeMode: 'BEST_TIME', sendTimeLocal: '09:30' });
      expect(first.status).toBe(201);
      await startAt(first.body.id, T0);
      const due1 = await dueOf(first.body.id);
      expect(due1[own]).toBe('2030-10-05T05:00:00.000Z');
      expect(due1[noHistory]).toBe('2030-10-05T00:30:00.000Z');
      expect(due1[machineOnly]).toBe('2030-10-05T00:30:00.000Z');
      await as(ownerToken, ZEN).post(`/studios/${ZEN}/campaigns/${first.body.id}/cancel`);

      // Ten more human interactions at 16:00 Tokyo make the tenant histogram decisive.
      for (let i = 0; i < 10; i += 1) await interact(otherReader, 'OPEN', `2030-10-02T07:${String(i).padStart(2, '0')}:00Z`);
      const second = await newCampaign(ZEN, ownerToken, 'en iyi saat 2', segmentId, { sendTimeMode: 'BEST_TIME', sendTimeLocal: '09:30' });
      await startAt(second.body.id, T0);
      const due2 = await dueOf(second.body.id);
      expect(due2[own]).toBe('2030-10-05T05:00:00.000Z');
      expect(due2[noHistory]).toBe('2030-10-05T07:00:00.000Z');
      expect(due2[machineOnly]).toBe('2030-10-05T07:00:00.000Z');
      await as(ownerToken, ZEN).post(`/studios/${ZEN}/campaigns/${second.body.id}/cancel`);
    });

    it('BEST_TIME without a campaign time uses the tenant default send time from the messaging settings', async () => {
      const tokyo = await makeContact(ZEN, 'bt-default', { timezone: 'Asia/Tokyo' });
      const segmentId = await staticSegment(ZEN, ownerToken, 'varsayilan saat', [tokyo]);
      await prisma.studio.update({ where: { id: ZEN }, data: { messagingSettings: { frequencyCap: { perDay: 50, perWeek: 200 }, defaultSendTimeLocal: '18:00' } } });
      const created = await newCampaign(ZEN, ownerToken, 'varsayilan saat', segmentId, { sendTimeMode: 'BEST_TIME' });
      const id = created.body.id as string;
      await startAt(id, new Date('2031-03-01T00:00:00.000Z'));
      // No history at all in 2031: the tenant's default 18:00 Tokyo = 09:00Z.
      expect((await dueOf(id))[tokyo]).toBe('2031-03-01T09:00:00.000Z');
      await as(ownerToken, ZEN).post(`/studios/${ZEN}/campaigns/${id}/cancel`);
      await prisma.studio.update({ where: { id: ZEN }, data: { messagingSettings: { frequencyCap: { perDay: 50, perWeek: 200 } } } });
    });

    it('A/B and recipient-local time work together: the test share is scheduled per recipient, the winner\'s remainder too', async () => {
      const ids: string[] = [];
      for (let i = 0; i < 6; i += 1) ids.push(await makeContact(ZEN, `both${i}`, { timezone: 'Asia/Tokyo' }));
      const segmentId = await staticSegment(ZEN, ownerToken, 'ab ve saat', ids);
      const created = await newCampaign(ZEN, ownerToken, 'ab ve saat', segmentId, {
        abTest: { testShare: 50, metric: 'CLICK_RATE', waitMinutes: 60 },
        variants: variantsAB,
        sendTimeMode: 'RECIPIENT_LOCAL',
        sendTimeLocal: '10:00',
      });
      const id = created.body.id as string;
      await startAt(id, T0);
      let recipients = await recipientsOf(id);
      expect(recipients.filter((r) => r.variantKey !== null)).toHaveLength(3);
      expect(recipients.filter((r) => r.variantKey !== null).every((r) => r.nextAttemptAt?.toISOString() === '2030-10-05T01:00:00.000Z')).toBe(true);
      // Held back: no variant and no due time until the winner.
      expect(recipients.filter((r) => r.variantKey === null).every((r) => r.nextAttemptAt === null)).toBe(true);

      const picked = await as(ownerToken, ZEN).post(`/studios/${ZEN}/campaigns/${id}/pick-winner`).send({ variantKey: 'A' });
      expect(picked.status).toBe(201);
      recipients = await recipientsOf(id);
      expect(recipients.every((r) => r.variantKey !== null)).toBe(true);
      // The rest is scheduled from the moment the winner is chosen (the wall clock here), never in the past and never in quiet hours.
      const released = recipients.filter((r) => r.nextAttemptAt?.toISOString() !== '2030-10-05T01:00:00.000Z');
      expect(released).toHaveLength(3);
      expect(released.every((r) => r.nextAttemptAt !== null && r.nextAttemptAt.getTime() >= startedAt.getTime())).toBe(true);
      await as(ownerToken, ZEN).post(`/studios/${ZEN}/campaigns/${id}/cancel`);
    });
  });

  // ---------------------------------------------------------------------------

  describe('platform tenant: the approval gate stays and covers the variants', () => {
    it('cannot be scheduled directly; an approval is bound to the A/B setup, variants and send time', async () => {
      const members: string[] = [];
      for (let i = 0; i < 4; i += 1) members.push(await makeContact(PLATFORM, `p${i}`));
      const segmentId = await staticSegment(PLATFORM, superAdminToken, 'platform', members);
      const created = await newCampaign(PLATFORM, superAdminToken, 'platform', segmentId, { abTest: { testShare: 50, metric: 'CLICK_RATE', waitMinutes: 60 }, variants: variantsAB });
      expect(created.status).toBe(201);
      const id = created.body.id as string;

      const direct = await as(superAdminToken, PLATFORM).post(`/studios/${PLATFORM}/campaigns/${id}/schedule`).send({});
      expect(direct.status).toBe(409);
      expect(direct.body.code).toBe('CAMPAIGN_APPROVAL_REQUIRED');

      const requested = await platformAs(superAdminToken).post(`/platform/marketing/campaigns/${id}/request-approval`).send({});
      expect(requested.status).toBe(200);
      const requestId = requested.body.request.id as string;
      if (requested.body.request.status === 'PENDING') {
        const approved = await platformAs(superAdminToken).post(`/platform/marketing/approvals/${requestId}/approve`).send({ note: 'M3c e2e' });
        expect(approved.status).toBe(200);
      }
      expect((await campaignRow(id)).status).toBe('SCHEDULED');

      // A change to a variant's text after the approval returns the campaign to the approval queue.
      const edited = await as(superAdminToken, PLATFORM)
        .patch(`/studios/${PLATFORM}/campaigns/${id}`)
        .send({ variants: [variantsAB[0], { key: 'B', overrides: { body: 'B-metni degisti {firstName}. Cikis icin RET yazin.' } }] });
      expect(edited.status).toBe(200);
      expect(edited.body.status).toBe('PENDING_APPROVAL');
      expect(edited.body.approvalRequestId).not.toBe(requestId);
      const old = await prisma.approvalRequest.findUniqueOrThrow({ where: { id: requestId } });
      expect(old.status).toBe('CANCELLED');
      expect(old.summary).toMatchObject({ invalidated: { reason: 'CONTENT_CHANGED' } });
      expect((await runScheduler(new Date(Date.now() + MINUTE))).status).toBe(201);
      expect(await logsOf(id)).toHaveLength(0);

      // The same holds for the A/B setup and the send time mode.
      const second = await as(superAdminToken, PLATFORM).patch(`/studios/${PLATFORM}/campaigns/${id}`).send({ abTest: { testShare: 30, metric: 'CLICK_RATE', waitMinutes: 60 } });
      expect(second.status).toBe(200);
      expect(second.body.status).toBe('PENDING_APPROVAL');
      const pending = await prisma.approvalRequest.findMany({ where: { targetId: id, status: 'PENDING' } });
      expect(pending).toHaveLength(1);

      // Approved, the platform campaign runs the test like any other.
      const approvedAgain = await platformAs(superAdminToken).post(`/platform/marketing/approvals/${pending[0].id}/approve`).send({ note: 'M3c e2e' });
      expect(approvedAgain.status).toBe(200);
      const t0 = new Date(Date.now() + MINUTE);
      expect((await runScheduler(t0)).status).toBe(201);
      const recipients = await recipientsOf(id);
      expect(recipients).toHaveLength(4);
      expect(recipients.filter((r) => r.variantKey !== null && r.status === 'SENT').length).toBe(2);
      expect(recipients.filter((r) => r.variantKey === null && r.status === 'PENDING')).toHaveLength(2);
    });
  });
});
