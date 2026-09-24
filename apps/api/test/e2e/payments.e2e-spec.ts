import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { createHmac } from 'crypto';
import { PrismaClient, PaymentStatus } from '@platform/database';
import { AppModule } from '../../src/app.module';

/**
 * W6: payment provider abstraction, package sales (cash / card / bank
 * transfer / online checkout), member self checkout, refunds and provider
 * webhook idempotency. Every scenario creates and cleans up its own rows.
 */

const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Demo1234!';
const OWNER_PHONE = '+905321000002';
const TRAINER_PHONE = '+905321000004';
const MEMBER_PHONE = '+905321000016';
const MOCK_WEBHOOK_SECRET = 'mock-webhook-secret';

function signMockWebhook(rawBody: string): string {
  return createHmac('sha256', MOCK_WEBHOOK_SECRET).update(rawBody).digest('hex');
}

describe('Payments (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let server: any;

  let ZEN: string;
  let FLOW: string;
  let ownerToken: string;
  let trainerToken: string;
  let memberToken: string;

  let sessionPackageId: string; // ZEN: 10 Seans Birebir Reformer
  let sessionPackagePrice: number;
  let unlimitedPackageId: string; // ZEN: Aylik Sinirsiz Grup Uyeligi
  let flowPackageId: string; // FLOW package, used for cross-tenant checks
  let memberId: string; // ZEN member profile of MEMBER_PHONE
  let otherMemberId: string; // another ZEN member, for staff-driven sales

  const paymentIds: string[] = [];
  const memberPackageIds: string[] = [];
  const subscriptionIds: string[] = [];
  const storedCardIds: string[] = [];

  const login = async (phone: string) => {
    const res = await request(server).post('/auth/login').send({ emailOrPhone: phone, password: DEMO_PASSWORD });
    expect(res.status).toBe(200);
    return res.body.accessToken as string;
  };
  const as = (token: string, studioId = ZEN) => ({
    get: (url: string) => request(server).get(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId),
    post: (url: string, body?: unknown) =>
      request(server).post(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId).send(body ?? {}),
  });

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
    sessionPackagePrice = Number(sessionPkg.price);
    unlimitedPackageId = (
      await prisma.packageDefinition.findFirstOrThrow({ where: { studioId: ZEN, name: 'Aylik Sinirsiz Grup Uyeligi' } })
    ).id;
    flowPackageId = (await prisma.packageDefinition.findFirstOrThrow({ where: { studioId: FLOW } })).id;

    memberId = (
      await prisma.memberProfile.findFirstOrThrow({ where: { studioId: ZEN, membership: { user: { phone: MEMBER_PHONE } } } })
    ).id;
    otherMemberId = (
      await prisma.memberProfile.findFirstOrThrow({ where: { studioId: ZEN, id: { not: memberId } } })
    ).id;

    ownerToken = await login(OWNER_PHONE);
    trainerToken = await login(TRAINER_PHONE);
    memberToken = await login(MEMBER_PHONE);
  });

  afterAll(async () => {
    await prisma.paymentAttempt.deleteMany({ where: { memberSubscriptionId: { in: subscriptionIds } } });
    await prisma.memberSubscription.deleteMany({ where: { id: { in: subscriptionIds } } });
    await prisma.payment.deleteMany({ where: { id: { in: paymentIds } } });
    await prisma.memberPackage.deleteMany({ where: { id: { in: memberPackageIds } } });
    await prisma.storedCard.deleteMany({ where: { id: { in: storedCardIds } } });
    await prisma.auditLog.deleteMany({ where: { studioId: ZEN, action: { startsWith: 'payments.' } } });
    await prisma.$disconnect();
    await app.close();
  });

  const trackSale = (body: any) => {
    if (body.payment?.id) paymentIds.push(body.payment.id);
    if (body.memberPackage?.id) memberPackageIds.push(body.memberPackage.id);
  };

  describe('sell with payment: atomicity', () => {
    it('a cash sale creates a COMPLETED payment and an ACTIVE member package together', async () => {
      const res = await as(ownerToken).post('/payments/sell', {
        studioId: ZEN,
        memberId: otherMemberId,
        packageDefinitionId: sessionPackageId,
        paymentMethod: 'CASH',
        paidAmount: 12000,
        currency: 'TRY',
        notes: 'e2e cash sale',
      });
      expect(res.status).toBe(201);
      trackSale(res.body);

      expect(res.body.payment.paymentStatus).toBe('COMPLETED');
      expect(res.body.payment.memberPackageId).toBe(res.body.memberPackage.id);
      expect(res.body.memberPackage.status).toBe('ACTIVE');
      expect(res.body.memberPackage.remainingUnits).toBe(10);

      const dbPayment = await prisma.payment.findUniqueOrThrow({ where: { id: res.body.payment.id } });
      const dbPackage = await prisma.memberPackage.findUniqueOrThrow({ where: { id: res.body.memberPackage.id } });
      expect(dbPayment.memberPackageId).toBe(dbPackage.id);
    });

    it('a card-present sale charges through the mock provider and records the provider reference', async () => {
      const res = await as(ownerToken).post('/payments/sell', {
        studioId: ZEN,
        memberId: otherMemberId,
        packageDefinitionId: unlimitedPackageId,
        paymentMethod: 'CREDIT_CARD_POS',
        paidAmount: 4500,
        currency: 'TRY',
        card: { providerCardToken: 'card_tok_good_1234', last4: '1234', brand: 'VISA', expMonth: 12, expYear: 2030 },
      });
      expect(res.status).toBe(201);
      trackSale(res.body);
      expect(res.body.payment.paymentStatus).toBe('COMPLETED');
      expect(res.body.payment.provider).toBe('MOCK');
      expect(res.body.payment.providerReference).toMatch(/^mock_chg_/);
    });
  });

  describe('declined card', () => {
    it('rejects the sale and writes nothing when the test card is declined', async () => {
      const beforePayments = await prisma.payment.count({ where: { studioId: ZEN, memberId: otherMemberId } });
      const beforePackages = await prisma.memberPackage.count({ where: { studioId: ZEN, memberId: otherMemberId } });

      const res = await as(ownerToken).post('/payments/sell', {
        studioId: ZEN,
        memberId: otherMemberId,
        packageDefinitionId: sessionPackageId,
        paymentMethod: 'CREDIT_CARD_POS',
        paidAmount: 12000,
        currency: 'TRY',
        card: { providerCardToken: 'card_tok_bad_0002', last4: '0002', brand: 'VISA', expMonth: 12, expYear: 2030 },
      });
      expect(res.status).toBe(400);

      const afterPayments = await prisma.payment.count({ where: { studioId: ZEN, memberId: otherMemberId } });
      const afterPackages = await prisma.memberPackage.count({ where: { studioId: ZEN, memberId: otherMemberId } });
      expect(afterPayments).toBe(beforePayments);
      expect(afterPackages).toBe(beforePackages);
    });
  });

  describe('member self checkout', () => {
    it('completes a mock checkout and activates the package for the caller', async () => {
      const res = await as(memberToken).post('/payments/checkout/self', {
        studioId: ZEN,
        memberId,
        packageDefinitionId: sessionPackageId,
      });
      expect(res.status).toBe(201);
      trackSale(res.body);
      expect(res.body.pending).toBe(false);
      expect(res.body.memberPackage.status).toBe('ACTIVE');
      expect(res.body.payment.memberId).toBe(memberId);
    });

    it('rejects checkout for a different member id', async () => {
      const res = await as(memberToken).post('/payments/checkout/self', {
        studioId: ZEN,
        memberId: otherMemberId,
        packageDefinitionId: sessionPackageId,
      });
      expect(res.status).toBe(403);
    });
  });

  describe('bank transfer confirm flow', () => {
    it('records a PENDING payment, then activates the package once staff confirms it', async () => {
      const sale = await as(ownerToken).post('/payments/sell', {
        studioId: ZEN,
        memberId: otherMemberId,
        packageDefinitionId: sessionPackageId,
        paymentMethod: 'BANK_TRANSFER',
        paidAmount: 12000,
        currency: 'TRY',
        bankReference: 'DEKONT-E2E-001',
      });
      expect(sale.status).toBe(201);
      expect(sale.body.pending).toBe(true);
      expect(sale.body.payment.paymentStatus).toBe('PENDING');
      paymentIds.push(sale.body.payment.id);

      const confirm = await as(ownerToken).post('/payments/bank-transfer/confirm', { paymentId: sale.body.payment.id });
      expect(confirm.status).toBe(201);
      memberPackageIds.push(confirm.body.memberPackage.id);
      expect(confirm.body.memberPackage.status).toBe('ACTIVE');

      const dbPayment = await prisma.payment.findUniqueOrThrow({ where: { id: sale.body.payment.id } });
      expect(dbPayment.paymentStatus).toBe(PaymentStatus.COMPLETED);
      expect(dbPayment.memberPackageId).toBe(confirm.body.memberPackage.id);
    });

    it('rejects a second confirmation of the same bank transfer', async () => {
      const sale = await as(ownerToken).post('/payments/sell', {
        studioId: ZEN,
        memberId: otherMemberId,
        packageDefinitionId: sessionPackageId,
        paymentMethod: 'BANK_TRANSFER',
        paidAmount: 12000,
        currency: 'TRY',
        bankReference: 'DEKONT-E2E-002',
      });
      paymentIds.push(sale.body.payment.id);

      const first = await as(ownerToken).post('/payments/bank-transfer/confirm', { paymentId: sale.body.payment.id });
      expect(first.status).toBe(201);
      memberPackageIds.push(first.body.memberPackage.id);

      const second = await as(ownerToken).post('/payments/bank-transfer/confirm', { paymentId: sale.body.payment.id });
      expect(second.status).toBe(409);
    });

    it('a member cannot confirm a bank transfer (needs finance.manage)', async () => {
      const sale = await as(ownerToken).post('/payments/sell', {
        studioId: ZEN,
        memberId: otherMemberId,
        packageDefinitionId: sessionPackageId,
        paymentMethod: 'BANK_TRANSFER',
        paidAmount: 12000,
        currency: 'TRY',
        bankReference: 'DEKONT-E2E-003',
      });
      paymentIds.push(sale.body.payment.id);

      const res = await as(memberToken).post('/payments/bank-transfer/confirm', { paymentId: sale.body.payment.id });
      expect(res.status).toBe(403);
    });
  });

  describe('refund limit and double refund', () => {
    let paymentId: string;

    beforeEach(async () => {
      const sale = await as(ownerToken).post('/payments/sell', {
        studioId: ZEN,
        memberId: otherMemberId,
        packageDefinitionId: sessionPackageId,
        paymentMethod: 'CASH',
        paidAmount: 12000,
        currency: 'TRY',
      });
      paymentId = sale.body.payment.id;
      paymentIds.push(paymentId);
      memberPackageIds.push(sale.body.memberPackage.id);
    });

    it('rejects a refund larger than the paid amount', async () => {
      const res = await as(ownerToken).post(`/payments/${paymentId}/refund`, { amount: 20000, reason: 'e2e asiri iade' });
      expect(res.status).toBe(400);
    });

    it('allows a partial refund, then rejects a second refund that would exceed the remaining amount', async () => {
      const first = await as(ownerToken).post(`/payments/${paymentId}/refund`, { amount: 8000, reason: 'e2e kismi iade' });
      expect(first.status).toBe(201);
      expect(first.body.refundedAmount).toBe('8000');
      expect(first.body.paymentStatus).toBe('COMPLETED');

      const second = await as(ownerToken).post(`/payments/${paymentId}/refund`, { amount: 5000, reason: 'e2e cift iade' });
      expect(second.status).toBe(400);

      const third = await as(ownerToken).post(`/payments/${paymentId}/refund`, { amount: 4000, reason: 'e2e kalan iade' });
      expect(third.status).toBe(201);
      expect(third.body.refundedAmount).toBe('12000');
      expect(third.body.paymentStatus).toBe('REFUNDED');
    });

    it('a trainer cannot refund (needs finance.manage)', async () => {
      const res = await as(trainerToken).post(`/payments/${paymentId}/refund`, { amount: 100, reason: 'e2e' });
      expect(res.status).toBe(403);
    });
  });

  describe('webhook idempotency', () => {
    it('activates a PENDING payment once and ignores a redelivered webhook', async () => {
      // Set up a PENDING online payment directly, as if a real (non-mock)
      // provider's redirect checkout had not resolved yet.
      const pending = await prisma.payment.create({
        data: {
          studioId: ZEN,
          memberId: otherMemberId,
          amount: sessionPackagePrice,
          currency: 'TRY',
          paymentMethod: 'ONLINE_IYZICO',
          paymentStatus: 'PENDING',
          provider: 'MOCK',
          providerReference: `mock_chk_e2e_${Date.now()}`,
          metadata: { packageDefinitionId: sessionPackageId, startDate: null },
        },
      });
      paymentIds.push(pending.id);

      const payload = { eventType: 'CHARGE_SUCCEEDED', providerReference: pending.providerReference, amount: sessionPackagePrice };
      const raw = JSON.stringify(payload);
      const signature = signMockWebhook(raw);

      const first = await request(server).post('/payments/webhook/mock').set('x-mock-signature', signature).send(payload);
      expect(first.status).toBe(200);
      expect(first.body.handled).toBe(true);

      const afterFirst = await prisma.payment.findUniqueOrThrow({ where: { id: pending.id } });
      expect(afterFirst.paymentStatus).toBe(PaymentStatus.COMPLETED);
      expect(afterFirst.memberPackageId).not.toBeNull();
      memberPackageIds.push(afterFirst.memberPackageId as string);

      const second = await request(server).post('/payments/webhook/mock').set('x-mock-signature', signature).send(payload);
      expect(second.status).toBe(200);
      expect(second.body.alreadyProcessed).toBe(true);

      const packageCount = await prisma.memberPackage.count({ where: { studioId: ZEN, memberId: otherMemberId, id: afterFirst.memberPackageId as string } });
      // A redelivered webhook for an already-completed payment must not create a second package.
      expect(packageCount).toBe(1);
    });

    it('rejects a webhook with a bad signature', async () => {
      const payload = { eventType: 'CHARGE_SUCCEEDED', providerReference: 'mock_chg_does_not_exist' };
      const res = await request(server).post('/payments/webhook/mock').set('x-mock-signature', 'wrong').send(payload);
      expect(res.status).toBe(400);
    });
  });

  describe('cross-tenant and permission denials', () => {
    it('rejects selling a package that belongs to another studio', async () => {
      const res = await as(ownerToken).post('/payments/sell', {
        studioId: ZEN,
        memberId: otherMemberId,
        packageDefinitionId: flowPackageId,
        paymentMethod: 'CASH',
        paidAmount: 100,
        currency: 'TRY',
      });
      expect(res.status).toBe(404);
    });

    it('a trainer cannot sell a package (needs packages.sell)', async () => {
      const res = await as(trainerToken).post('/payments/sell', {
        studioId: ZEN,
        memberId: otherMemberId,
        packageDefinitionId: sessionPackageId,
        paymentMethod: 'CASH',
        paidAmount: 12000,
        currency: 'TRY',
      });
      expect(res.status).toBe(403);
    });

    it('a member cannot list studio payments (needs finance.view)', async () => {
      const res = await as(memberToken).get('/payments');
      expect(res.status).toBe(403);
    });

    it('the payments list shows the member display name instead of just the raw member id', async () => {
      const sale = await as(ownerToken).post('/payments/sell', {
        studioId: ZEN,
        memberId: otherMemberId,
        packageDefinitionId: sessionPackageId,
        paymentMethod: 'CASH',
        paidAmount: 12000,
        currency: 'TRY',
        notes: 'e2e display name',
      });
      expect(sale.status).toBe(201);
      trackSale(sale.body);

      const otherUser = (
        await prisma.memberProfile.findUniqueOrThrow({
          where: { id: otherMemberId },
          include: { membership: { include: { user: true } } },
        })
      ).membership.user;

      const res = await as(ownerToken).get('/payments');
      expect(res.status).toBe(200);
      const row = res.body.find((p: { id: string }) => p.id === sale.body.payment.id);
      expect(row).toBeDefined();
      // Owner has members.contact.view, so the full name is shown, not the raw UUID.
      expect(row.memberDisplayName).toBe(`${otherUser.firstName} ${otherUser.lastName}`);
      expect(row.memberDisplayName).not.toBe(otherMemberId);
    });
  });

  describe('subscriptions', () => {
    it('a member adds a stored card, staff creates a subscription, and the member cancels it at period end', async () => {
      const card = await as(memberToken).post('/payments/cards/self', {
        providerCardToken: 'card_tok_sub_5555',
        last4: '5555',
        brand: 'VISA',
        expMonth: 12,
        expYear: 2031,
      });
      expect(card.status).toBe(201);
      storedCardIds.push(card.body.id);

      const sub = await as(ownerToken).post('/payments/subscriptions', {
        studioId: ZEN,
        memberId,
        packageDefinitionId: unlimitedPackageId,
        storedCardId: card.body.id,
        installmentCount: 1,
      });
      expect(sub.status).toBe(201);
      subscriptionIds.push(sub.body.id);
      expect(sub.body.status).toBe('ACTIVE');

      const cancel = await as(memberToken).post(`/payments/subscriptions/${sub.body.id}/cancel/self`, { atPeriodEnd: true });
      expect(cancel.status).toBe(201);
      expect(cancel.body.cancelAtPeriodEnd).toBe(true);
      expect(cancel.body.status).toBe('ACTIVE');
    });
  });
});
