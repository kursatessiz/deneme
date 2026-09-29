import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { PrismaClient } from '@platform/database';
import { AppModule } from '../../src/app.module';
import { EventsJobsService } from '../../src/modules/events/events-jobs.service';

/**
 * G3c-1 events end to end (docs/ETKINLIKLER.md): permissions, tenant
 * isolation, no oversell under concurrent registrations, waitlist
 * promotion on cancellation, member self-service with the online (MOCK)
 * checkout, refund policy window, the public listing (PUBLIC + PUBLISHED
 * only) with guest registration into the CRM, event cancellation notices
 * and amounts stored with the studio currency.
 *
 * Every person uses the +90539777 prefix and every event title starts
 * with "E2E G3C1"; both are removed in beforeAll and afterAll, so the
 * suite passes twice in a row on the same database.
 */

const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Demo1234!';
const PREFIX = '+90539777';
const TITLE = 'E2E G3C1';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function phone(n: number): string {
  return `${PREFIX}${String(n).padStart(4, '0')}`;
}

interface TestMember {
  userId: string;
  membershipId: string;
  memberId: string;
  phone: string;
  token: string;
}

describe('Events G3c-1 (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let server: Parameters<typeof request>[0];

  let ZEN: string;
  let ZEN_SLUG: string;
  let FLOW: string;
  let currency: string;
  let serviceTypeId: string;
  let packageDefId: string;

  let ownerToken: string;
  let receptionToken: string;
  let trainerToken: string;
  let flowOwnerToken: string;

  let seq = 0;
  const members: TestMember[] = [];

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
  const base = (studioId = ZEN) => `/studios/${studioId}/events`;

  async function cleanup() {
    const users = await prisma.user.findMany({ where: { phone: { startsWith: PREFIX } }, select: { id: true } });
    const userIds = users.map((u) => u.id);
    const profiles = await prisma.memberProfile.findMany({ where: { membership: { userId: { in: userIds } } }, select: { id: true } });
    const profileIds = profiles.map((p) => p.id);
    const contacts = await prisma.contact.findMany({ where: { phone: { startsWith: PREFIX } }, select: { id: true } });
    const contactIds = contacts.map((c) => c.id);
    await prisma.event.deleteMany({ where: { title: { startsWith: TITLE } } });
    await prisma.notificationLog.deleteMany({
      where: { OR: [{ contactId: { in: contactIds } }, { userId: { in: userIds } }, { recipientPhone: { startsWith: PREFIX } }] },
    });
    await prisma.conversionEvent.deleteMany({ where: { contactId: { in: contactIds } } });
    await prisma.contact.deleteMany({ where: { id: { in: contactIds } } });
    await prisma.payment.deleteMany({ where: { memberId: { in: profileIds } } });
    await prisma.memberPackage.deleteMany({ where: { memberId: { in: profileIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }

  async function makeMember(): Promise<TestMember> {
    seq += 1;
    const role = await prisma.roleTemplate.findFirstOrThrow({ where: { studioId: ZEN, key: 'member' } });
    const template = await prisma.user.findFirstOrThrow({ where: { phone: '+905321000016' }, select: { passwordHash: true } });
    const user = await prisma.user.create({
      data: { phone: phone(seq), firstName: `G3c${seq}`, lastName: 'E2E', passwordHash: template.passwordHash, phoneVerifiedAt: new Date() },
    });
    const membership = await prisma.membership.create({
      data: { userId: user.id, studioId: ZEN, roleTemplateId: role.id, status: 'ACTIVE', joinedAt: new Date() },
    });
    const profile = await prisma.memberProfile.create({ data: { membershipId: membership.id, studioId: ZEN } });
    const member = { userId: user.id, membershipId: membership.id, memberId: profile.id, phone: phone(seq), token: await login(phone(seq)) };
    members.push(member);
    return member;
  }

  interface EventOpts {
    capacity: number;
    waitlist?: boolean;
    price?: number;
    visibility?: 'PUBLIC' | 'MEMBERS_ONLY';
    startsInHours?: number;
    refundHours?: number;
    publish?: boolean;
    membersOnlyTicket?: boolean;
    credits?: boolean;
  }

  async function createEvent(name: string, opts: EventOpts): Promise<{ eventId: string; ticketId: string }> {
    const start = new Date(Date.now() + (opts.startsInHours ?? 5 * 24) * HOUR);
    const created = await as(ownerToken, ZEN)
      .post(base())
      .send({
        kind: 'SINGLE',
        title: `${TITLE} ${name}`,
        capacity: opts.capacity,
        waitlistEnabled: opts.waitlist ?? false,
        visibility: opts.visibility ?? 'MEMBERS_ONLY',
        fullRefundHoursBefore: opts.refundHours ?? 24,
        occurrences: [{ startsAt: start.toISOString(), endsAt: new Date(start.getTime() + 2 * HOUR).toISOString() }],
      });
    expect(created.status).toBe(201);
    const ticket = await as(ownerToken, ZEN)
      .post(`${base()}/${created.body.id}/tickets`)
      .send({
        name: 'Standart',
        priceAmount: opts.price ?? 0,
        currency,
        membersOnly: opts.membersOnlyTicket ?? false,
        ...(opts.credits ? { creditServiceTypeId: serviceTypeId, creditUnits: 2 } : {}),
      });
    expect(ticket.status).toBe(201);
    if (opts.publish !== false) {
      const published = await as(ownerToken, ZEN).post(`${base()}/${created.body.id}/publish`);
      expect(published.status).toBe(200);
      expect(published.body.status).toBe('PUBLISHED');
    }
    return { eventId: created.body.id as string, ticketId: ticket.body.id as string };
  }

  const selfRegister = (m: TestMember, eventId: string, body: Record<string, unknown>) => as(m.token, ZEN).post(`${base()}/self/${eventId}/register`).send(body);

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer();
    prisma = new PrismaClient();

    const zen = await prisma.studio.findUniqueOrThrow({ where: { slug: 'zen-reformer-pilates' } });
    ZEN = zen.id;
    ZEN_SLUG = zen.slug;
    currency = zen.currency;
    FLOW = (await prisma.studio.findUniqueOrThrow({ where: { slug: 'flow-pilates-wellness' } })).id;
    const pkgDef = await prisma.packageDefinition.findFirstOrThrow({
      where: { studioId: ZEN, entitlementKind: 'SESSION_COUNT', isTrial: false, services: { some: {} } },
      include: { services: true },
    });
    packageDefId = pkgDef.id;
    serviceTypeId = pkgDef.services[0].serviceTypeId;

    ownerToken = await login('+905321000002');
    receptionToken = await login('+905321000003');
    trainerToken = await login('+905321000004');
    flowOwnerToken = await login('+905321000022');
    await cleanup();
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
    await app.close();
  });

  // ---------------------------------------------------------------------------

  describe('permissions and editor', () => {
    it('reception may view but not manage; a trainer and a member see nothing', async () => {
      expect((await as(receptionToken, ZEN).get(base())).status).toBe(200);
      const denied = await as(receptionToken, ZEN).post(base()).send({ kind: 'SINGLE', title: `${TITLE} denied`, capacity: 5 });
      expect(denied.status).toBe(403);
      expect((await as(trainerToken, ZEN).get(base())).status).toBe(403);
      const member = await makeMember();
      expect((await as(member.token, ZEN).get(base())).status).toBe(403);
    });

    it('validates occurrences, currency and publishing', async () => {
      const start = new Date(Date.now() + 3 * DAY);
      const occ = { startsAt: start.toISOString(), endsAt: new Date(start.getTime() + HOUR).toISOString() };
      const two = await as(ownerToken, ZEN).post(base()).send({ kind: 'SINGLE', title: `${TITLE} two`, capacity: 5, occurrences: [occ, occ] });
      expect(two.status).toBe(400);

      const draft = await as(ownerToken, ZEN).post(base()).send({ kind: 'SERIES', title: `${TITLE} draft`, capacity: 5 });
      expect(draft.status).toBe(201);
      expect(draft.body).toMatchObject({ status: 'DRAFT', kind: 'SERIES', capacity: 5, seatsTaken: 0 });

      const incomplete = await as(ownerToken, ZEN).post(`${base()}/${draft.body.id}/publish`);
      expect(incomplete.status).toBe(400);
      expect(incomplete.body.code).toBe('EVENT_PUBLISH_INCOMPLETE');

      const other = currency === 'USD' ? 'EUR' : 'USD';
      const wrong = await as(ownerToken, ZEN).post(`${base()}/${draft.body.id}/tickets`).send({ name: 'X', priceAmount: 10, currency: other });
      expect(wrong.status).toBe(400);
      expect(wrong.body.code).toBe('EVENT_CURRENCY_MISMATCH');

      const occs = await as(ownerToken, ZEN)
        .put(`${base()}/${draft.body.id}/occurrences`)
        .send({ occurrences: [occ, { startsAt: new Date(start.getTime() + 7 * DAY).toISOString(), endsAt: new Date(start.getTime() + 7 * DAY + HOUR).toISOString() }] });
      expect(occs.status).toBe(200);
      expect(occs.body.occurrences).toHaveLength(2);
      expect(occs.body.startsAt).toBe(start.toISOString());

      const ticket = await as(ownerToken, ZEN).post(`${base()}/${draft.body.id}/tickets`).send({ name: 'Kurs', priceAmount: 150.5, currency });
      expect(ticket.status).toBe(201);
      expect(ticket.body).toMatchObject({ priceAmount: '150.50', currency, soldCount: 0, onSale: true });

      const published = await as(ownerToken, ZEN).post(`${base()}/${draft.body.id}/publish`);
      expect(published.status).toBe(200);
      expect(published.body.status).toBe('PUBLISHED');
    });
  });

  describe('tenant isolation', () => {
    it('another studio cannot read or change an event or its registrations', async () => {
      const { eventId, ticketId } = await createEvent('isolation', { capacity: 5 });
      const member = await makeMember();
      const reg = await selfRegister(member, eventId, { ticketTypeId: ticketId });
      expect(reg.status).toBe(201);

      expect((await as(flowOwnerToken, FLOW).get(`${base(FLOW)}/${eventId}`)).status).toBe(404);
      expect((await as(flowOwnerToken, FLOW).patch(`${base(FLOW)}/${eventId}`).send({ capacity: 1 })).status).toBe(404);
      expect((await as(flowOwnerToken, FLOW).post(`${base(FLOW)}/${eventId}/cancel`).send({})).status).toBe(404);
      expect((await as(flowOwnerToken, FLOW).get(`${base(FLOW)}/${eventId}/registrations`)).status).toBe(404);
      expect((await as(flowOwnerToken, FLOW).post(`${base(FLOW)}/registrations/${reg.body.registration.id}/check-in`)).status).toBe(404);
      // Not a member of Zen at all: the tenant guard refuses.
      expect((await as(flowOwnerToken, ZEN).get(`${base()}/${eventId}`)).status).toBe(403);
      const list = await as(flowOwnerToken, FLOW).get(base(FLOW));
      expect(list.status).toBe(200);
      expect(list.body.items.map((e: { id: string }) => e.id)).not.toContain(eventId);
      const unchanged = await prisma.event.findUniqueOrThrow({ where: { id: eventId } });
      expect(unchanged.capacity).toBe(5);
      expect(unchanged.status).toBe('PUBLISHED');
    });
  });

  describe('capacity', () => {
    it('never oversells under concurrent registrations', async () => {
      const { eventId, ticketId } = await createEvent('oversell', { capacity: 3 });
      const people: TestMember[] = [];
      for (let i = 0; i < 8; i++) people.push(await makeMember());
      const results = await Promise.all(people.map((m) => selfRegister(m, eventId, { ticketTypeId: ticketId })));
      const ok = results.filter((r) => r.status === 201);
      const full = results.filter((r) => r.status === 409);
      expect(ok).toHaveLength(3);
      expect(full).toHaveLength(5);
      for (const r of full) expect(r.body.code).toBe('EVENT_FULL');
      for (const r of ok) expect(r.body.registration.status).toBe('CONFIRMED');

      const event = await prisma.event.findUniqueOrThrow({ where: { id: eventId } });
      expect(event.seatsTaken).toBe(3);
      expect(await prisma.eventRegistration.count({ where: { eventId, status: 'CONFIRMED' } })).toBe(3);
      expect((await prisma.eventTicketType.findUniqueOrThrow({ where: { id: ticketId } })).soldCount).toBe(3);
    });

    it('queues the rest on the waitlist in order when it is enabled, and a repeated call is idempotent', async () => {
      const { eventId, ticketId } = await createEvent('queue', { capacity: 2, waitlist: true });
      const people: TestMember[] = [];
      for (let i = 0; i < 5; i++) people.push(await makeMember());
      const results = await Promise.all(people.map((m) => selfRegister(m, eventId, { ticketTypeId: ticketId })));
      expect(results.every((r) => r.status === 201)).toBe(true);
      const statuses = results.map((r) => r.body.registration.status);
      expect(statuses.filter((s) => s === 'CONFIRMED')).toHaveLength(2);
      expect(statuses.filter((s) => s === 'WAITLIST')).toHaveLength(3);
      const positions = results.filter((r) => r.body.registration.status === 'WAITLIST').map((r) => r.body.registration.waitlistPosition);
      expect(new Set(positions).size).toBe(3);
      expect((await prisma.event.findUniqueOrThrow({ where: { id: eventId } })).seatsTaken).toBe(2);

      const again = await selfRegister(people[0], eventId, { ticketTypeId: ticketId });
      expect(again.status).toBe(201);
      expect(again.body.duplicate).toBe(true);
      expect(again.body.registration.id).toBe(results[0].body.registration.id);
      expect(await prisma.eventRegistration.count({ where: { eventId, memberId: people[0].memberId } })).toBe(1);
    });
  });

  describe('waitlist promotion', () => {
    it('a cancellation promotes the head of the waitlist and tells them', async () => {
      const { eventId, ticketId } = await createEvent('promotion', { capacity: 1, waitlist: true });
      const [a, b, c] = [await makeMember(), await makeMember(), await makeMember()];
      const ra = await selfRegister(a, eventId, { ticketTypeId: ticketId });
      const rb = await selfRegister(b, eventId, { ticketTypeId: ticketId });
      const rc = await selfRegister(c, eventId, { ticketTypeId: ticketId });
      expect([ra.body.registration.status, rb.body.registration.status, rc.body.registration.status]).toEqual(['CONFIRMED', 'WAITLIST', 'WAITLIST']);

      const cancel = await as(a.token, ZEN).post(`${base()}/self/registrations/${ra.body.registration.id}/cancel`).send({});
      expect(cancel.status).toBe(200);
      expect(cancel.body.registration.status).toBe('CANCELLED');
      expect(cancel.body.promotedFromWaitlist).toBe(1);

      expect((await prisma.eventRegistration.findUniqueOrThrow({ where: { id: rb.body.registration.id } })).status).toBe('CONFIRMED');
      expect((await prisma.eventRegistration.findUniqueOrThrow({ where: { id: rc.body.registration.id } })).status).toBe('WAITLIST');
      expect((await prisma.event.findUniqueOrThrow({ where: { id: eventId } })).seatsTaken).toBe(1);
      expect(await prisma.notificationLog.count({ where: { studioId: ZEN, idempotencyKey: `event-promoted:${rb.body.registration.id}` } })).toBeGreaterThan(0);

      // The cancelled person may register again (dedupe key cleared) and joins the back of the line.
      const back = await selfRegister(a, eventId, { ticketTypeId: ticketId });
      expect(back.status).toBe(201);
      expect(back.body.duplicate).toBe(false);
      expect(back.body.registration.status).toBe('WAITLIST');
    });
  });

  describe('member self-service and payments', () => {
    it('lists published events only and pays online with the studio currency', async () => {
      const { eventId, ticketId } = await createEvent('paid', { capacity: 5, price: 250 });
      const { eventId: draftId } = await createEvent('hidden draft', { capacity: 5, publish: false });
      const member = await makeMember();

      const list = await as(member.token, ZEN).get(`${base()}/self`);
      expect(list.status).toBe(200);
      const ids = list.body.items.map((e: { id: string }) => e.id);
      expect(ids).toContain(eventId);
      expect(ids).not.toContain(draftId);
      expect((await as(member.token, ZEN).get(`${base()}/self/${draftId}`)).status).toBe(404);

      const reg = await selfRegister(member, eventId, { ticketTypeId: ticketId });
      expect(reg.status).toBe(201);
      expect(reg.body.registration).toMatchObject({ status: 'CONFIRMED', amountPaid: '250.00', currency, source: 'MEMBER' });
      const payment = await prisma.payment.findUniqueOrThrow({ where: { id: reg.body.registration.paymentId } });
      expect(payment.currency).toBe(currency);
      expect(payment.amount.toFixed(2)).toBe('250.00');
      expect(payment.paymentStatus).toBe('COMPLETED');
      expect(payment.memberId).toBe(member.memberId);

      const mine = await as(member.token, ZEN).get(`${base()}/self/registrations`);
      expect(mine.status).toBe(200);
      expect(mine.body.items[0]).toMatchObject({ eventId, eventStatus: 'PUBLISHED', status: 'CONFIRMED' });

      // Someone else cannot cancel it.
      const other = await makeMember();
      expect((await as(other.token, ZEN).post(`${base()}/self/registrations/${reg.body.registration.id}/cancel`).send({})).status).toBe(404);

      // Inside the refund window: full refund through the payments module.
      const cancel = await as(member.token, ZEN).post(`${base()}/self/registrations/${reg.body.registration.id}/cancel`).send({});
      expect(cancel.status).toBe(200);
      expect(cancel.body).toMatchObject({ refunded: true, refundedAmount: '250.00' });
      const refunded = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
      expect(refunded.paymentStatus).toBe('REFUNDED');
      expect(refunded.refundedAmount.toFixed(2)).toBe('250.00');
      expect((await prisma.event.findUniqueOrThrow({ where: { id: eventId } })).seatsTaken).toBe(0);
    });

    it('keeps the money after the refund deadline', async () => {
      const { eventId, ticketId } = await createEvent('late', { capacity: 5, price: 90, startsInHours: 10, refundHours: 48 });
      const member = await makeMember();
      const reg = await selfRegister(member, eventId, { ticketTypeId: ticketId });
      expect(reg.body.registration.status).toBe('CONFIRMED');
      const cancel = await as(member.token, ZEN).post(`${base()}/self/registrations/${reg.body.registration.id}/cancel`).send({});
      expect(cancel.status).toBe(200);
      expect(cancel.body).toMatchObject({ refunded: false, refundedAmount: '0.00' });
      const payment = await prisma.payment.findUniqueOrThrow({ where: { id: reg.body.registration.paymentId } });
      expect(payment.paymentStatus).toBe('COMPLETED');
      expect(payment.refundedAmount.toFixed(2)).toBe('0.00');
    });

    it('pays with package credits and returns them on an early cancel', async () => {
      const { eventId, ticketId } = await createEvent('credits', { capacity: 5, price: 100, credits: true, membersOnlyTicket: true });
      const member = await makeMember();
      const pkgDef = await prisma.packageDefinition.findUniqueOrThrow({ where: { id: packageDefId } });
      const pkg = await prisma.memberPackage.create({
        data: {
          studioId: ZEN,
          memberId: member.memberId,
          packageDefinitionId: pkgDef.id,
          entitlementKind: 'SESSION_COUNT',
          totalUnits: 5,
          remainingUnits: 5,
          endDate: new Date(Date.now() + 30 * DAY),
        },
      });
      const reg = await selfRegister(member, eventId, { ticketTypeId: ticketId, memberPackageId: pkg.id });
      expect(reg.status).toBe(201);
      expect(reg.body.registration).toMatchObject({ status: 'CONFIRMED', unitsCharged: 2, paymentId: null });
      expect((await prisma.memberPackage.findUniqueOrThrow({ where: { id: pkg.id } })).remainingUnits).toBe(3);

      const cancel = await as(member.token, ZEN).post(`${base()}/self/registrations/${reg.body.registration.id}/cancel`).send({});
      expect(cancel.body).toMatchObject({ refunded: true, refundedUnits: 2 });
      expect((await prisma.memberPackage.findUniqueOrThrow({ where: { id: pkg.id } })).remainingUnits).toBe(5);
    });
  });

  describe('staff registrations and check-in', () => {
    it('staff register at the desk, reception checks in, and the list exports as CSV', async () => {
      const { eventId, ticketId } = await createEvent('desk', { capacity: 5, price: 80 });
      const member = await makeMember();
      const reg = await as(ownerToken, ZEN).post(`${base()}/${eventId}/registrations`).send({ ticketTypeId: ticketId, memberId: member.memberId, paymentMethod: 'CASH' });
      expect(reg.status).toBe(201);
      expect(reg.body.registration).toMatchObject({ status: 'CONFIRMED', amountPaid: '80.00', currency, source: 'STAFF' });
      const payment = await prisma.payment.findUniqueOrThrow({ where: { id: reg.body.registration.paymentId } });
      expect(payment).toMatchObject({ paymentMethod: 'CASH', currency, paymentStatus: 'COMPLETED' });

      expect((await as(trainerToken, ZEN).post(`${base()}/registrations/${reg.body.registration.id}/check-in`)).status).toBe(403);
      const checkIn = await as(receptionToken, ZEN).post(`${base()}/registrations/${reg.body.registration.id}/check-in`);
      expect(checkIn.status).toBe(200);
      expect(checkIn.body.status).toBe('ATTENDED');
      expect(checkIn.body.checkedInAt).toBeTruthy();
      const again = await as(receptionToken, ZEN).post(`${base()}/registrations/${reg.body.registration.id}/check-in`);
      expect(again.status).toBe(200);
      expect(again.body.checkedInAt).toBe(checkIn.body.checkedInAt);

      const csv = await as(receptionToken, ZEN).get(`${base()}/${eventId}/registrations/export.csv?locale=en`);
      expect(csv.status).toBe(200);
      expect(csv.headers['content-type']).toContain('text/csv');
      expect(csv.text).toContain('Name;Phone;Ticket;Status');
      expect(csv.text).toContain('Attended');
      expect(csv.text).toContain(currency);
    });
  });

  describe('public pages', () => {
    it('lists only PUBLIC and PUBLISHED events and registers a guest into the CRM', async () => {
      const { eventId: publicId, ticketId } = await createEvent('public', { capacity: 5, visibility: 'PUBLIC' });
      const { eventId: membersId } = await createEvent('members', { capacity: 5, visibility: 'MEMBERS_ONLY' });
      const { eventId: draftId } = await createEvent('public draft', { capacity: 5, visibility: 'PUBLIC', publish: false });

      const list = await request(server).get(`/public/studios/${ZEN_SLUG}/events`);
      expect(list.status).toBe(200);
      const ids = list.body.items.map((e: { id: string }) => e.id);
      expect(ids).toContain(publicId);
      expect(ids).not.toContain(membersId);
      expect(ids).not.toContain(draftId);
      expect(list.body.items.find((e: { id: string }) => e.id === publicId)).not.toHaveProperty('seatsTaken');
      expect((await request(server).get(`/public/studios/${ZEN_SLUG}/events/${membersId}`)).status).toBe(404);
      expect((await request(server).get(`/public/studios/${ZEN_SLUG}/events/${draftId}`)).status).toBe(404);
      expect((await request(server).get(`/public/studios/no-such-studio-g3c1/events`)).status).toBe(404);

      seq += 1;
      const guestPhone = phone(seq);
      const reg = await request(server)
        .post(`/public/studios/${ZEN_SLUG}/events/${publicId}/registrations`)
        .send({ ticketTypeId: ticketId, firstName: 'Misafir', lastName: 'E2E', phone: guestPhone, consent: true });
      expect(reg.status).toBe(201);
      expect(reg.body).toMatchObject({ received: true, status: 'CONFIRMED' });
      const contact = await prisma.contact.findFirstOrThrow({ where: { studioId: ZEN, phone: guestPhone } });
      const registration = await prisma.eventRegistration.findFirstOrThrow({ where: { eventId: publicId, contactId: contact.id } });
      expect(registration).toMatchObject({ status: 'CONFIRMED', source: 'PUBLIC', memberId: null, currency });
      expect(await prisma.conversionEvent.count({ where: { contactId: contact.id, type: 'lead' } })).toBe(1);

      const twice = await request(server)
        .post(`/public/studios/${ZEN_SLUG}/events/${publicId}/registrations`)
        .send({ ticketTypeId: ticketId, firstName: 'Misafir', lastName: 'E2E', phone: guestPhone, consent: true });
      expect(twice.body).toMatchObject({ received: true, duplicate: true });
      expect(await prisma.eventRegistration.count({ where: { eventId: publicId, contactId: contact.id } })).toBe(1);
      expect(await prisma.conversionEvent.count({ where: { contactId: contact.id, type: 'lead' } })).toBe(1);
    });
  });

  describe('heartbeat', () => {
    it('releases an unpaid hold after its deadline and reminds confirmed registrants once', async () => {
      const jobs = app.get(EventsJobsService);
      const { eventId, ticketId } = await createEvent('heartbeat', { capacity: 3, price: 40, startsInHours: 12 });
      const [unpaid, paid] = [await makeMember(), await makeMember()];
      const hold = await as(ownerToken, ZEN).post(`${base()}/${eventId}/registrations`).send({ ticketTypeId: ticketId, memberId: unpaid.memberId });
      expect(hold.body.registration.status).toBe('PENDING_PAYMENT');
      expect(hold.body.registration.paymentDueAt).toBeTruthy();
      const confirmed = await as(ownerToken, ZEN).post(`${base()}/${eventId}/registrations`).send({ ticketTypeId: ticketId, memberId: paid.memberId, paymentMethod: 'CREDIT_CARD_POS' });
      expect(confirmed.body.registration.status).toBe('CONFIRMED');
      // Check-in refuses an unpaid seat.
      const refused = await as(receptionToken, ZEN).post(`${base()}/registrations/${hold.body.registration.id}/check-in`);
      expect(refused.status).toBe(409);
      expect(refused.body.code).toBe('EVENT_PAYMENT_PENDING');

      await prisma.eventRegistration.update({ where: { id: hold.body.registration.id }, data: { paymentDueAt: new Date(Date.now() - 60_000) } });
      const released = await jobs.releaseExpiredHolds(new Date());
      expect(released.released).toBeGreaterThanOrEqual(1);
      expect((await prisma.eventRegistration.findUniqueOrThrow({ where: { id: hold.body.registration.id } })).status).toBe('CANCELLED');
      expect((await prisma.event.findUniqueOrThrow({ where: { id: eventId } })).seatsTaken).toBe(1);

      await jobs.sendReminders(new Date());
      await jobs.sendReminders(new Date());
      const key = `event-reminder:${(await prisma.eventOccurrence.findFirstOrThrow({ where: { eventId } })).id}:${confirmed.body.registration.id}`;
      expect(await prisma.notificationLog.count({ where: { studioId: ZEN, idempotencyKey: key, type: 'EVENT_REMINDER' } })).toBeGreaterThan(0);
      expect(await prisma.notificationLog.count({ where: { studioId: ZEN, idempotencyKey: { startsWith: `event-reminder:` }, userId: unpaid.userId } })).toBe(0);
    });
  });

  describe('event cancellation', () => {
    it('cancels every registration, refunds payments and notifies registrants', async () => {
      const { eventId, ticketId } = await createEvent('cancel', { capacity: 1, price: 60, waitlist: true });
      const [paid, waiting] = [await makeMember(), await makeMember()];
      const r1 = await selfRegister(paid, eventId, { ticketTypeId: ticketId });
      const r2 = await selfRegister(waiting, eventId, { ticketTypeId: ticketId });
      expect([r1.body.registration.status, r2.body.registration.status]).toEqual(['CONFIRMED', 'WAITLIST']);

      expect((await as(receptionToken, ZEN).post(`${base()}/${eventId}/cancel`).send({})).status).toBe(403);
      const cancel = await as(ownerToken, ZEN).post(`${base()}/${eventId}/cancel`).send({ reason: 'Eğitmen hastalandı', notify: true });
      expect(cancel.status).toBe(200);
      expect(cancel.body).toMatchObject({ eventId, cancelledRegistrations: 2, refundedPayments: 1, refundFailures: 0 });

      const event = await prisma.event.findUniqueOrThrow({ where: { id: eventId } });
      expect(event).toMatchObject({ status: 'CANCELLED', seatsTaken: 0 });
      expect(await prisma.eventRegistration.count({ where: { eventId, status: { not: 'CANCELLED' } } })).toBe(0);
      const payment = await prisma.payment.findUniqueOrThrow({ where: { id: r1.body.registration.paymentId } });
      expect(payment.paymentStatus).toBe('REFUNDED');
      for (const r of [r1, r2]) {
        expect(await prisma.notificationLog.count({ where: { studioId: ZEN, idempotencyKey: `event-cancelled:${r.body.registration.id}`, type: 'EVENT_CANCELLED' } })).toBeGreaterThan(0);
      }
      // A cancelled event takes no new registrations.
      const late = await selfRegister(await makeMember(), eventId, { ticketTypeId: ticketId });
      expect(late.status).toBe(409);
      expect(late.body.code).toBe('EVENT_NOT_PUBLISHED');
    });
  });
});
