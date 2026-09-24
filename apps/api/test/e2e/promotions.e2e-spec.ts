import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import * as bcrypt from 'bcrypt';
import { PrismaClient } from '@platform/database';
import { AppModule } from '../../src/app.module';

/**
 * W9: sales tools. Trial offer limits, promo code discounts and
 * redemption limits, gift card issue/redeem/refund, and their permission
 * and cross-tenant boundaries. Every scenario creates and cleans up its
 * own rows; test members are created directly (not through the invite
 * flow) to keep the suite fast.
 */

const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Demo1234!';
const OWNER_PHONE = '+905321000002';
const TRAINER_PHONE = '+905321000004';
const MEMBER_PHONE = '+905321000016';
const FLOW_OWNER_PHONE = '+905321000022';

describe('Promotions (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let server: any;

  let ZEN: string;
  let FLOW: string;
  let ownerToken: string;
  let trainerToken: string;
  let memberToken: string;
  let flowOwnerToken: string;
  let memberId: string; // ZEN member profile of MEMBER_PHONE
  let zenMemberRoleTemplateId: string;

  let sessionPackageId: string; // ZEN: 10 Seans Birebir Reformer, SESSION_COUNT, 10 units
  let sessionPackagePrice: number;
  let flowPackageId: string;

  const createdUserIds: string[] = [];
  const createdMembershipIds: string[] = [];
  const createdMemberIds: string[] = [];
  const createdPackageDefinitionIds: string[] = [];
  const createdPaymentIds: string[] = [];
  const createdMemberPackageIds: string[] = [];
  const createdPromoCodeIds: string[] = [];
  const createdGiftCardIds: string[] = [];

  const login = async (phone: string) => {
    const res = await request(server).post('/auth/login').send({ emailOrPhone: phone, password: DEMO_PASSWORD });
    expect(res.status).toBe(200);
    return res.body.accessToken as string;
  };
  const as = (token: string, studioId = ZEN) => ({
    get: (url: string) => request(server).get(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId),
    post: (url: string, body?: unknown) =>
      request(server).post(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId).send(body ?? {}),
    put: (url: string, body?: unknown) =>
      request(server).put(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId).send(body ?? {}),
  });

  let phoneCounter = 400000000;
  /** Creates a fresh member (User + Membership + MemberProfile) directly, bypassing the invite flow. */
  const createMember = async (tag: string) => {
    // Turkish mobile format: +90 5 then 9 digits.
    const phone = `+905${String(phoneCounter++).padStart(9, '0')}`;
    const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 4);
    const user = await prisma.user.create({
      data: { phone, firstName: 'Test', lastName: tag, passwordHash, isActive: true, phoneVerifiedAt: new Date() },
    });
    createdUserIds.push(user.id);
    const membership = await prisma.membership.create({
      data: { userId: user.id, studioId: ZEN, roleTemplateId: zenMemberRoleTemplateId, status: 'ACTIVE', joinedAt: new Date() },
    });
    createdMembershipIds.push(membership.id);
    const profile = await prisma.memberProfile.create({ data: { membershipId: membership.id, studioId: ZEN } });
    createdMemberIds.push(profile.id);
    const token = await login(phone);
    return { userId: user.id, memberId: profile.id, token };
  };

  const createTrialPackage = async (trialLimitPerUser = 1) => {
    const pkg = await prisma.packageDefinition.create({
      data: {
        studioId: ZEN,
        name: `E2E Deneme Dersi ${Date.now()}`,
        entitlementKind: 'SESSION_COUNT',
        totalUnits: 1,
        validityDays: 14,
        price: 0,
        isTrial: true,
        trialLimitPerUser,
      },
    });
    createdPackageDefinitionIds.push(pkg.id);
    return pkg.id;
  };

  const trackSale = (body: any) => {
    if (body.payment?.id) createdPaymentIds.push(body.payment.id);
    if (body.memberPackage?.id) createdMemberPackageIds.push(body.memberPackage.id);
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

    zenMemberRoleTemplateId = (await prisma.roleTemplate.findFirstOrThrow({ where: { studioId: ZEN, key: 'member' } })).id;

    const sessionPkg = await prisma.packageDefinition.findFirstOrThrow({
      where: { studioId: ZEN, name: '10 Seans Birebir Reformer' },
    });
    sessionPackageId = sessionPkg.id;
    sessionPackagePrice = Number(sessionPkg.price);
    flowPackageId = (await prisma.packageDefinition.findFirstOrThrow({ where: { studioId: FLOW } })).id;

    memberId = (
      await prisma.memberProfile.findFirstOrThrow({ where: { studioId: ZEN, membership: { user: { phone: MEMBER_PHONE } } } })
    ).id;

    ownerToken = await login(OWNER_PHONE);
    trainerToken = await login(TRAINER_PHONE);
    memberToken = await login(MEMBER_PHONE);
    flowOwnerToken = await login(FLOW_OWNER_PHONE);
  });

  afterAll(async () => {
    // Cleans up by studioId/memberId/userId scope rather than only the
    // tracked id lists, so a test that threw before it could record an id
    // (e.g. a status assertion that failed after the row was created) never
    // leaves an orphan behind.
    await prisma.giftCardTransaction.deleteMany({ where: { OR: [{ giftCardId: { in: createdGiftCardIds } }, { actorUserId: { in: createdUserIds } }] } });
    await prisma.giftCard.deleteMany({ where: { OR: [{ id: { in: createdGiftCardIds } }, { purchaserUserId: { in: createdUserIds } }] } });
    await prisma.promoRedemption.deleteMany({ where: { OR: [{ promoCodeId: { in: createdPromoCodeIds } }, { userId: { in: createdUserIds } }] } });
    await prisma.promoCode.deleteMany({ where: { id: { in: createdPromoCodeIds } } });
    await prisma.trialRedemption.deleteMany({ where: { OR: [{ packageDefinitionId: { in: createdPackageDefinitionIds } }, { userId: { in: createdUserIds } }] } });
    await prisma.redemptionCounter.deleteMany({ where: { studioId: ZEN, userId: { in: createdUserIds } } });
    await prisma.payment.deleteMany({ where: { OR: [{ id: { in: createdPaymentIds } }, { memberId: { in: createdMemberIds } }] } });
    await prisma.memberPackage.deleteMany({ where: { OR: [{ id: { in: createdMemberPackageIds } }, { memberId: { in: createdMemberIds } }] } });
    await prisma.packageDefinitionService.deleteMany({ where: { packageDefinitionId: { in: createdPackageDefinitionIds } } });
    await prisma.packageDefinition.deleteMany({ where: { id: { in: createdPackageDefinitionIds } } });
    await prisma.memberProfile.deleteMany({ where: { id: { in: createdMemberIds } } });
    await prisma.membership.deleteMany({ where: { id: { in: createdMembershipIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await prisma.$disconnect();
    await app.close();
  });

  // ---------------------------------------------------------------------------
  // Trial offers
  // ---------------------------------------------------------------------------

  describe('trial offers', () => {
    it('lists a studio\'s active trial offers publicly, with no auth', async () => {
      const trialId = await createTrialPackage();
      const res = await request(server).get('/studios/public/zen-reformer-pilates/trial-offers');
      expect(res.status).toBe(200);
      expect(res.body.some((o: any) => o.packageDefinitionId === trialId)).toBe(true);
    });

    it('lets a user take a trial once, then rejects a second trial purchase for the same user', async () => {
      const trialId = await createTrialPackage(1);
      const { memberId: trialMemberId } = await createMember('trial-a');

      const first = await as(ownerToken).post('/payments/sell', {
        studioId: ZEN,
        memberId: trialMemberId,
        packageDefinitionId: trialId,
        paymentMethod: 'CASH',
        paidAmount: 0,
        currency: 'TRY',
      });
      expect(first.status).toBe(201);
      trackSale(first.body);

      const second = await as(ownerToken).post('/payments/sell', {
        studioId: ZEN,
        memberId: trialMemberId,
        packageDefinitionId: trialId,
        paymentMethod: 'CASH',
        paidAmount: 0,
        currency: 'TRY',
      });
      expect(second.status).toBe(409);
    });

    it('lets a different user take the same trial offer', async () => {
      const trialId = await createTrialPackage(1);
      const memberA = await createMember('trial-b1');
      const memberB = await createMember('trial-b2');

      const a = await as(ownerToken).post('/payments/sell', {
        studioId: ZEN,
        memberId: memberA.memberId,
        packageDefinitionId: trialId,
        paymentMethod: 'CASH',
        paidAmount: 0,
        currency: 'TRY',
      });
      expect(a.status).toBe(201);
      trackSale(a.body);

      const b = await as(ownerToken).post('/payments/sell', {
        studioId: ZEN,
        memberId: memberB.memberId,
        packageDefinitionId: trialId,
        paymentMethod: 'CASH',
        paidAmount: 0,
        currency: 'TRY',
      });
      expect(b.status).toBe(201);
      trackSale(b.body);
    });
  });

  // ---------------------------------------------------------------------------
  // Promo codes
  // ---------------------------------------------------------------------------

  describe('promo codes: discount math', () => {
    it('applies a percent discount to a cash sale', async () => {
      const member = await createMember('promo-percent');
      const code = `E2EPCT${Date.now()}`;
      const create = await as(ownerToken).post('/promotions/promo-codes', {
        code,
        kind: 'PERCENT',
        value: 10,
        perUserLimit: 1,
      });
      expect(create.status).toBe(201);
      createdPromoCodeIds.push(create.body.id);

      const res = await as(ownerToken).post('/payments/sell', {
        studioId: ZEN,
        memberId: member.memberId,
        packageDefinitionId: sessionPackageId,
        paymentMethod: 'CASH',
        paidAmount: sessionPackagePrice,
        currency: 'TRY',
        promoCode: code,
      });
      expect(res.status).toBe(201);
      trackSale(res.body);
      expect(Number(res.body.payment.discountAmount)).toBeCloseTo(sessionPackagePrice * 0.1, 2);
      expect(Number(res.body.payment.amount)).toBeCloseTo(sessionPackagePrice * 0.9, 2);
    });

    it('applies a fixed amount discount, capped at the price', async () => {
      const member = await createMember('promo-fixed');
      const code = `E2EFIX${Date.now()}`;
      const create = await as(ownerToken).post('/promotions/promo-codes', {
        code,
        kind: 'FIXED_AMOUNT',
        value: sessionPackagePrice + 5000,
        perUserLimit: 1,
      });
      expect(create.status).toBe(201);
      createdPromoCodeIds.push(create.body.id);

      const res = await as(ownerToken).post('/payments/sell', {
        studioId: ZEN,
        memberId: member.memberId,
        packageDefinitionId: sessionPackageId,
        paymentMethod: 'CASH',
        paidAmount: sessionPackagePrice,
        currency: 'TRY',
        promoCode: code,
      });
      expect(res.status).toBe(201);
      trackSale(res.body);
      expect(Number(res.body.payment.discountAmount)).toBeCloseTo(sessionPackagePrice, 2);
      expect(Number(res.body.payment.amount)).toBe(0);
    });

    it('applies free units to the created package instead of a price discount', async () => {
      const member = await createMember('promo-free-units');
      const code = `E2EFREE${Date.now()}`;
      const create = await as(ownerToken).post('/promotions/promo-codes', {
        code,
        kind: 'FREE_UNITS',
        value: 2,
        perUserLimit: 1,
      });
      expect(create.status).toBe(201);
      createdPromoCodeIds.push(create.body.id);

      const res = await as(ownerToken).post('/payments/sell', {
        studioId: ZEN,
        memberId: member.memberId,
        packageDefinitionId: sessionPackageId,
        paymentMethod: 'CASH',
        paidAmount: sessionPackagePrice,
        currency: 'TRY',
        promoCode: code,
      });
      expect(res.status).toBe(201);
      trackSale(res.body);
      expect(Number(res.body.payment.discountAmount)).toBe(0);
      expect(res.body.memberPackage.totalUnits).toBe(12);
      expect(res.body.memberPackage.remainingUnits).toBe(12);
    });

    it('member self-service preview shows the discount without redeeming it', async () => {
      const code = `E2EPREVIEW${Date.now()}`;
      const create = await as(ownerToken).post('/promotions/promo-codes', { code, kind: 'PERCENT', value: 20, perUserLimit: 5 });
      createdPromoCodeIds.push(create.body.id);

      const preview = await as(memberToken).get(
        `/promotions/promo-codes/validate/self?code=${code}&packageDefinitionId=${sessionPackageId}`,
      );
      expect(preview.status).toBe(200);
      expect(preview.body.valid).toBe(true);
      expect(Number(preview.body.discountAmount)).toBeCloseTo(sessionPackagePrice * 0.2, 2);

      const redemptions = await as(ownerToken).get(`/promotions/promo-codes/${create.body.id}/redemptions`);
      expect(redemptions.body).toHaveLength(0);
    });

    it('rejects an expired code', async () => {
      const member = await createMember('promo-expired');
      const code = `E2EEXP${Date.now()}`;
      const create = await as(ownerToken).post('/promotions/promo-codes', {
        code,
        kind: 'PERCENT',
        value: 10,
        validFrom: new Date(Date.now() - 30 * 86400000).toISOString(),
        validTo: new Date(Date.now() - 86400000).toISOString(),
      });
      expect(create.status).toBe(201);
      createdPromoCodeIds.push(create.body.id);

      const res = await as(ownerToken).post('/payments/sell', {
        studioId: ZEN,
        memberId: member.memberId,
        packageDefinitionId: sessionPackageId,
        paymentMethod: 'CASH',
        paidAmount: sessionPackagePrice,
        currency: 'TRY',
        promoCode: code,
      });
      expect(res.status).toBe(400);
    });

    it('enforces the per-user redemption limit', async () => {
      const member = await createMember('promo-peruser');
      const code = `E2EPERUSER${Date.now()}`;
      const create = await as(ownerToken).post('/promotions/promo-codes', { code, kind: 'FIXED_AMOUNT', value: 100, perUserLimit: 1 });
      createdPromoCodeIds.push(create.body.id);

      const first = await as(ownerToken).post('/payments/sell', {
        studioId: ZEN,
        memberId: member.memberId,
        packageDefinitionId: sessionPackageId,
        paymentMethod: 'CASH',
        paidAmount: sessionPackagePrice,
        currency: 'TRY',
        promoCode: code,
      });
      expect(first.status).toBe(201);
      trackSale(first.body);

      const second = await as(ownerToken).post('/payments/sell', {
        studioId: ZEN,
        memberId: member.memberId,
        packageDefinitionId: sessionPackageId,
        paymentMethod: 'CASH',
        paidAmount: sessionPackagePrice,
        currency: 'TRY',
        promoCode: code,
      });
      // Caught by the pre-charge pricing preview (400) in the common case;
      // a genuine race between two simultaneous redemptions is instead
      // caught by the transactional conditional increment (409), covered
      // by the parallel maxRedemptions test below.
      expect([400, 409]).toContain(second.status);
    });

    it('lets exactly maxRedemptions of N parallel checkouts succeed', async () => {
      const LIMIT = 3;
      const ATTEMPTS = 6;
      const code = `E2EMAX${Date.now()}`;
      const create = await as(ownerToken).post('/promotions/promo-codes', {
        code,
        kind: 'FIXED_AMOUNT',
        value: 100,
        maxRedemptions: LIMIT,
        perUserLimit: 1,
      });
      createdPromoCodeIds.push(create.body.id);

      const members = await Promise.all(Array.from({ length: ATTEMPTS }, (_, i) => createMember(`promo-max-${i}`)));
      const results = await Promise.all(
        members.map((m) =>
          as(ownerToken).post('/payments/sell', {
            studioId: ZEN,
            memberId: m.memberId,
            packageDefinitionId: sessionPackageId,
            paymentMethod: 'CASH',
            paidAmount: sessionPackagePrice,
            currency: 'TRY',
            promoCode: code,
          }),
        ),
      );
      results.forEach(trackSale);

      const succeeded = results.filter((r) => r.status === 201);
      const failed = results.filter((r) => r.status !== 201);
      expect(succeeded).toHaveLength(LIMIT);
      expect(failed).toHaveLength(ATTEMPTS - LIMIT);

      const dbCode = await prisma.promoCode.findUniqueOrThrow({ where: { id: create.body.id } });
      expect(dbCode.redeemedCount).toBe(LIMIT);
    });

    it('rejects a promo code combined with a bank transfer', async () => {
      const member = await createMember('promo-bank');
      const code = `E2EBANK${Date.now()}`;
      const create = await as(ownerToken).post('/promotions/promo-codes', { code, kind: 'PERCENT', value: 10 });
      createdPromoCodeIds.push(create.body.id);

      const res = await as(ownerToken).post('/payments/sell', {
        studioId: ZEN,
        memberId: member.memberId,
        packageDefinitionId: sessionPackageId,
        paymentMethod: 'BANK_TRANSFER',
        paidAmount: sessionPackagePrice,
        currency: 'TRY',
        bankReference: 'E2E-PROMO-BANK',
        promoCode: code,
      });
      expect(res.status).toBe(400);
    });
  });

  // ---------------------------------------------------------------------------
  // Gift cards
  // ---------------------------------------------------------------------------

  describe('gift cards', () => {
    it('issues a card, spends it partially, and leaves the remainder on a normal payment method', async () => {
      const purchaser = await createMember('gift-purchaser-1');
      const spender = await createMember('gift-spender-1');
      const issue = await as(ownerToken).post('/promotions/gift-cards', {
        studioId: ZEN,
        memberId: purchaser.memberId,
        initialAmount: 300,
        currency: 'TRY',
        paymentMethod: 'CASH',
      });
      expect(issue.status).toBe(201);
      createdGiftCardIds.push(issue.body.id);
      createdPaymentIds.push(issue.body.payment.id);
      const code: string = issue.body.code;
      expect(code).toHaveLength(16);

      const sale = await as(ownerToken).post('/payments/sell', {
        studioId: ZEN,
        memberId: spender.memberId,
        packageDefinitionId: sessionPackageId,
        paymentMethod: 'CASH',
        paidAmount: sessionPackagePrice,
        currency: 'TRY',
        giftCardCode: code,
        giftCardAmount: 300,
      });
      expect(sale.status).toBe(201);
      trackSale(sale.body);
      expect(Number(sale.body.payment.giftCardAmount)).toBe(300);
      expect(Number(sale.body.payment.amount)).toBe(sessionPackagePrice);

      const card = await prisma.giftCard.findUniqueOrThrow({ where: { id: issue.body.id } });
      expect(card.balance.toFixed(2)).toBe('0.00');
      expect(card.status).toBe('REDEEMED');
    });

    it('fully covers a sale when the balance is enough, charging nothing else', async () => {
      const purchaser = await createMember('gift-purchaser-2');
      const spender = await createMember('gift-spender-2');
      const issue = await as(ownerToken).post('/promotions/gift-cards', {
        studioId: ZEN,
        memberId: purchaser.memberId,
        initialAmount: sessionPackagePrice + 5000,
        currency: 'TRY',
        paymentMethod: 'CASH',
      });
      createdGiftCardIds.push(issue.body.id);
      createdPaymentIds.push(issue.body.payment.id);

      const sale = await as(ownerToken).post('/payments/sell', {
        studioId: ZEN,
        memberId: spender.memberId,
        packageDefinitionId: sessionPackageId,
        paymentMethod: 'CASH',
        paidAmount: sessionPackagePrice,
        currency: 'TRY',
        giftCardCode: issue.body.code,
      });
      expect(sale.status).toBe(201);
      trackSale(sale.body);
      expect(Number(sale.body.payment.giftCardAmount)).toBeCloseTo(sessionPackagePrice, 2);
      expect(sale.body.memberPackage.status).toBe('ACTIVE');

      const card = await prisma.giftCard.findUniqueOrThrow({ where: { id: issue.body.id } });
      expect(card.balance.toFixed(2)).toBe('5000.00');
    });

    it('member self-service can check a gift card balance by code', async () => {
      const purchaser = await createMember('gift-purchaser-3');
      const issue = await as(ownerToken).post('/promotions/gift-cards', {
        studioId: ZEN,
        memberId: purchaser.memberId,
        initialAmount: 250,
        currency: 'TRY',
        paymentMethod: 'CASH',
      });
      createdGiftCardIds.push(issue.body.id);
      createdPaymentIds.push(issue.body.payment.id);

      const check = await as(memberToken).get(`/promotions/gift-cards/check?code=${issue.body.code}`);
      expect(check.status).toBe(200);
      expect(check.body.balance).toBe('250.00');
      expect(check.body.last4).toBe(issue.body.last4);
    });

    it('lets only one of two parallel spends of the exact balance succeed', async () => {
      const purchaser = await createMember('gift-purchaser-4');
      const spenderA = await createMember('gift-spender-4a');
      const spenderB = await createMember('gift-spender-4b');
      const issue = await as(ownerToken).post('/promotions/gift-cards', {
        studioId: ZEN,
        memberId: purchaser.memberId,
        initialAmount: 100,
        currency: 'TRY',
        paymentMethod: 'CASH',
      });
      createdGiftCardIds.push(issue.body.id);
      createdPaymentIds.push(issue.body.payment.id);

      const attempt = (spenderId: string) =>
        as(ownerToken).post('/payments/sell', {
          studioId: ZEN,
          memberId: spenderId,
          packageDefinitionId: sessionPackageId,
          paymentMethod: 'CASH',
          paidAmount: sessionPackagePrice,
          currency: 'TRY',
          giftCardCode: issue.body.code,
          giftCardAmount: 100,
        });

      const [a, b] = await Promise.all([attempt(spenderA.memberId), attempt(spenderB.memberId)]);
      [a, b].forEach(trackSale);
      const succeeded = [a, b].filter((r) => r.status === 201);
      const failed = [a, b].filter((r) => r.status !== 201);
      expect(succeeded).toHaveLength(1);
      expect(failed).toHaveLength(1);

      const card = await prisma.giftCard.findUniqueOrThrow({ where: { id: issue.body.id } });
      expect(card.balance.toFixed(2)).toBe('0.00');
    });

    it('returns the gift-card portion of a payment to the card on refund', async () => {
      const purchaser = await createMember('gift-purchaser-5');
      const spender = await createMember('gift-spender-5');
      const issue = await as(ownerToken).post('/promotions/gift-cards', {
        studioId: ZEN,
        memberId: purchaser.memberId,
        initialAmount: 400,
        currency: 'TRY',
        paymentMethod: 'CASH',
      });
      createdGiftCardIds.push(issue.body.id);
      createdPaymentIds.push(issue.body.payment.id);

      const sale = await as(ownerToken).post('/payments/sell', {
        studioId: ZEN,
        memberId: spender.memberId,
        packageDefinitionId: sessionPackageId,
        paymentMethod: 'CASH',
        paidAmount: sessionPackagePrice,
        currency: 'TRY',
        giftCardCode: issue.body.code,
        giftCardAmount: 400,
      });
      expect(sale.status).toBe(201);
      trackSale(sale.body);

      const afterSaleCard = await prisma.giftCard.findUniqueOrThrow({ where: { id: issue.body.id } });
      expect(afterSaleCard.balance.toFixed(2)).toBe('0.00');

      const refund = await as(ownerToken).post(`/payments/${sale.body.payment.id}/refund`, { reason: 'e2e gift card refund' });
      expect(refund.status).toBe(201);
      expect(refund.body.paymentStatus).toBe('REFUNDED');

      const afterRefundCard = await prisma.giftCard.findUniqueOrThrow({ where: { id: issue.body.id } });
      expect(afterRefundCard.balance.toFixed(2)).toBe('400.00');
      expect(afterRefundCard.status).toBe('ACTIVE');
    });

    it('audits a manual cancel', async () => {
      const purchaser = await createMember('gift-purchaser-6');
      const issue = await as(ownerToken).post('/promotions/gift-cards', {
        studioId: ZEN,
        memberId: purchaser.memberId,
        initialAmount: 50,
        currency: 'TRY',
        paymentMethod: 'CASH',
      });
      createdGiftCardIds.push(issue.body.id);
      createdPaymentIds.push(issue.body.payment.id);

      const cancel = await as(ownerToken).post(`/promotions/gift-cards/${issue.body.id}/cancel`);
      expect(cancel.status).toBe(201);
      expect(cancel.body.status).toBe('CANCELLED');

      const log = await prisma.auditLog.findFirst({ where: { studioId: ZEN, action: 'promotions.gift_card.cancel', entityId: issue.body.id } });
      expect(log).not.toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Permission and cross-tenant denials
  // ---------------------------------------------------------------------------

  describe('permission and cross-tenant denials', () => {
    it('a trainer cannot create a promo code (needs promotions.manage)', async () => {
      const res = await as(trainerToken).post('/promotions/promo-codes', { code: `E2EPERM${Date.now()}`, kind: 'PERCENT', value: 10 });
      expect(res.status).toBe(403);
    });

    it('a trainer cannot issue a gift card (needs promotions.manage)', async () => {
      const res = await as(trainerToken).post('/promotions/gift-cards', {
        studioId: ZEN,
        memberId,
        initialAmount: 100,
        currency: 'TRY',
        paymentMethod: 'CASH',
      });
      expect(res.status).toBe(403);
    });

    it('a member cannot list promo codes (needs promotions.manage)', async () => {
      const res = await as(memberToken).get('/promotions/promo-codes');
      expect(res.status).toBe(403);
    });

    it('cannot fetch a promo code by id from another studio\'s tenant context', async () => {
      const code = `E2ECROSS${Date.now()}`;
      const create = await as(ownerToken).post('/promotions/promo-codes', { code, kind: 'PERCENT', value: 10 });
      createdPromoCodeIds.push(create.body.id);

      const res = await as(flowOwnerToken, FLOW).get(`/promotions/promo-codes/${create.body.id}`);
      expect(res.status).toBe(404);
    });

    it('rejects selling another studio\'s package with a ZEN promo code', async () => {
      const code = `E2ECROSS2${Date.now()}`;
      const create = await as(ownerToken).post('/promotions/promo-codes', { code, kind: 'PERCENT', value: 10 });
      createdPromoCodeIds.push(create.body.id);

      const res = await as(ownerToken).post('/payments/sell', {
        studioId: ZEN,
        memberId,
        packageDefinitionId: flowPackageId,
        paymentMethod: 'CASH',
        paidAmount: 100,
        currency: 'TRY',
        promoCode: code,
      });
      expect(res.status).toBe(404);
    });
  });
});
