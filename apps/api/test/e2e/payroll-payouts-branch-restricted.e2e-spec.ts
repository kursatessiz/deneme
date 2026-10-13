import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { PrismaClient } from '@platform/database';
import { AppModule } from '../../src/app.module';

/**
 * Payroll and bank payouts are studio-wide: a branch-restricted member is
 * refused on every route even with the permissions, an unrestricted member is
 * served. The payout provider account is unique per provider across studios
 * and only the owner may change it (audit logged).
 */

const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Demo1234!';
const OWNER_PHONE = '+905321000002';
const RECEPTION_PHONE = '+905321000003';
const FLOW_OWNER_PHONE = '+905321000022';
const GRANTED = ['payroll.manage', 'commissions.view.all', 'payouts.view', 'payouts.manage'];
const ACCT = 'acct_e2e_branchrestricted';
const SOME = '11111111-1111-4111-8111-111111111111';

describe('Payroll and payouts: branch restriction and provider account (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let server: Parameters<typeof request>[0];
  let ZEN: string;
  let FLOW: string;
  let receptionMembershipId: string;
  let receptionRoleId: string;
  let branchId: string;
  let ownerToken: string;
  let receptionToken: string;
  let flowOwnerToken: string;
  let addedPermissions: string[] = [];

  const login = async (p: string) => {
    const res = await request(server).post('/auth/login').send({ emailOrPhone: p, password: DEMO_PASSWORD });
    expect(res.status).toBe(200);
    return res.body.accessToken as string;
  };
  const as = (token: string, studioId: string) => ({
    get: (url: string) => request(server).get(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId),
    post: (url: string) => request(server).post(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId),
    patch: (url: string) => request(server).patch(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId),
    delete: (url: string) => request(server).delete(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId),
  });

  async function cleanup() {
    await prisma.payoutConnection.deleteMany({ where: { studioId: { in: [ZEN, FLOW] }, providerAccountId: { startsWith: 'acct_e2e_' } } });
    await prisma.auditLog.deleteMany({ where: { studioId: { in: [ZEN, FLOW] }, action: { startsWith: 'payouts.account.' } } });
    await prisma.membershipBranch.deleteMany({ where: { membershipId: receptionMembershipId } });
    if (addedPermissions.length) {
      await prisma.roleTemplatePermission.deleteMany({ where: { roleTemplateId: receptionRoleId, permissionKey: { in: addedPermissions } } });
      addedPermissions = [];
    }
  }

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer();
    prisma = new PrismaClient();
    ZEN = (await prisma.studio.findUniqueOrThrow({ where: { slug: 'zen-reformer-pilates' } })).id;
    FLOW = (await prisma.studio.findUniqueOrThrow({ where: { slug: 'flow-pilates-wellness' } })).id;
    const user = await prisma.user.findFirstOrThrow({ where: { phone: RECEPTION_PHONE } });
    const membership = await prisma.membership.findFirstOrThrow({ where: { userId: user.id, studioId: ZEN } });
    receptionMembershipId = membership.id;
    receptionRoleId = membership.roleTemplateId;
    branchId = (await prisma.branch.findFirstOrThrow({ where: { studioId: ZEN } })).id;
    await cleanup();
    const existing = await prisma.roleTemplatePermission.findMany({ where: { roleTemplateId: receptionRoleId }, select: { permissionKey: true } });
    addedPermissions = GRANTED.filter((k) => !existing.some((e) => e.permissionKey === k));
    await prisma.roleTemplatePermission.createMany({ data: addedPermissions.map((permissionKey) => ({ roleTemplateId: receptionRoleId, permissionKey })) });
    ownerToken = await login(OWNER_PHONE);
    receptionToken = await login(RECEPTION_PHONE);
    flowOwnerToken = await login(FLOW_OWNER_PHONE);
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
    await app.close();
  });

  it('refuses a branch-restricted member on every payroll and payouts route', async () => {
    await prisma.membershipBranch.create({ data: { membershipId: receptionMembershipId, branchId, studioId: ZEN } });
    const a = as(receptionToken, ZEN);
    const payroll = `/payroll/studio/${ZEN}`;
    const payouts = `/studios/${ZEN}/payouts`;
    const period = { periodStart: '2025-03-01T00:00:00.000Z', periodEnd: '2025-03-31T23:59:59.000Z' };
    const responses = [
      await a.post(`${payroll}/runs`).send(period),
      await a.post(`${payroll}/runs`).send({ ...period, branchId }),
      await a.get(`${payroll}/runs`),
      await a.get(`${payroll}/runs/${SOME}`),
      await a.get(`${payroll}/runs/${SOME}/export.csv`),
      await a.patch(`${payroll}/runs/${SOME}/lines/${SOME}/adjust`).send({ amount: 1, note: 'e2e adjustment' }),
      await a.post(`${payroll}/runs/${SOME}/approve`),
      await a.post(`${payroll}/runs/${SOME}/mark-paid`),
      await a.get(payouts),
      await a.get(`${payouts}/connections`),
      await a.get(`${payouts}/${SOME}`),
      await a.post(`${payouts}/sync`),
      await a.get(`${payouts}/export?kind=payouts&format=csv`),
      await a.get(`${payouts}/${SOME}/items/${SOME}/candidates`),
      await a.post(`${payouts}/${SOME}/items/${SOME}/match`).send({ paymentId: SOME }),
      await a.delete(`${payouts}/${SOME}/items/${SOME}/match`),
      await a.patch(`${payouts}/connections/STRIPE`).send({ providerAccountId: ACCT }),
    ];
    for (const res of responses) {
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('apiErrors.branches.actionOnlyUsersAccessAllBranches');
    }
  });

  it('serves the same member once the branch restriction is lifted, except the provider account', async () => {
    await prisma.membershipBranch.deleteMany({ where: { membershipId: receptionMembershipId } });
    const a = as(receptionToken, ZEN);
    expect((await a.get(`/payroll/studio/${ZEN}/runs`)).status).toBe(200);
    expect((await a.get(`/studios/${ZEN}/payouts`)).status).toBe(200);
    expect((await a.get(`/studios/${ZEN}/payouts/connections`)).status).toBe(200);
    const set = await a.patch(`/studios/${ZEN}/payouts/connections/STRIPE`).send({ providerAccountId: ACCT });
    expect(set.status).toBe(403);
    expect(set.body.code).toBe('apiErrors.payouts.onlyOwnerCanChangeAccount');
  });

  it('owner sets, conflicts on a duplicate and clears the provider account with audit rows', async () => {
    const set = await as(ownerToken, ZEN).patch(`/studios/${ZEN}/payouts/connections/STRIPE`).send({ providerAccountId: ACCT });
    expect(set.status).toBe(200);
    expect(set.body.providerAccountId).toBe(ACCT);
    const setAudit = await prisma.auditLog.findMany({ where: { studioId: ZEN, action: 'payouts.account.set' } });
    expect(setAudit).toHaveLength(1);
    expect(setAudit[0].metadata).toMatchObject({ provider: 'STRIPE', accountId: ACCT, previousAccountId: null });

    // Same account on the same studio again is fine; another studio is refused.
    expect((await as(ownerToken, ZEN).patch(`/studios/${ZEN}/payouts/connections/STRIPE`).send({ providerAccountId: ACCT })).status).toBe(200);
    const dup = await as(flowOwnerToken, FLOW).patch(`/studios/${FLOW}/payouts/connections/STRIPE`).send({ providerAccountId: ACCT });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('apiErrors.payouts.accountAlreadyConnected');
    expect(await prisma.payoutConnection.count({ where: { studioId: FLOW, providerAccountId: ACCT } })).toBe(0);

    // The database index backs the check up.
    await expect(prisma.payoutConnection.create({ data: { studioId: FLOW, provider: 'STRIPE', providerAccountId: ACCT } })).rejects.toThrow();

    const clear = await as(ownerToken, ZEN).patch(`/studios/${ZEN}/payouts/connections/STRIPE`).send({ providerAccountId: null });
    expect(clear.status).toBe(200);
    expect(clear.body.providerAccountId).toBeNull();
    expect(await prisma.auditLog.count({ where: { studioId: ZEN, action: 'payouts.account.clear' } })).toBe(1);
    // Freed: now the other studio may take it.
    expect((await as(flowOwnerToken, FLOW).patch(`/studios/${FLOW}/payouts/connections/STRIPE`).send({ providerAccountId: ACCT })).status).toBe(200);
  });
});
