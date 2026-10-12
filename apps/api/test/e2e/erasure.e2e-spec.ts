import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import * as bcrypt from 'bcrypt';
import { PrismaClient } from '@platform/database';
import { ERASED_PHONE_PREFIX } from '@platform/shared';
import { AppModule } from '../../src/app.module';
import { JobsService } from '../../src/modules/jobs/jobs.service';

/**
 * KVKK/GDPR erasure end to end (docs/KVKK_SILME.md): member request -> staff
 * approval -> heartbeat execution, rejection, the 30 day automatic
 * processing, the direct start from the member card, permission denial,
 * and the per-studio scope (a person who also belongs to another studio keeps
 * that membership untouched).
 *
 * Rows use the +90539555 phone prefix and the name "E2E silme"; anonymized
 * users lose the prefix, so afterAll deletes by the tracked ids.
 */

const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Demo1234!';
const OWNER_PHONE = '+905321000002';
const RECEPTION_PHONE = '+905321000003';
const TRAINER_PHONE = '+905321000004';
const PREFIX = '+90539555';
const NAME = 'E2E silme';
const DAY = 24 * 60 * 60 * 1000;

describe('KVKK erasure (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let server: Parameters<typeof request>[0];
  let jobs: JobsService;

  let ZEN: string;
  let FLOW: string;
  let ownerToken: string;
  let receptionToken: string;
  let trainerToken: string;
  let serviceTypeId: string;
  let documentVersionId: string;
  let memberRoleZen: string;
  let memberRoleFlow: string;

  const userIds: string[] = [];
  const membershipIds: string[] = [];
  const paymentIds: string[] = [];
  const contactIds: string[] = [];
  const scheduleIds: string[] = [];
  const logIds: string[] = [];
  let formTemplateId: string;
  let phoneSeq = 0;

  const login = async (phone: string) => {
    const res = await request(server).post('/auth/login').send({ emailOrPhone: phone, password: DEMO_PASSWORD });
    expect(res.status).toBe(200);
    return res.body.accessToken as string;
  };
  const as = (token: string, studioId: string) => ({
    get: (url: string) => request(server).get(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId),
    post: (url: string) => request(server).post(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId),
  });

  interface Fixture {
    userId: string;
    phone: string;
    membershipId: string;
    profileId: string;
    contactId: string;
    paymentId: string;
    bookingId: string;
    logId: string;
    token: string;
  }

  /** A fully populated member of ZEN: profile, health, measurement, payment with invoice, CRM, messaging and community rows. */
  async function addMember(passwordHash: string, label: string): Promise<Fixture> {
    const phone = `${PREFIX}${String(++phoneSeq).padStart(4, '0')}`;
    const user = await prisma.user.create({
      data: { phone, email: `silme${phoneSeq}@example.test`, firstName: NAME, lastName: label, passwordHash, phoneVerifiedAt: new Date() },
    });
    userIds.push(user.id);
    const membership = await prisma.membership.create({ data: { userId: user.id, studioId: ZEN, roleTemplateId: memberRoleZen, status: 'ACTIVE', joinedAt: new Date() } });
    membershipIds.push(membership.id);
    const profile = await prisma.memberProfile.create({
      data: {
        membershipId: membership.id,
        studioId: ZEN,
        birthDate: new Date('1990-05-05'),
        emergencyContactName: 'Yakin Kisi',
        emergencyContactPhone: '+905550001111',
        medicalConditions: 'diz sorunu',
        notes: 'ozel not',
      },
    });
    await prisma.measurementEntry.create({ data: { studioId: ZEN, memberId: profile.id, formTemplateId, values: { kilo: 70 }, recordedByUserId: user.id } });
    await prisma.healthDailySummary.create({ data: { studioId: ZEN, memberId: profile.id, date: new Date('2026-10-01'), steps: 1000 } });
    const payment = await prisma.payment.create({
      data: { studioId: ZEN, memberId: profile.id, amount: 100, currency: 'EUR', paymentMethod: 'CASH', paymentStatus: 'COMPLETED', notes: 'ad soyad ile odeme' },
    });
    paymentIds.push(payment.id);
    await prisma.invoice.create({
      data: {
        studioId: ZEN,
        paymentId: payment.id,
        number: `E2ESILME-${phoneSeq}-${Date.now()}`,
        issueDate: new Date(),
        buyerSnapshot: { kind: 'INDIVIDUAL', fullName: `${NAME} ${label}`, tckn: '12345678901', email: 'x@example.test' },
        lines: [],
        subtotal: 100,
        vatAmount: 0,
        total: 100,
        currency: 'EUR',
        status: 'ISSUED',
        provider: 'MOCK',
      },
    });
    const schedule = await prisma.sessionSchedule.create({
      data: { studioId: ZEN, serviceTypeId, title: `${NAME} seans`, startTime: new Date(Date.now() - 2 * DAY), endTime: new Date(Date.now() - 2 * DAY + 3_600_000), capacity: 5, bookedCount: 1 },
    });
    scheduleIds.push(schedule.id);
    const booking = await prisma.booking.create({
      data: { studioId: ZEN, scheduleId: schedule.id, memberId: profile.id, status: 'ATTENDED', cancellationReason: 'kisisel neden' },
    });
    const contact = await prisma.contact.create({
      data: { studioId: ZEN, firstName: NAME, lastName: label, phone, email: `silme${phoneSeq}@example.test`, membershipId: membership.id, notes: 'crm notu' },
    });
    contactIds.push(contact.id);
    const conversation = await prisma.conversation.create({ data: { studioId: ZEN, contactId: contact.id, channel: 'SMS', externalAddress: phone } });
    await prisma.conversationMessage.create({ data: { studioId: ZEN, conversationId: conversation.id, direction: 'IN', body: 'merhaba ben ' + label } });
    const log = await prisma.notificationLog.create({
      data: { studioId: ZEN, userId: user.id, contactId: contact.id, recipientPhone: phone, recipientEmail: `silme${phoneSeq}@example.test`, channel: 'SMS', type: 'BOOKING_REMINDER', content: `Merhaba ${label}`, status: 'SENT' },
    });
    logIds.push(log.id);
    await prisma.pushDevice.create({ data: { userId: user.id, token: `ExponentPushToken[e2e-silme-${phoneSeq}-${Date.now()}]`, platform: 'ios' } });
    await prisma.consent.create({ data: { membershipId: membership.id, documentVersionId, device: 'iPhone', ip: '10.0.0.9' } });
    await prisma.communicationConsent.create({ data: { studioId: ZEN, userId: user.id, channel: 'SMS', status: 'GRANTED', source: 'e2e', grantedAt: new Date(), iysSyncedAt: new Date() } });
    await prisma.sessionRating.create({
      data: { studioId: ZEN, bookingId: booking.id, memberId: profile.id, trainerProfileId: (await anyTrainerProfile()).id, serviceTypeId, score: 5, comment: 'harika hoca' },
    });
    const post = await prisma.communityPost.create({ data: { studioId: ZEN, type: 'POST', status: 'PUBLISHED', title: `${NAME} gonderi`, publishedAt: new Date() } });
    await prisma.communityComment.create({ data: { studioId: ZEN, postId: post.id, authorMembershipId: membership.id, body: 'yorumum' } });
    return { userId: user.id, phone, membershipId: membership.id, profileId: profile.id, contactId: contact.id, paymentId: payment.id, bookingId: booking.id, logId: log.id, token: await login(phone) };
  }

  async function anyTrainerProfile() {
    return prisma.trainerProfile.findFirstOrThrow({ where: { studioId: ZEN } });
  }

  async function cleanup() {
    await prisma.communityPost.deleteMany({ where: { studioId: { in: [ZEN, FLOW] }, title: { startsWith: NAME } } });
    await prisma.auditLog.deleteMany({ where: { studioId: { in: [ZEN, FLOW] }, action: { startsWith: 'erasure.' } } });
    await prisma.dataErasureRequest.deleteMany({ where: { membershipId: { in: membershipIds } } });
    await prisma.notificationLog.deleteMany({ where: { OR: [{ id: { in: logIds } }, { studioId: ZEN, type: { startsWith: 'ERASURE_REQUEST_' } }] } });
    await prisma.invoice.deleteMany({ where: { paymentId: { in: paymentIds } } });
    await prisma.payment.deleteMany({ where: { id: { in: paymentIds } } });
    await prisma.contact.deleteMany({ where: { id: { in: contactIds } } });
    await prisma.sessionSchedule.deleteMany({ where: { id: { in: scheduleIds } } });
    // Memberships split onto an anonymous user keep their id: delete that user too.
    const split = await prisma.membership.findMany({ where: { id: { in: membershipIds } }, select: { userId: true } });
    const holders = [...new Set([...userIds, ...split.map((m) => m.userId)])];
    await prisma.membership.deleteMany({ where: { id: { in: membershipIds } } });
    await prisma.measurementFormTemplate.deleteMany({ where: { studioId: ZEN, name: NAME } });
    await prisma.user.deleteMany({ where: { id: { in: holders } } });
  }

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer();
    prisma = new PrismaClient();
    jobs = app.get(JobsService);

    ZEN = (await prisma.studio.findUniqueOrThrow({ where: { slug: 'zen-reformer-pilates' } })).id;
    FLOW = (await prisma.studio.findUniqueOrThrow({ where: { slug: 'flow-pilates-wellness' } })).id;
    await prisma.notificationLog.deleteMany({ where: { studioId: ZEN, recipientPhone: { startsWith: PREFIX } } });
    await prisma.user.deleteMany({ where: { phone: { startsWith: PREFIX } } });
    serviceTypeId = (await prisma.serviceType.findFirstOrThrow({ where: { studioId: ZEN } })).id;
    documentVersionId = (await prisma.documentVersion.findFirstOrThrow({})).id;
    memberRoleZen = (await prisma.roleTemplate.findUniqueOrThrow({ where: { studioId_key: { studioId: ZEN, key: 'member' } } })).id;
    memberRoleFlow = (await prisma.roleTemplate.findUniqueOrThrow({ where: { studioId_key: { studioId: FLOW, key: 'member' } } })).id;
    formTemplateId = (await prisma.measurementFormTemplate.create({ data: { studioId: ZEN, name: NAME, fields: [] } })).id;
    [ownerToken, receptionToken, trainerToken] = await Promise.all([login(OWNER_PHONE), login(RECEPTION_PHONE), login(TRAINER_PHONE)]);
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
    await app.close();
  });

  it('request -> approve -> heartbeat anonymizes the data, keeps the financial rows and closes the login', async () => {
    const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 4);
    const m = await addMember(passwordHash, 'Akis');

    // The member asks; a second request is refused.
    const asked = await as(m.token, ZEN).post('/me/erasure').send({});
    expect(asked.status).toBe(201);
    expect(asked.body).toEqual(expect.objectContaining({ status: 'PENDING', source: 'MEMBER' }));
    expect((await as(m.token, ZEN).post('/me/erasure').send({})).status).toBe(409);
    const own = await as(m.token, ZEN).get('/me/erasure');
    expect(own.body.request).toEqual(expect.objectContaining({ id: asked.body.id, status: 'PENDING' }));

    // Staff without members.erase cannot see or decide; the member cannot use the staff routes either.
    expect((await as(receptionToken, ZEN).get(`/studios/${ZEN}/erasure-requests`)).status).toBe(403);
    expect((await as(receptionToken, ZEN).post(`/studios/${ZEN}/erasure-requests/${asked.body.id}/approve`).send({})).status).toBe(403);
    expect((await as(trainerToken, ZEN).post(`/studios/${ZEN}/erasure-requests/${asked.body.id}/reject`).send({})).status).toBe(403);
    expect((await as(receptionToken, ZEN).post(`/studios/${ZEN}/members/${m.profileId}/erasure`).send({})).status).toBe(403);
    expect((await as(m.token, ZEN).get(`/studios/${ZEN}/erasure-requests`)).status).toBe(403);

    // The owner sees it and approves; nothing is erased until the heartbeat runs.
    const listed = await as(ownerToken, ZEN).get(`/studios/${ZEN}/erasure-requests`);
    expect(listed.status).toBe(200);
    expect((listed.body as { id: string }[]).map((r) => r.id)).toContain(asked.body.id);
    const approved = await as(ownerToken, ZEN).post(`/studios/${ZEN}/erasure-requests/${asked.body.id}/approve`).send({});
    expect(approved.status).toBe(201);
    expect(approved.body.status).toBe('APPROVED');
    // The decision reaches the member through the messaging engine (a log row per channel attempt).
    expect(await prisma.notificationLog.count({ where: { studioId: ZEN, userId: m.userId, type: 'ERASURE_REQUEST_APPROVED' } })).toBeGreaterThanOrEqual(1);
    expect((await as(ownerToken, ZEN).post(`/studios/${ZEN}/erasure-requests/${asked.body.id}/approve`).send({})).status).toBe(409);
    expect((await prisma.membership.findUniqueOrThrow({ where: { id: m.membershipId } })).erasedAt).toBeNull();

    const run = await jobs.runAll(new Date());
    expect(run.erasure.executed).toBeGreaterThanOrEqual(1);

    const stored = await prisma.dataErasureRequest.findUniqueOrThrow({ where: { id: asked.body.id } });
    expect(stored.status).toBe('COMPLETED');
    expect(stored.executedAt).not.toBeNull();
    expect(stored.autoProcessed).toBe(false);

    // Membership: terminal PASSIVE state, marked erased.
    const membership = await prisma.membership.findUniqueOrThrow({ where: { id: m.membershipId }, include: { user: true } });
    expect(membership.status).toBe('PASSIVE');
    expect(membership.erasedAt).not.toBeNull();
    // No other membership: the global user is anonymized and cannot log in.
    expect(membership.user.phone.startsWith(ERASED_PHONE_PREFIX)).toBe(true);
    expect(membership.user.email).toBeNull();
    expect(membership.user.isActive).toBe(false);
    expect(membership.user.pinHash).toBeNull();
    expect(membership.user.passwordHash).toBeNull();
    expect((await request(server).post('/auth/login').send({ emailOrPhone: m.phone, password: DEMO_PASSWORD })).status).toBe(401);
    expect((await as(m.token, ZEN).get('/me/erasure')).status).toBe(401);

    // Personal data is gone.
    const profile = await prisma.memberProfile.findUniqueOrThrow({ where: { id: m.profileId } });
    expect([profile.birthDate, profile.emergencyContactName, profile.emergencyContactPhone, profile.medicalConditions, profile.notes]).toEqual([null, null, null, null, null]);
    expect(await prisma.measurementEntry.count({ where: { memberId: m.profileId } })).toBe(0);
    expect(await prisma.healthDailySummary.count({ where: { memberId: m.profileId } })).toBe(0);
    expect(await prisma.pushDevice.count({ where: { userId: m.userId } })).toBe(0);
    expect(await prisma.conversation.count({ where: { contactId: m.contactId } })).toBe(0);
    const contact = await prisma.contact.findUniqueOrThrow({ where: { id: m.contactId } });
    expect([contact.phone, contact.email, contact.notes]).toEqual([null, null, null]);
    const log = await prisma.notificationLog.findFirstOrThrow({ where: { id: m.logId } });
    expect([log.recipientPhone, log.recipientEmail, log.userId, log.content]).toEqual([null, null, null, '']);
    const consent = await prisma.consent.findFirstOrThrow({ where: { membershipId: m.membershipId } });
    expect([consent.ip, consent.device]).toEqual([null, null]);
    expect((await prisma.communicationConsent.findFirstOrThrow({ where: { studioId: ZEN, userId: m.userId } })).status).toBe('REVOKED');
    const comment = await prisma.communityComment.findFirstOrThrow({ where: { studioId: ZEN, body: 'yorumum', post: { title: { startsWith: NAME } } } });
    expect(comment.authorMembershipId).toBeNull();
    expect((await prisma.sessionRating.findUniqueOrThrow({ where: { bookingId: m.bookingId } })).comment).toBeNull();

    // Financial and booking rows stay, but no longer identify the person.
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: m.paymentId }, include: { invoice: true } });
    expect(Number(payment.amount)).toBe(100);
    expect(payment.currency).toBe('EUR');
    expect(payment.notes).toBeNull();
    expect(payment.invoice?.buyerSnapshot).toEqual(expect.objectContaining({ tckn: '12345678901' }));
    const booking = await prisma.booking.findUniqueOrThrow({ where: { id: m.bookingId } });
    expect(booking.status).toBe('ATTENDED');
    expect(booking.cancellationReason).toBeNull();

    // Audit trail of the whole flow.
    const actions = (await prisma.auditLog.findMany({ where: { studioId: ZEN, action: { startsWith: 'erasure.' }, entityId: { in: [asked.body.id, m.membershipId] } } })).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['erasure.requested', 'erasure.approved', 'erasure.executed']));

    // The erased member no longer appears in the member list; the card shows the erasure.
    const list = await as(ownerToken, ZEN).get(`/members/studio/${ZEN}`);
    expect((list.body as { id: string }[]).map((r) => r.id)).not.toContain(m.profileId);
    const card = await as(ownerToken, ZEN).get(`/members/${m.profileId}/studio/${ZEN}`);
    expect(card.body.erasedAt).not.toBeNull();
    expect(card.body.firstName).toBe('***');
  });

  it('rejecting a request keeps the data and lets the member ask again', async () => {
    const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 4);
    const m = await addMember(passwordHash, 'Red');
    const asked = await as(m.token, ZEN).post('/me/erasure').send({});
    expect(asked.status).toBe(201);
    const rejected = await as(ownerToken, ZEN).post(`/studios/${ZEN}/erasure-requests/${asked.body.id}/reject`).send({ note: 'yasal saklama' });
    expect(rejected.status).toBe(201);
    expect(rejected.body).toEqual(expect.objectContaining({ status: 'REJECTED', decisionNote: 'yasal saklama' }));
    expect((await as(ownerToken, ZEN).post(`/studios/${ZEN}/erasure-requests/${asked.body.id}/approve`).send({})).status).toBe(409);

    await jobs.runAll(new Date());
    expect((await prisma.membership.findUniqueOrThrow({ where: { id: m.membershipId } })).erasedAt).toBeNull();
    expect((await prisma.memberProfile.findUniqueOrThrow({ where: { id: m.profileId } })).notes).toBe('ozel not');
    expect((await as(m.token, ZEN).get('/me/erasure')).body.request.status).toBe('REJECTED');

    const again = await as(m.token, ZEN).post('/me/erasure').send({});
    expect(again.status).toBe(201);
    expect(again.body.status).toBe('PENDING');
  });

  it('a request nobody handled within 30 days is processed automatically', async () => {
    const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 4);
    const m = await addMember(passwordHash, 'Otomatik');
    const asked = await as(m.token, ZEN).post('/me/erasure').send({});
    expect(asked.status).toBe(201);
    expect(new Date(asked.body.dueAt).getTime() - new Date(asked.body.requestedAt).getTime()).toBe(30 * DAY);

    // Not due yet: the heartbeat leaves it alone.
    await jobs.runAll(new Date());
    expect((await prisma.dataErasureRequest.findUniqueOrThrow({ where: { id: asked.body.id } })).status).toBe('PENDING');

    await prisma.dataErasureRequest.update({ where: { id: asked.body.id }, data: { dueAt: new Date(Date.now() - 1000) } });
    const run = await jobs.runAll(new Date());
    expect(run.erasure.autoProcessed).toBeGreaterThanOrEqual(1);
    const stored = await prisma.dataErasureRequest.findUniqueOrThrow({ where: { id: asked.body.id } });
    expect(stored.status).toBe('COMPLETED');
    expect(stored.autoProcessed).toBe(true);
    expect((await prisma.membership.findUniqueOrThrow({ where: { id: m.membershipId } })).erasedAt).not.toBeNull();
  });

  it('starting from the member card erases only this studio: the other membership and the real account stay', async () => {
    const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 4);
    const m = await addMember(passwordHash, 'Iki studyo');
    const flowMembership = await prisma.membership.create({ data: { userId: m.userId, studioId: FLOW, roleTemplateId: memberRoleFlow, status: 'ACTIVE', joinedAt: new Date() } });
    membershipIds.push(flowMembership.id);
    const flowProfile = await prisma.memberProfile.create({ data: { membershipId: flowMembership.id, studioId: FLOW, notes: 'flow notu' } });

    const started = await as(ownerToken, ZEN).post(`/studios/${ZEN}/members/${m.profileId}/erasure`).send({});
    expect(started.status).toBe(201);
    expect(started.body).toEqual(expect.objectContaining({ status: 'COMPLETED', source: 'STUDIO' }));
    expect((await as(ownerToken, ZEN).post(`/studios/${ZEN}/members/${m.profileId}/erasure`).send({})).status).toBe(409);

    // ZEN: erased and moved onto an anonymous identity.
    const zen = await prisma.membership.findUniqueOrThrow({ where: { id: m.membershipId }, include: { user: true } });
    expect(zen.erasedAt).not.toBeNull();
    expect(zen.userId).not.toBe(m.userId);
    expect(zen.user.phone.startsWith(ERASED_PHONE_PREFIX)).toBe(true);
    expect(zen.user.firstName).toBe('***');
    expect(zen.user.isActive).toBe(false);

    // The real user and the FLOW membership are untouched.
    const real = await prisma.user.findUniqueOrThrow({ where: { id: m.userId } });
    expect(real.phone).toBe(m.phone);
    expect(real.firstName).toBe(NAME);
    expect(real.isActive).toBe(true);
    expect(real.passwordHash).not.toBeNull();
    const flow = await prisma.membership.findUniqueOrThrow({ where: { id: flowMembership.id } });
    expect(flow.erasedAt).toBeNull();
    expect(flow.status).toBe('ACTIVE');
    expect(flow.userId).toBe(m.userId);
    expect((await prisma.memberProfile.findUniqueOrThrow({ where: { id: flowProfile.id } })).notes).toBe('flow notu');
    expect(await prisma.pushDevice.count({ where: { userId: m.userId } })).toBe(1);
    expect((await request(server).post('/auth/login').send({ emailOrPhone: m.phone, password: DEMO_PASSWORD })).status).toBe(200);
    // The old ZEN session of the real user can no longer enter ZEN.
    expect((await as(m.token, ZEN).get('/me/erasure')).status).toBe(403);
  });

  it('refuses to erase staff and unknown members', async () => {
    const owner = await prisma.membership.findFirstOrThrow({ where: { studioId: ZEN, roleTemplate: { isOwner: true } }, include: { memberProfile: true } });
    // Owners normally have no member profile: the card route answers 404.
    const unknown = await as(ownerToken, ZEN).post(`/studios/${ZEN}/members/00000000-0000-4000-8000-000000000000/erasure`).send({});
    expect(unknown.status).toBe(404);
    if (owner.memberProfile) {
      const res = await as(ownerToken, ZEN).post(`/studios/${ZEN}/members/${owner.memberProfile.id}/erasure`).send({});
      expect(res.status).toBe(400);
    }
  });
});

