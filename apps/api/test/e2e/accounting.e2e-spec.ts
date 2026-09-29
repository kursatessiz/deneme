import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { PaymentMethod, PaymentStatus, PrismaClient } from '@platform/database';
import { AppModule } from '../../src/app.module';

/**
 * G3c-3 accounting export end to end (docs/MUHASEBE.md): the
 * `accounting.export` permission (owner only by default), tenant and branch
 * isolation, the CSV format (UTF-8 BOM, translated header, delimiter,
 * formula-injection protection), refunds as negative lines (from both the
 * audit trail and a real refund call), currencies never mixed in a total,
 * and the JSON body.
 *
 * All rows live in March 2020 (outside any seed data) and carry the receipt
 * prefix "E2EACC" or the category "E2EACC"; afterAll removes them, so the
 * suite passes twice in a row on the same database.
 */

const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Demo1234!';
const PREFIX = 'E2EACC';
const RANGE = 'from=2020-03-01T00:00:00.000Z&to=2020-03-31T23:59:59.999Z';

interface JsonRow {
  paymentId?: string;
  entryType?: string;
  documentNumber?: string;
  currency: string;
  gross: string;
  net: string;
  tax: string;
  taxRate: string;
  description?: string;
  customerName?: string;
  section?: string;
  key?: string;
  category?: string;
  amount?: string;
}

describe('Accounting export G3c-3 (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let server: Parameters<typeof request>[0];

  let ZEN: string;
  let FLOW: string;
  let flowBranch: string;
  let ownerToken: string;
  let receptionToken: string;
  let memberToken: string;
  let flowOwnerToken: string;
  let ownerUserId: string;
  let cur: string; // studio currency: expenses are booked in it
  let other: string; // a second currency for the grouping checks
  let zenMemberId: string;
  let flowMemberId: string;
  const paymentIds: Record<string, string> = {};
  let livePaymentId: string;

  const login = async (p: string) => {
    const res = await request(server).post('/auth/login').send({ emailOrPhone: p, password: DEMO_PASSWORD });
    expect(res.status).toBe(200);
    return res.body.accessToken as string;
  };
  const exportAs = (token: string, studioId: string, query: string, pathStudioId = studioId) =>
    request(server)
      .get(`/studios/${pathStudioId}/accounting/export?${query}`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-studio-id', studioId)
      .buffer(true)
      .parse((res, cb) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => (data += chunk));
        res.on('end', () => cb(null, data));
      });
  const rowsOf = (body: { rows: JsonRow[] }) => body.rows;

  async function cleanup() {
    const payments = await prisma.payment.findMany({ where: { receiptNumber: { startsWith: PREFIX } }, select: { id: true } });
    const ids = payments.map((p) => p.id);
    await prisma.auditLog.deleteMany({ where: { entityType: 'Payment', entityId: { in: ids } } });
    await prisma.payment.deleteMany({ where: { id: { in: ids } } });
    await prisma.expense.deleteMany({ where: { category: { startsWith: PREFIX } } });
    if (ownerUserId) {
      await prisma.auditLog.deleteMany({ where: { action: 'accounting.export', userId: ownerUserId, createdAt: { gte: new Date(Date.now() - 3_600_000) } } });
    }
  }

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer();
    prisma = new PrismaClient();

    const zen = await prisma.studio.findUniqueOrThrow({ where: { slug: 'zen-reformer-pilates' } });
    ZEN = zen.id;
    cur = zen.currency;
    other = cur === 'USD' ? 'EUR' : 'USD';
    FLOW = (await prisma.studio.findUniqueOrThrow({ where: { slug: 'flow-pilates-wellness' } })).id;
    flowBranch = (await prisma.branch.findFirstOrThrow({ where: { studioId: FLOW } })).id;
    ownerToken = await login('+905321000002');
    receptionToken = await login('+905321000003');
    memberToken = await login('+905321000016');
    flowOwnerToken = await login('+905321000022');
    ownerUserId = (await prisma.user.findFirstOrThrow({ where: { phone: '+905321000002' } })).id;
    zenMemberId = (await prisma.memberProfile.findFirstOrThrow({ where: { studioId: ZEN, membership: { user: { phone: '+905321000016' } } } })).id;
    flowMemberId = (await prisma.memberProfile.findFirstOrThrow({ where: { studioId: FLOW } })).id;
    await cleanup();

    const mk = async (key: string, studioId: string, memberId: string, data: { amount: string; currency: string; method: PaymentMethod; paidAt: string; notes?: string; refundedAmount?: string; providerReference?: string; branchId?: string }) => {
      const p = await prisma.payment.create({
        data: {
          studioId,
          memberId,
          branchId: data.branchId ?? null,
          amount: data.amount,
          currency: data.currency,
          paymentMethod: data.method,
          paymentStatus: PaymentStatus.COMPLETED,
          receiptNumber: `${PREFIX}-${key}`,
          providerReference: data.providerReference ?? null,
          notes: data.notes ?? null,
          refundedAmount: data.refundedAmount ?? '0',
          paidAt: new Date(data.paidAt),
        },
      });
      paymentIds[key] = p.id;
    };
    await mk('A', ZEN, zenMemberId, { amount: '120.00', currency: cur, method: PaymentMethod.CASH, paidAt: '2020-03-10T09:00:00Z', providerReference: 'ref-a' });
    await mk('B', ZEN, zenMemberId, { amount: '50.00', currency: other, method: PaymentMethod.ONLINE_STRIPE, paidAt: '2020-03-11T09:00:00Z', notes: "=HYPERLINK(\"http://x\";\"a;b\")" });
    await mk('C', ZEN, zenMemberId, { amount: '100.00', currency: cur, method: PaymentMethod.BANK_TRANSFER, paidAt: '2020-03-12T09:00:00Z', refundedAmount: '40.00' });
    await mk('D', ZEN, zenMemberId, { amount: '999.00', currency: cur, method: PaymentMethod.CASH, paidAt: '2020-04-15T09:00:00Z' });
    await mk('FLOW', FLOW, flowMemberId, { amount: '77.00', currency: cur, method: PaymentMethod.CASH, paidAt: '2020-03-13T09:00:00Z', branchId: flowBranch });
    // The refund as PaymentsService.refundPayment records it: an audit row dated the refund day.
    await prisma.auditLog.create({
      data: {
        studioId: ZEN,
        userId: ownerUserId,
        action: 'payments.refund',
        entityType: 'Payment',
        entityId: paymentIds.C,
        metadata: { amount: '40.00', reason: 'e2e', fullyRefunded: false },
        createdAt: new Date('2020-03-20T10:00:00Z'),
      },
    });
    await prisma.expense.createMany({
      data: [
        { studioId: ZEN, category: `${PREFIX} rent`, amount: '300.00', spentAt: new Date('2020-03-05T00:00:00Z'), note: '+cmd', createdByUserId: ownerUserId },
        { studioId: FLOW, category: `${PREFIX} flow`, amount: '15.00', spentAt: new Date('2020-03-06T00:00:00Z'), createdByUserId: ownerUserId },
      ],
    });
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
    await app.close();
  });

  describe('permission', () => {
    it('is denied to reception, a member and an anonymous caller', async () => {
      expect((await exportAs(receptionToken, ZEN, RANGE)).status).toBe(403);
      expect((await exportAs(memberToken, ZEN, RANGE)).status).toBe(403);
      const anonymous = await request(server).get(`/studios/${ZEN}/accounting/export?${RANGE}`);
      expect(anonymous.status).toBe(401);
    });

    it('is granted to the owner of every studio', async () => {
      expect((await exportAs(ownerToken, ZEN, RANGE)).status).toBe(200);
      expect((await exportAs(flowOwnerToken, FLOW, RANGE)).status).toBe(200);
    });
  });

  describe('tenant isolation', () => {
    it('refuses another studio in the path and never returns its rows', async () => {
      const crossPath = await exportAs(ownerToken, ZEN, RANGE, FLOW);
      expect(crossPath.status).toBe(403);

      const zen = await exportAs(ownerToken, ZEN, `${RANGE}&format=json`);
      const flow = await exportAs(flowOwnerToken, FLOW, `${RANGE}&format=json`);
      const zenDocs = rowsOf(JSON.parse(zen.body)).map((r) => r.documentNumber);
      const flowDocs = rowsOf(JSON.parse(flow.body)).map((r) => r.documentNumber);
      expect(zenDocs).toContain(`${PREFIX}-A`);
      expect(zenDocs).not.toContain(`${PREFIX}-FLOW`);
      expect(flowDocs).toEqual([`${PREFIX}-FLOW`]);
    });

    it('a branch of another studio yields nothing', async () => {
      const res = await exportAs(ownerToken, ZEN, `${RANGE}&format=json&branchId=${flowBranch}`);
      expect(res.status).toBe(200);
      expect(JSON.parse(res.body).rows).toEqual([]);
    });

    it('the branch filter narrows the journal', async () => {
      const res = await exportAs(flowOwnerToken, FLOW, `${RANGE}&format=json&branchId=${flowBranch}`);
      expect(rowsOf(JSON.parse(res.body)).map((r) => r.documentNumber)).toEqual([`${PREFIX}-FLOW`]);
    });
  });

  describe('sales journal CSV', () => {
    let csv: string;
    beforeAll(async () => {
      const res = await exportAs(ownerToken, ZEN, `${RANGE}&kind=sales&format=csv&locale=en`);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/csv/);
      expect(res.headers['content-disposition']).toContain('accounting-sales-2020-03-01_2020-03-31.csv');
      csv = res.body as string;
    });

    it('starts with a UTF-8 BOM and a header row in the requested locale', () => {
      expect(csv.charCodeAt(0)).toBe(0xfeff);
      expect(csv.slice(1).startsWith('Date;Entry type;Document number;Invoice number;Customer;Description;Net;Tax rate (%);Tax amount;Gross;Currency;Payment method;Provider reference')).toBe(true);
    });

    it('escapes formula cells and quotes the delimiter', () => {
      const line = csv.split('\r\n').find((l) => l.includes(`${PREFIX}-B`));
      expect(line).toBeDefined();
      expect(line).toContain(`"'=HYPERLINK(""http://x"";""a;b"")"`);
      expect(csv).not.toMatch(/;=HYPERLINK/);
    });

    it('writes the refund as a negative line dated the refund day and leaves out other periods', () => {
      const refund = csv.split('\r\n').find((l) => l.includes(`${PREFIX}-C`) && l.includes(';REFUND;'));
      expect(refund).toBeDefined();
      expect(refund).toContain('2020-03-20T10:00:00.000Z');
      expect(refund).toContain(';-40.00;');
      expect(csv).not.toContain(`${PREFIX}-D`);
      expect(csv).not.toContain(`${PREFIX}-FLOW`);
    });

    it('supports the comma delimiter and the studio default header language', async () => {
      const res = await exportAs(ownerToken, ZEN, `${RANGE}&kind=sales&format=csv&delimiter=comma&locale=tr`);
      expect(res.status).toBe(200);
      const body = res.body as string;
      expect(body.slice(1).startsWith('Tarih,Kayıt türü,Belge no')).toBe(true);
      expect(body).toContain(`"'=HYPERLINK(`);
    });
  });

  describe('JSON body, currencies and summary', () => {
    it('keeps every amount with its currency and refunds negative', async () => {
      const res = await exportAs(ownerToken, ZEN, `${RANGE}&kind=sales&format=json`);
      const body = JSON.parse(res.body) as { rowCount: number; rows: JsonRow[] };
      const rows = body.rows.filter((r) => r.documentNumber?.startsWith(PREFIX));
      expect(rows.map((r) => `${r.documentNumber}:${r.entryType}:${r.currency}`).sort()).toEqual(
        [`${PREFIX}-A:SALE:${cur}`, `${PREFIX}-B:SALE:${other}`, `${PREFIX}-C:SALE:${cur}`, `${PREFIX}-C:REFUND:${cur}`].sort(),
      );
      const refund = rows.find((r) => r.entryType === 'REFUND');
      expect(refund?.gross).toBe('-40.00');
      expect(Number(refund?.net) + Number(refund?.tax)).toBeCloseTo(-40, 2);
      for (const r of rows) expect(Number(r.net) + Number(r.tax)).toBeCloseTo(Number(r.gross), 2);
    });

    it('never mixes currencies in a summary total', async () => {
      const res = await exportAs(ownerToken, ZEN, `${RANGE}&kind=summary&format=json`);
      const rows = JSON.parse(res.body).rows as JsonRow[];
      const total = (currency: string, key: string) => rows.find((r) => r.section === 'total' && r.currency === currency && r.key === key);
      expect(total(cur, 'sales')?.gross).toBe('180.00'); // 120 + 100 - 40
      expect(total(other, 'sales')?.gross).toBe('50.00');
      expect(total(cur, 'expenses')?.gross).toBe('300.00');
      expect(total(cur, 'result')?.gross).toBe('-120.00');
      expect(total(other, 'expenses')).toBeUndefined();
      expect(total(other, 'result')?.gross).toBe('50.00');
      expect(rows.some((r) => r.section === 'paymentMethod' && r.currency === other && r.key === 'CASH')).toBe(false);
      expect(rows.filter((r) => r.section === 'paymentMethod' && r.currency === cur).map((r) => r.key)).toEqual(['BANK_TRANSFER', 'CASH']);
    });

    it('lists expenses and protects formula text there too', async () => {
      const json = await exportAs(ownerToken, ZEN, `${RANGE}&kind=expenses&format=json`);
      const rows = (JSON.parse(json.body).rows as JsonRow[]).filter((r) => r.category?.startsWith(PREFIX));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ category: `${PREFIX} rent`, amount: '300.00' });
      const csv = await exportAs(ownerToken, ZEN, `${RANGE}&kind=expenses&format=csv`);
      expect(csv.body).toContain(`;'+cmd;300.00;`);
    });
  });

  describe('validation and a real refund', () => {
    it('rejects a reversed range, an overlong range and an unknown kind', async () => {
      expect((await exportAs(ownerToken, ZEN, 'from=2020-04-01&to=2020-03-01')).status).toBe(400);
      expect((await exportAs(ownerToken, ZEN, 'from=2018-01-01&to=2020-03-01')).status).toBe(400);
      expect((await exportAs(ownerToken, ZEN, `${RANGE}&kind=everything`)).status).toBe(400);
    });

    it('a refund made through the API shows up as a negative line', async () => {
      const live = await prisma.payment.create({
        data: {
          studioId: ZEN,
          memberId: zenMemberId,
          amount: '80.00',
          currency: cur,
          paymentMethod: PaymentMethod.CASH,
          paymentStatus: PaymentStatus.COMPLETED,
          receiptNumber: `${PREFIX}-LIVE`,
          paidAt: new Date(),
        },
      });
      livePaymentId = live.id;
      const refund = await request(server)
        .post(`/payments/${livePaymentId}/refund`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-studio-id', ZEN)
        .send({ amount: 30, reason: 'e2e accounting' });
      expect(refund.status).toBe(201);
      const from = new Date(Date.now() - 86_400_000).toISOString();
      const to = new Date(Date.now() + 86_400_000).toISOString();
      const res = await exportAs(ownerToken, ZEN, `from=${from}&to=${to}&format=json`);
      const rows = (JSON.parse(res.body).rows as JsonRow[]).filter((r) => r.paymentId === livePaymentId);
      expect(rows.map((r) => `${r.entryType}:${r.gross}`).sort()).toEqual(['REFUND:-30.00', 'SALE:80.00']);
    });
  });
});
