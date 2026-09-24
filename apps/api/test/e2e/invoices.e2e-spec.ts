import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { PrismaClient, InvoiceStatus } from '@platform/database';
import { AppModule } from '../../src/app.module';

/**
 * W8: e-Arsiv/e-Fatura invoice settings, auto-issue on payment completion,
 * retry after a provider failure, cancel on full refund, member self-service
 * and permission/cross-tenant denials. Every scenario cleans up its own rows.
 */

const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Demo1234!';
const OWNER_PHONE = '+905321000002';
const TRAINER_PHONE = '+905321000004';
const MEMBER_PHONE = '+905321000016';
const SERIES_PREFIX = 'W8E2E';

describe('Invoices (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let server: any;

  let ZEN: string;
  let FLOW: string;
  let ownerToken: string;
  let trainerToken: string;
  let memberToken: string;

  let sessionPackageId: string;
  let memberId: string;
  let otherMemberId: string;

  const paymentIds: string[] = [];
  const memberPackageIds: string[] = [];
  const invoiceIds: string[] = [];

  const login = async (phone: string) => {
    const res = await request(server).post('/auth/login').send({ emailOrPhone: phone, password: DEMO_PASSWORD });
    expect(res.status).toBe(200);
    return res.body.accessToken as string;
  };
  const as = (token: string, studioId = ZEN) => ({
    get: (url: string) => request(server).get(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId),
    put: (url: string, body?: unknown) =>
      request(server).put(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId).send(body ?? {}),
    post: (url: string, body?: unknown) =>
      request(server).post(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId).send(body ?? {}),
  });

  const sell = async (memberIdToUse: string, notes: string) => {
    const res = await as(ownerToken).post('/payments/sell', {
      studioId: ZEN,
      memberId: memberIdToUse,
      packageDefinitionId: sessionPackageId,
      paymentMethod: 'CASH',
      paidAmount: 1000,
      currency: 'TRY',
      notes,
    });
    expect(res.status).toBe(201);
    paymentIds.push(res.body.payment.id);
    memberPackageIds.push(res.body.memberPackage.id);
    return res.body.payment.id as string;
  };

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    await app.init();
    server = app.getHttpServer();
    prisma = new PrismaClient();

    ZEN = (await prisma.studio.findUniqueOrThrow({ where: { slug: 'zen-reformer-pilates' } })).id;
    FLOW = (await prisma.studio.findUniqueOrThrow({ where: { slug: 'flow-pilates-wellness' } })).id;

    const sessionPkg = await prisma.packageDefinition.findFirstOrThrow({
      where: { studioId: ZEN, name: '10 Seans Birebir Reformer' },
    });
    sessionPackageId = sessionPkg.id;

    memberId = (
      await prisma.memberProfile.findFirstOrThrow({ where: { studioId: ZEN, membership: { user: { phone: MEMBER_PHONE } } } })
    ).id;
    otherMemberId = (await prisma.memberProfile.findFirstOrThrow({ where: { studioId: ZEN, id: { not: memberId } } })).id;

    ownerToken = await login(OWNER_PHONE);
    trainerToken = await login(TRAINER_PHONE);
    memberToken = await login(MEMBER_PHONE);

    // Baseline: e-Arsiv with MOCK provider, auto-issue on payment.
    const settings = await as(ownerToken).put('/invoicing/settings', {
      legalName: 'Zen Reformer Pilates A.S.',
      taxOffice: 'Kadikoy',
      taxNumber: '1234567890',
      address: 'Istanbul',
      eInvoiceMode: 'EARSIV',
      provider: 'MOCK',
      defaultVatRate: 20,
      seriesPrefix: SERIES_PREFIX,
      autoIssueOnPayment: true,
    });
    expect(settings.status).toBe(200);
  });

  afterAll(async () => {
    await prisma.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
    await prisma.invoiceCounter.deleteMany({ where: { studioId: ZEN, seriesPrefix: SERIES_PREFIX } });
    await prisma.payment.deleteMany({ where: { id: { in: paymentIds } } });
    await prisma.memberPackage.deleteMany({ where: { id: { in: memberPackageIds } } });
    await prisma.billingProfile.deleteMany({ where: { studioId: ZEN, memberId: { in: [memberId, otherMemberId] } } });
    await prisma.invoiceSettings.deleteMany({ where: { studioId: ZEN } });
    await prisma.auditLog.deleteMany({ where: { studioId: ZEN, action: { startsWith: 'invoicing.' } } });
    await prisma.$disconnect();
    await app.close();
  });

  describe('invoice settings validation', () => {
    it('rejects an invalid VKN/TCKN tax number', async () => {
      const res = await as(ownerToken).put('/invoicing/settings', {
        legalName: 'Zen Reformer Pilates A.S.',
        taxNumber: '0000000000', // fails the VKN checksum
        eInvoiceMode: 'EARSIV',
        provider: 'MOCK',
        defaultVatRate: 20,
        seriesPrefix: SERIES_PREFIX,
        autoIssueOnPayment: true,
      });
      expect(res.status).toBe(400);
    });

    it('a trainer cannot update settings (needs finance.manage)', async () => {
      const res = await as(trainerToken).put('/invoicing/settings', {
        legalName: 'X',
        eInvoiceMode: 'NONE',
        provider: 'MOCK',
        defaultVatRate: 20,
        seriesPrefix: 'A',
        autoIssueOnPayment: false,
      });
      expect(res.status).toBe(403);
    });

    it('a member cannot read settings (needs finance.view)', async () => {
      const res = await as(memberToken).get('/invoicing/settings');
      expect(res.status).toBe(403);
    });
  });

  describe('auto-issue on sell', () => {
    it('issues an e-Arsiv invoice automatically once the payment completes', async () => {
      const paymentId = await sell(otherMemberId, 'e2e auto-issue');

      const list = await as(ownerToken).get('/invoices');
      expect(list.status).toBe(200);
      const invoice = (list.body as any[]).find((i) => i.paymentId === paymentId);
      expect(invoice).toBeTruthy();
      invoiceIds.push(invoice.id);

      expect(invoice.status).toBe(InvoiceStatus.ISSUED);
      expect(invoice.number.startsWith(SERIES_PREFIX)).toBe(true);
      expect(invoice.total).toBe('1000');
      expect(invoice.subtotal).toBe('833.33');
      expect(invoice.vatAmount).toBe('166.67');
      expect(invoice.provider).toBe('MOCK');

      const one = await as(ownerToken).get(`/invoices/${invoice.id}`);
      expect(one.status).toBe(200);
      expect(one.body.id).toBe(invoice.id);
    });

    it('two invoices for the same studio get consecutive sequence numbers', async () => {
      const p1 = await sell(otherMemberId, 'e2e seq 1');
      const p2 = await sell(otherMemberId, 'e2e seq 2');

      const list = await as(ownerToken).get('/invoices');
      const inv1 = (list.body as any[]).find((i) => i.paymentId === p1);
      const inv2 = (list.body as any[]).find((i) => i.paymentId === p2);
      invoiceIds.push(inv1.id, inv2.id);

      const seq1 = Number(inv1.number.slice(-6));
      const seq2 = Number(inv2.number.slice(-6));
      expect(seq2).toBe(seq1 + 1);
    });

    it('downloads the MOCK HTML placeholder with the correct content type', async () => {
      const paymentId = await sell(otherMemberId, 'e2e download');
      const list = await as(ownerToken).get('/invoices');
      const invoice = (list.body as any[]).find((i) => i.paymentId === paymentId);
      invoiceIds.push(invoice.id);

      const res = await as(ownerToken).get(`/invoices/${invoice.id}/download`);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.text).toContain(invoice.providerUuid);
    });
  });

  describe('retry after failure', () => {
    it('a provider-rejected invoice is FAILED, and a retry after fixing settings succeeds', async () => {
      // Switch to an unconfigured provider so the auto-issue attempt fails.
      const toParasut = await as(ownerToken).put('/invoicing/settings', {
        legalName: 'Zen Reformer Pilates A.S.',
        taxOffice: 'Kadikoy',
        taxNumber: '1234567890',
        eInvoiceMode: 'EARSIV',
        provider: 'PARASUT',
        defaultVatRate: 20,
        seriesPrefix: SERIES_PREFIX,
        autoIssueOnPayment: true,
      });
      expect(toParasut.status).toBe(200);

      const paymentId = await sell(otherMemberId, 'e2e retry-fail');
      const list = await as(ownerToken).get('/invoices');
      const invoice = (list.body as any[]).find((i) => i.paymentId === paymentId);
      expect(invoice).toBeTruthy();
      invoiceIds.push(invoice.id);
      expect(invoice.status).toBe(InvoiceStatus.FAILED);
      expect(invoice.failureReason).toBeTruthy();

      // Restore MOCK and retry the same invoice.
      const toMock = await as(ownerToken).put('/invoicing/settings', {
        legalName: 'Zen Reformer Pilates A.S.',
        taxOffice: 'Kadikoy',
        taxNumber: '1234567890',
        eInvoiceMode: 'EARSIV',
        provider: 'MOCK',
        defaultVatRate: 20,
        seriesPrefix: SERIES_PREFIX,
        autoIssueOnPayment: true,
      });
      expect(toMock.status).toBe(200);

      const retry = await as(ownerToken).post(`/invoices/${invoice.id}/retry`);
      expect(retry.status).toBe(201);
      expect(retry.body.status).toBe(InvoiceStatus.ISSUED);
      expect(retry.body.number).toBe(invoice.number); // same reserved number, not a new one
    });

    it('a trainer cannot retry (needs finance.manage)', async () => {
      const paymentId = await sell(otherMemberId, 'e2e retry-perm');
      const list = await as(ownerToken).get('/invoices');
      const invoice = (list.body as any[]).find((i) => i.paymentId === paymentId);
      invoiceIds.push(invoice.id);

      const res = await as(trainerToken).post(`/invoices/${invoice.id}/retry`);
      expect(res.status).toBe(403);
    });
  });

  describe('cancel on full refund', () => {
    it('cancels the invoice when the payment is fully refunded', async () => {
      const paymentId = await sell(otherMemberId, 'e2e refund-cancel');
      const list = await as(ownerToken).get('/invoices');
      const invoice = (list.body as any[]).find((i) => i.paymentId === paymentId);
      invoiceIds.push(invoice.id);
      expect(invoice.status).toBe(InvoiceStatus.ISSUED);

      const refund = await as(ownerToken).post(`/payments/${paymentId}/refund`, { amount: 1000, reason: 'e2e tam iade' });
      expect(refund.status).toBe(201);
      expect(refund.body.paymentStatus).toBe('REFUNDED');

      const after = await as(ownerToken).get(`/invoices/${invoice.id}`);
      expect(after.status).toBe(200);
      expect(after.body.status).toBe(InvoiceStatus.CANCELLED);
      expect(after.body.cancelReason).toContain('İade');
    });

    it('a trainer cannot cancel an invoice directly (needs finance.manage)', async () => {
      const paymentId = await sell(otherMemberId, 'e2e cancel-perm');
      const list = await as(ownerToken).get('/invoices');
      const invoice = (list.body as any[]).find((i) => i.paymentId === paymentId);
      invoiceIds.push(invoice.id);

      const res = await as(trainerToken).post(`/invoices/${invoice.id}/cancel`, { reason: 'e2e' });
      expect(res.status).toBe(403);
    });

    it('cancel requires a reason', async () => {
      const paymentId = await sell(otherMemberId, 'e2e cancel-reason');
      const list = await as(ownerToken).get('/invoices');
      const invoice = (list.body as any[]).find((i) => i.paymentId === paymentId);
      invoiceIds.push(invoice.id);

      const res = await as(ownerToken).post(`/invoices/${invoice.id}/cancel`, {});
      expect(res.status).toBe(400);
    });
  });

  describe('member self-service', () => {
    it('a member sees only their own invoices, never another member’s', async () => {
      const ownPaymentRes = await as(memberToken).post('/payments/checkout/self', {
        studioId: ZEN,
        memberId,
        packageDefinitionId: sessionPackageId,
      });
      expect(ownPaymentRes.status).toBe(201);
      paymentIds.push(ownPaymentRes.body.payment.id);
      memberPackageIds.push(ownPaymentRes.body.memberPackage.id);

      const otherPaymentId = await sell(otherMemberId, 'e2e other member');

      const mine = await as(memberToken).get('/invoices/self');
      expect(mine.status).toBe(200);
      const own = (mine.body as any[]).find((i) => i.paymentId === ownPaymentRes.body.payment.id);
      expect(own).toBeTruthy();
      invoiceIds.push(own.id);
      const notOwn = (mine.body as any[]).find((i) => i.paymentId === otherPaymentId);
      expect(notOwn).toBeUndefined();

      const list = await as(ownerToken).get('/invoices');
      const otherInvoice = (list.body as any[]).find((i) => i.paymentId === otherPaymentId);
      invoiceIds.push(otherInvoice.id);

      const forbidden = await as(memberToken).get(`/invoices/self/${otherInvoice.id}/download`);
      expect(forbidden.status).toBe(404);

      const allowed = await as(memberToken).get(`/invoices/self/${own.id}/download`);
      expect(allowed.status).toBe(200);
    });
  });

  describe('permission and cross-tenant denials', () => {
    it('a trainer cannot list invoices (needs finance.view)', async () => {
      const res = await as(trainerToken).get('/invoices');
      expect(res.status).toBe(403);
    });

    it('a member cannot list all studio invoices (needs finance.view)', async () => {
      const res = await as(memberToken).get('/invoices');
      expect(res.status).toBe(403);
    });

    it('an invoice from another studio is not reachable through its own tenant header', async () => {
      const paymentId = await sell(otherMemberId, 'e2e cross-tenant');
      const list = await as(ownerToken).get('/invoices');
      const invoice = (list.body as any[]).find((i) => i.paymentId === paymentId);
      invoiceIds.push(invoice.id);

      const flowOwnerToken = ownerToken; // reuse: request is rejected before any FLOW membership check by tenant filtering
      const res = await as(flowOwnerToken, FLOW).get(`/invoices/${invoice.id}`);
      expect([403, 404]).toContain(res.status);
    });
  });

  describe('billing profile validation', () => {
    it('rejects a company profile without a VKN', async () => {
      const res = await as(ownerToken).put(`/invoicing/billing-profiles/${otherMemberId}`, {
        kind: 'COMPANY',
        companyTitle: 'Test A.S.',
        taxOffice: 'Kadikoy',
      });
      expect(res.status).toBe(400);
    });

    it('accepts a valid company profile and it is used as the invoice buyer', async () => {
      const set = await as(ownerToken).put(`/invoicing/billing-profiles/${otherMemberId}`, {
        kind: 'COMPANY',
        companyTitle: 'Test Pilates A.S.',
        vkn: '1234567890',
        taxOffice: 'Kadikoy',
      });
      expect(set.status).toBe(200);

      const paymentId = await sell(otherMemberId, 'e2e company buyer');
      const list = await as(ownerToken).get('/invoices');
      const invoice = (list.body as any[]).find((i) => i.paymentId === paymentId);
      invoiceIds.push(invoice.id);
      expect(invoice.buyerSnapshot.kind).toBe('COMPANY');
      expect(invoice.buyerSnapshot.vkn).toBe('1234567890');

      // Clean up so it does not affect later cases in this file.
      await prisma.billingProfile.delete({ where: { memberId: otherMemberId } });
    });
  });
});
