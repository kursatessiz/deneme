import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { ValueType, Workbook } from 'exceljs';
import type { Worksheet } from 'exceljs';
import { PrismaClient } from '@platform/database';
import { BUNDLED_MESSAGES } from '@platform/shared';
import { AppModule } from '../../src/app.module';

/**
 * Guest and walk-in payments in finance, and the XLSX accounting export
 * (docs/MUHASEBE.md, docs/ETKINLIKLER.md, docs/PERAKENDE.md): a guest's desk
 * payment for an event and a walk-in retail sale are Payment rows with no
 * member (the contact when known), listed in finance and in the accounting
 * export, refunded as negative lines; member flows keep their member; the
 * default XLSX export is a real workbook whose header follows a language
 * override; CSV still honours the delimiter; tenants stay isolated.
 *
 * People use the +90539555 phone prefix, events and products are named
 * "E2E GPAY", the test language is "qx"; all are removed before and after,
 * so the suite passes twice in a row on the same database.
 */

const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Demo1234!';
const PREFIX = '+90539555';
const NAME = 'E2E GPAY';
const LANG = 'qx';
const HOUR = 3_600_000;
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

interface PaymentRow {
  id: string;
  memberId: string | null;
  contactId: string | null;
  memberDisplayName: string | null;
  contactDisplayName: string | null;
  amount: string;
  currency: string;
  paymentStatus: string;
  refundedAmount: string;
}

interface JournalRow {
  paymentId: string;
  entryType: 'SALE' | 'REFUND';
  customerName: string;
  gross: string;
  currency: string;
}

describe('Guest payments and XLSX accounting export (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let server: Parameters<typeof request>[0];

  let ZEN: string;
  let ZEN_SLUG: string;
  let FLOW: string;
  let currency: string;
  let mainBranch: string;
  let ownerToken: string;
  let flowOwnerToken: string;
  let memberId: string;
  let contactId: string;

  const ids: Record<string, string> = {};

  const login = async (p: string) => {
    const res = await request(server).post('/auth/login').send({ emailOrPhone: p, password: DEMO_PASSWORD });
    expect(res.status).toBe(200);
    return res.body.accessToken as string;
  };
  const as = (token: string, studioId: string) => ({
    get: (url: string) => request(server).get(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId),
    post: (url: string) => request(server).post(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId),
  });
  const window = () => `from=${new Date(Date.now() - 24 * HOUR).toISOString()}&to=${new Date(Date.now() + 24 * HOUR).toISOString()}`;
  // Raw bytes: an XLSX body must not go through a text decoder.
  const exportFile = (token: string, studioId: string, query: string) =>
    as(token, studioId)
      .get(`/studios/${studioId}/accounting/export?${query}`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
  const journal = async (token: string, studioId: string): Promise<JournalRow[]> => {
    const res = await as(token, studioId).get(`/studios/${studioId}/accounting/export?${window()}&kind=sales&format=json&locale=en`);
    expect(res.status).toBe(200);
    return res.body.rows as JournalRow[];
  };
  const financeList = async (token: string, studioId: string): Promise<PaymentRow[]> => {
    const res = await as(token, studioId).get(`/payments?${window()}`);
    expect(res.status).toBe(200);
    return res.body as PaymentRow[];
  };
  const workbookOf = async (body: Buffer): Promise<Workbook> => {
    const workbook = new Workbook();
    await workbook.xlsx.load(body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer);
    return workbook;
  };

  async function cleanup() {
    const contacts = await prisma.contact.findMany({ where: { phone: { startsWith: PREFIX } }, select: { id: true } });
    const contactIds = contacts.map((c) => c.id);
    const users = await prisma.user.findMany({ where: { phone: { startsWith: PREFIX } }, select: { id: true } });
    const userIds = users.map((u) => u.id);
    const products = await prisma.product.findMany({ where: { name: { startsWith: NAME } }, select: { id: true } });
    const productIds = products.map((p) => p.id);
    const sales = await prisma.sale.findMany({ where: { lines: { some: { productId: { in: productIds } } } }, select: { id: true, paymentId: true } });
    const payments = await prisma.payment.findMany({
      where: {
        OR: [
          { contactId: { in: contactIds } },
          { id: { in: sales.map((s) => s.paymentId).filter((id): id is string => Boolean(id)) } },
          { member: { membership: { userId: { in: userIds } } } },
        ],
      },
      select: { id: true },
    });
    const paymentIds = payments.map((p) => p.id);

    await prisma.event.deleteMany({ where: { title: { startsWith: NAME } } });
    await prisma.sale.deleteMany({ where: { id: { in: sales.map((s) => s.id) } } });
    await prisma.stockMovement.deleteMany({ where: { productId: { in: productIds } } });
    await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    await prisma.invoice.deleteMany({ where: { paymentId: { in: paymentIds } } });
    await prisma.loyaltyLedger.deleteMany({ where: { sourceType: 'payment', sourceId: { in: paymentIds } } });
    await prisma.auditLog.deleteMany({ where: { entityType: 'Payment', entityId: { in: paymentIds } } });
    await prisma.payment.deleteMany({ where: { id: { in: paymentIds } } });
    await prisma.notificationLog.deleteMany({ where: { OR: [{ contactId: { in: contactIds } }, { recipientPhone: { startsWith: PREFIX } }] } });
    await prisma.conversionEvent.deleteMany({ where: { contactId: { in: contactIds } } });
    await prisma.contactTask.deleteMany({ where: { contactId: { in: contactIds } } });
    await prisma.contact.deleteMany({ where: { id: { in: contactIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.language.deleteMany({ where: { code: LANG } });
  }

  async function createEvent(name: string, price: number): Promise<{ eventId: string; ticketId: string }> {
    const start = new Date(Date.now() + 5 * 24 * HOUR);
    const created = await as(ownerToken, ZEN)
      .post(`/studios/${ZEN}/events`)
      .send({
        kind: 'SINGLE',
        title: `${NAME} ${name}`,
        capacity: 10,
        visibility: 'PUBLIC',
        fullRefundHoursBefore: 24,
        occurrences: [{ startsAt: start.toISOString(), endsAt: new Date(start.getTime() + 2 * HOUR).toISOString() }],
      });
    expect(created.status).toBe(201);
    const ticket = await as(ownerToken, ZEN).post(`/studios/${ZEN}/events/${created.body.id}/tickets`).send({ name: 'Standart', priceAmount: price, currency });
    expect(ticket.status).toBe(201);
    expect((await as(ownerToken, ZEN).post(`/studios/${ZEN}/events/${created.body.id}/publish`)).status).toBe(200);
    return { eventId: created.body.id as string, ticketId: ticket.body.id as string };
  }

  async function stockedProduct(suffix: string, price: string): Promise<string> {
    const res = await as(ownerToken, ZEN).post(`/studios/${ZEN}/retail/products`).send({ name: `${NAME} ${suffix}`, price });
    expect(res.status).toBe(201);
    const rec = await as(ownerToken, ZEN).post(`/studios/${ZEN}/retail/stock/receive`).send({ productId: res.body.id, branchId: mainBranch, quantity: 10 });
    expect(rec.status).toBe(201);
    return res.body.id as string;
  }

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
    mainBranch = (await prisma.branch.findFirstOrThrow({ where: { studioId: ZEN, isActive: true }, orderBy: { createdAt: 'asc' } })).id;
    ownerToken = await login('+905321000002');
    flowOwnerToken = await login('+905321000022');
    await cleanup();

    const role = await prisma.roleTemplate.findFirstOrThrow({ where: { studioId: ZEN, key: 'member' } });
    const template = await prisma.user.findFirstOrThrow({ where: { phone: '+905321000016' }, select: { passwordHash: true } });
    const user = await prisma.user.create({ data: { phone: `${PREFIX}0001`, firstName: 'Gpay', lastName: 'Uye', passwordHash: template.passwordHash, phoneVerifiedAt: new Date() } });
    const membership = await prisma.membership.create({ data: { userId: user.id, studioId: ZEN, roleTemplateId: role.id, status: 'ACTIVE', joinedAt: new Date() } });
    memberId = (await prisma.memberProfile.create({ data: { membershipId: membership.id, studioId: ZEN } })).id;
    contactId = (await prisma.contact.create({ data: { studioId: ZEN, firstName: 'Gpay', lastName: 'Misafir', phone: `${PREFIX}0002`, lifecycleStage: 'LEAD' } })).id;

    // A language pack uploaded by the super admin: only the date header is translated.
    await prisma.language.create({ data: { code: LANG, name: 'QX test', nativeName: 'QX', isEnabled: true } });
    await prisma.translationOverride.create({ data: { locale: LANG, key: 'accounting.col.date', value: 'QX Datum', source: 'UPLOAD', reviewedAt: new Date() } });
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
    await app.close();
  });

  describe('event guests', () => {
    it('a guest desk registration creates a Payment without a member, listed in finance and in the export', async () => {
      const { eventId, ticketId } = await createEvent('desk', 70);
      const reg = await as(ownerToken, ZEN).post(`/studios/${ZEN}/events/${eventId}/registrations`).send({ ticketTypeId: ticketId, contactId, paymentMethod: 'CASH' });
      expect(reg.status).toBe(201);
      expect(reg.body.registration).toMatchObject({ status: 'CONFIRMED', amountPaid: '70.00', currency });
      const paymentId = reg.body.registration.paymentId as string;
      expect(paymentId).toBeTruthy();
      ids.eventDesk = paymentId;
      ids.eventDeskRegistration = reg.body.registration.id;

      const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
      expect(payment).toMatchObject({ studioId: ZEN, memberId: null, contactId, currency, paymentMethod: 'CASH', paymentStatus: 'COMPLETED' });
      expect(payment.amount.toFixed(2)).toBe('70.00');

      const listed = (await financeList(ownerToken, ZEN)).find((p) => p.id === paymentId);
      expect(listed).toMatchObject({ memberId: null, contactId, memberDisplayName: null, contactDisplayName: 'Gpay Misafir', currency });
      expect(Number(listed?.amount)).toBe(70);

      const lines = (await journal(ownerToken, ZEN)).filter((r) => r.paymentId === paymentId);
      expect(lines.map((r) => `${r.entryType}:${r.gross}:${r.currency}`)).toEqual([`SALE:70.00:${currency}`]);
      expect(lines[0].customerName).toBe('Gpay Misafir');
    });

    it('a public guest pays at the desk later: the Payment is created then and the registration follows it', async () => {
      const { eventId, ticketId } = await createEvent('public', 45);
      const guestPhone = `${PREFIX}0003`;
      const pub = await request(server)
        .post(`/public/studios/${ZEN_SLUG}/events/${eventId}/registrations`)
        .send({ ticketTypeId: ticketId, firstName: 'Web', lastName: 'Misafir', phone: guestPhone, consent: true });
      expect(pub.status).toBe(201);
      expect(pub.body.status).toBe('PENDING_PAYMENT');
      const guest = await prisma.contact.findFirstOrThrow({ where: { studioId: ZEN, phone: guestPhone } });
      const held = await prisma.eventRegistration.findFirstOrThrow({ where: { eventId, contactId: guest.id } });
      expect(held.paymentId).toBeNull();

      const paid = await as(ownerToken, ZEN).post(`/studios/${ZEN}/events/registrations/${held.id}/payment`).send({ paymentMethod: 'CREDIT_CARD_POS' });
      expect(paid.status).toBe(200);
      expect(paid.body).toMatchObject({ status: 'CONFIRMED', amountPaid: '45.00' });
      const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paid.body.paymentId } });
      expect(payment).toMatchObject({ memberId: null, contactId: guest.id, paymentMethod: 'CREDIT_CARD_POS', paymentStatus: 'COMPLETED', currency });
      expect((await journal(ownerToken, ZEN)).some((r) => r.paymentId === payment.id && r.entryType === 'SALE' && r.gross === '45.00')).toBe(true);
    });

    it('a full refund of the guest goes through the payment refund and shows as a negative line', async () => {
      const cancel = await as(ownerToken, ZEN).post(`/studios/${ZEN}/events/registrations/${ids.eventDeskRegistration}/cancel`).send({ fullRefund: true, reason: 'e2e guest refund' });
      expect(cancel.status).toBe(200);
      expect(cancel.body).toMatchObject({ refunded: true, refundedAmount: '70.00' });
      const payment = await prisma.payment.findUniqueOrThrow({ where: { id: ids.eventDesk } });
      expect(payment.paymentStatus).toBe('REFUNDED');
      expect(payment.refundedAmount.toFixed(2)).toBe('70.00');
      const registration = await prisma.eventRegistration.findUniqueOrThrow({ where: { id: ids.eventDeskRegistration } });
      expect(registration.refundedAmount.toFixed(2)).toBe('70.00');

      const lines = (await journal(ownerToken, ZEN)).filter((r) => r.paymentId === ids.eventDesk);
      expect(lines.map((r) => `${r.entryType}:${r.gross}`).sort()).toEqual(['REFUND:-70.00', 'SALE:70.00']);
    });

    it('a member desk registration still carries the member and no contact', async () => {
      const { eventId, ticketId } = await createEvent('member', 30);
      const reg = await as(ownerToken, ZEN).post(`/studios/${ZEN}/events/${eventId}/registrations`).send({ ticketTypeId: ticketId, memberId, paymentMethod: 'CASH' });
      expect(reg.status).toBe(201);
      const payment = await prisma.payment.findUniqueOrThrow({ where: { id: reg.body.registration.paymentId } });
      expect(payment).toMatchObject({ memberId, contactId: null });
      const listed = (await financeList(ownerToken, ZEN)).find((p) => p.id === payment.id);
      expect(listed).toMatchObject({ memberId, memberDisplayName: 'Gpay Uye', contactDisplayName: null });
    });
  });

  describe('retail walk-ins', () => {
    it('a walk-in sale creates an anonymous Payment in finance and in the export', async () => {
      const productId = await stockedProduct('walk-in', '25.00');
      const sale = await as(ownerToken, ZEN).post(`/studios/${ZEN}/retail/sales`).send({ branchId: mainBranch, lines: [{ productId, quantity: 2 }], paymentMethod: 'CASH' });
      expect(sale.status).toBe(201);
      const paymentId = sale.body.paymentId as string;
      expect(paymentId).toBeTruthy();
      ids.walkIn = paymentId;
      ids.walkInSale = sale.body.id;
      const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
      expect(payment).toMatchObject({ memberId: null, contactId: null, currency, receiptNumber: sale.body.receiptNumber });
      expect(payment.amount.toFixed(2)).toBe(sale.body.total);

      const listed = (await financeList(ownerToken, ZEN)).find((p) => p.id === paymentId);
      expect(listed).toMatchObject({ memberId: null, contactId: null, memberDisplayName: null, contactDisplayName: null });

      const lines = (await journal(ownerToken, ZEN)).filter((r) => r.paymentId === paymentId);
      expect(lines.length).toBeGreaterThan(0);
      expect(lines.every((r) => r.entryType === 'SALE' && r.customerName === BUNDLED_MESSAGES.en['finance.payments.walkIn'])).toBe(true);
    });

    it('a sale to a chosen contact names the contact; a member sale keeps the member', async () => {
      const productId = await stockedProduct('contact', '12.00');
      const toContact = await as(ownerToken, ZEN).post(`/studios/${ZEN}/retail/sales`).send({ branchId: mainBranch, lines: [{ productId, quantity: 1 }], paymentMethod: 'CASH', contactId });
      expect(toContact.status).toBe(201);
      expect(await prisma.payment.findUniqueOrThrow({ where: { id: toContact.body.paymentId } })).toMatchObject({ memberId: null, contactId });
      expect(await prisma.conversionEvent.count({ where: { contactId, type: 'purchase' } })).toBeGreaterThanOrEqual(1);

      const toMember = await as(ownerToken, ZEN).post(`/studios/${ZEN}/retail/sales`).send({ branchId: mainBranch, lines: [{ productId, quantity: 1 }], paymentMethod: 'CASH', memberId });
      expect(toMember.status).toBe(201);
      expect(await prisma.payment.findUniqueOrThrow({ where: { id: toMember.body.paymentId } })).toMatchObject({ memberId, contactId: null });
    });

    it('a walk-in refund moves the payment and shows as a negative line', async () => {
      const refund = await as(ownerToken, ZEN).post(`/studios/${ZEN}/retail/sales/${ids.walkInSale}/refund`).send({ reason: 'e2e walk-in refund' });
      expect(refund.status).toBe(201);
      const payment = await prisma.payment.findUniqueOrThrow({ where: { id: ids.walkIn } });
      expect(payment.paymentStatus).toBe('REFUNDED');
      const lines = (await journal(ownerToken, ZEN)).filter((r) => r.paymentId === ids.walkIn);
      const sum = (type: string) => lines.filter((r) => r.entryType === type).reduce((acc, r) => acc + Number(r.gross), 0);
      expect(sum('SALE')).toBeCloseTo(50, 2);
      expect(sum('REFUND')).toBeCloseTo(-50, 2);
    });
  });

  describe('XLSX and CSV export', () => {
    it('defaults to a valid XLSX workbook with the header from the language override', async () => {
      const res = await exportFile(ownerToken, ZEN, `${window()}&locale=${LANG}`);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe(XLSX);
      expect(res.headers['content-disposition']).toMatch(/attachment; filename="accounting-sales-\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.xlsx"/);
      const workbook = await workbookOf(res.body as Buffer);
      const sheet = workbook.getWorksheet(currency) as Worksheet;
      expect(sheet).toBeDefined();
      expect(sheet.getRow(1).getCell(1).value).toBe('QX Datum');
      // Keys the pack does not translate fall back to the base catalogue.
      expect(sheet.getRow(1).getCell(10).value).toBe(BUNDLED_MESSAGES.tr['accounting.col.gross']);
      expect(sheet.getRow(1).font?.bold).toBe(true);

      let found = false;
      sheet.eachRow((row, n) => {
        if (n === 1 || row.getCell(14).value !== ids.walkIn) return;
        found = true;
        expect(row.getCell(1).type).toBe(ValueType.Date);
        expect(row.getCell(10).type).toBe(ValueType.Number);
        expect(row.getCell(5).type).toBe(ValueType.String);
        expect(row.getCell(10).formula).toBeUndefined();
      });
      expect(found).toBe(true);
    });

    it('CSV still works with the comma delimiter and uses the same override', async () => {
      const res = await exportFile(ownerToken, ZEN, `${window()}&format=csv&delimiter=comma&locale=${LANG}`);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/csv/);
      const text = (res.body as Buffer).toString('utf8');
      expect(text.charCodeAt(0)).toBe(0xfeff);
      expect(text.slice(1).startsWith('QX Datum,')).toBe(true);
      expect(text).toContain(ids.walkIn);
    });
  });

  describe('tenant isolation', () => {
    it('another studio never sees these payments, in finance or in its export, and cannot refund them', async () => {
      const flowList = await financeList(flowOwnerToken, FLOW);
      expect(flowList.some((p) => p.id === ids.eventDesk || p.id === ids.walkIn)).toBe(false);
      const flowJournal = await journal(flowOwnerToken, FLOW);
      expect(flowJournal.some((r) => r.paymentId === ids.eventDesk || r.paymentId === ids.walkIn)).toBe(false);
      const refund = await as(flowOwnerToken, FLOW).post(`/payments/${ids.eventDesk}/refund`).send({ reason: 'cross tenant' });
      expect(refund.status).toBe(404);
      const denied = await request(server).get(`/studios/${FLOW}/accounting/export?${window()}`).set('Authorization', `Bearer ${ownerToken}`).set('x-studio-id', ZEN);
      expect(denied.status).toBe(403);
    });
  });
});
