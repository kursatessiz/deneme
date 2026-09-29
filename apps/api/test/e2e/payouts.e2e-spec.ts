import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { PaymentMethod, PaymentStatus, PrismaClient } from '@platform/database';
import { BUNDLED_MESSAGES } from '@platform/shared';
import { AppModule } from '../../src/app.module';
import { MockPaymentProvider } from '../../src/modules/payments/providers/mock-payment.provider';
import { PayoutSyncService } from '../../src/modules/payouts/payout-sync.service';
import { parseSheetCells, readZipText } from '../../src/modules/accounting/xlsx/xlsx-test-reader';
import type { ParsedCell } from '../../src/modules/accounting/xlsx/xlsx-test-reader';

/**
 * G5d-2 bank payouts and reconciliation end to end (docs/BANKA_ODEMELERI.md):
 * permissions (owner only by default), tenant isolation, sync with the MOCK
 * provider (idempotent, automatic matching by provider reference, refunds
 * through the original charge), manual match and unmatch with audit rows
 * (a removed match is not re-linked by the next sync), restricted mode,
 * listing filters, the CSV and XLSX exports and the background sync throttle.
 *
 * Test payments carry the provider reference prefix "mock_chg_E2EPO" and the
 * receipt prefix "E2EPO"; the seeded demo payouts (mock_po_seed_*) are read
 * but never changed. afterAll removes everything the suite created, so it
 * passes twice in a row on the same database.
 */

const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Demo1234!';
const OWNER_PHONE = '+905321000002';
const RECEPTION_PHONE = '+905321000003';
const TRAINER_PHONE = '+905321000004';
const FLOW_OWNER_PHONE = '+905321000022';
const NOVA_OWNER_PHONE = '+905329900001';
const REF = 'mock_chg_E2EPO';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

interface PayoutBody {
  id: string;
  provider: string;
  providerPayoutId: string;
  status: string;
  grossAmount: string;
  feeAmount: string;
  refundAmount: string;
  netAmount: string;
  currency: string;
  itemCount: number;
  matchedItemCount: number;
  matchableItemCount: number;
  reconciliationStatus: string;
}
interface ItemBody {
  id: string;
  type: string;
  providerReference: string | null;
  relatedReference: string | null;
  amount: string;
  matchSource: string | null;
  payment: { id: string; receiptNumber: string | null } | null;
}
interface DetailBody extends PayoutBody {
  items: ItemBody[];
  itemsNetAmount: string;
  netDifference: string;
}

describe('Bank payouts G5d-2 (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let server: Parameters<typeof request>[0];

  let ZEN: string;
  let FLOW: string;
  let NOVA: string;
  let cur: string;
  let other: string;
  let memberId: string;
  let flowMemberId: string;
  let ownerToken: string;
  let receptionToken: string;
  let trainerToken: string;
  let flowOwnerToken: string;
  let novaOwnerToken: string;
  let ownerUserId: string;
  let zenShort: string;
  let novaStatus: string;

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
  const download = (token: string, studioId: string, query: string, pathStudioId = studioId) =>
    request(server)
      .get(`/studios/${pathStudioId}/payouts/export?${query}`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-studio-id', studioId)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });

  const makePayment = (studioId: string, memberProfileId: string, data: { key: string; amount: string; currency?: string; reference?: string | null }) =>
    prisma.payment.create({
      data: {
        studioId,
        memberId: memberProfileId,
        amount: data.amount,
        currency: data.currency ?? cur,
        paymentMethod: PaymentMethod.ONLINE_STRIPE,
        paymentStatus: PaymentStatus.COMPLETED,
        provider: data.reference === null ? null : 'MOCK',
        providerReference: data.reference === undefined ? `${REF}_${data.key}` : data.reference,
        receiptNumber: `E2EPO-${data.key}`,
      },
    });

  const ledger = (studioId: string, type: 'CHARGE' | 'REFUND', reference: string, amount: number, relatedReference: string | null = null, currency = cur) =>
    MockPaymentProvider.recordLedger({ studioId, type, reference, relatedReference, amount, currency, at: new Date() });

  const myPayout = async (studioId: string) => {
    const list = await as(ownerToken, studioId).get(`/studios/${studioId}/payouts?pageSize=100&provider=MOCK`);
    expect(list.status).toBe(200);
    return (list.body.items as PayoutBody[]).find((p) => p.providerPayoutId.startsWith(`mock_po_${zenShort}_${cur}_`));
  };

  async function cleanup() {
    for (const studioId of [ZEN, FLOW, NOVA]) {
      if (!studioId) continue;
      await prisma.payout.deleteMany({ where: { studioId, providerPayoutId: { startsWith: 'mock_po_' }, NOT: { providerPayoutId: { startsWith: 'mock_po_seed_' } } } });
      await prisma.payoutConnection.deleteMany({ where: { studioId } });
    }
    const payments = await prisma.payment.findMany({ where: { receiptNumber: { startsWith: 'E2EPO' } }, select: { id: true } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ entityType: 'Payout', action: { startsWith: 'payouts.' }, studioId: { in: [ZEN, FLOW] } }, { action: 'payouts.export', studioId: { in: [ZEN, FLOW] } }] } });
    await prisma.payment.deleteMany({ where: { id: { in: payments.map((p) => p.id) } } });
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
    zenShort = ZEN.replace(/-/g, '').slice(0, 8);
    FLOW = (await prisma.studio.findUniqueOrThrow({ where: { slug: 'flow-pilates-wellness' } })).id;
    NOVA = (await prisma.user.findFirstOrThrow({ where: { phone: NOVA_OWNER_PHONE }, include: { memberships: true } })).memberships[0].studioId;
    novaStatus = (await prisma.studio.findUniqueOrThrow({ where: { id: NOVA } })).billingStatus;
    memberId = (await prisma.memberProfile.findFirstOrThrow({ where: { studioId: ZEN } })).id;
    flowMemberId = (await prisma.memberProfile.findFirstOrThrow({ where: { studioId: FLOW } })).id;
    ownerUserId = (await prisma.user.findFirstOrThrow({ where: { phone: OWNER_PHONE } })).id;
    ownerToken = await login(OWNER_PHONE);
    receptionToken = await login(RECEPTION_PHONE);
    trainerToken = await login(TRAINER_PHONE);
    flowOwnerToken = await login(FLOW_OWNER_PHONE);
    novaOwnerToken = await login(NOVA_OWNER_PHONE);
    await cleanup();
    MockPaymentProvider.clearLedger();
  });

  afterAll(async () => {
    await prisma.studio.update({ where: { id: NOVA }, data: { billingStatus: novaStatus as 'TRIALING' } }).catch(() => undefined);
    await cleanup();
    MockPaymentProvider.clearLedger();
    await prisma.$disconnect();
    await app.close();
  });

  // ---------------------------------------------------------------------------
  // Permissions
  // ---------------------------------------------------------------------------

  it('is owner only by default: reception, trainer and anonymous callers are refused everywhere', async () => {
    const some = '11111111-1111-4111-8111-111111111111';
    for (const token of [receptionToken, trainerToken]) {
      const a = as(token, ZEN);
      expect((await a.get(`/studios/${ZEN}/payouts`)).status).toBe(403);
      expect((await a.get(`/studios/${ZEN}/payouts/connections`)).status).toBe(403);
      expect((await a.get(`/studios/${ZEN}/payouts/${some}`)).status).toBe(403);
      expect((await a.post(`/studios/${ZEN}/payouts/sync`)).status).toBe(403);
      expect((await a.patch(`/studios/${ZEN}/payouts/connections/STRIPE`).send({ providerAccountId: 'acct_x' })).status).toBe(403);
      expect((await a.get(`/studios/${ZEN}/payouts/${some}/items/${some}/candidates`)).status).toBe(403);
      expect((await a.post(`/studios/${ZEN}/payouts/${some}/items/${some}/match`).send({ paymentId: some })).status).toBe(403);
      expect((await a.delete(`/studios/${ZEN}/payouts/${some}/items/${some}/match`)).status).toBe(403);
      expect((await download(token, ZEN, 'kind=payouts&format=csv')).status).toBe(403);
    }
    expect((await request(server).get(`/studios/${ZEN}/payouts`)).status).toBe(401);
    const roles = await prisma.roleTemplate.findMany({ where: { studioId: ZEN, key: { in: ['reception', 'trainer'] } }, include: { permissions: true } });
    for (const role of roles) expect(role.permissions.map((p) => p.permissionKey)).not.toContain('payouts.view');
    const owner = await prisma.roleTemplate.findFirstOrThrow({ where: { studioId: ZEN, isOwner: true }, include: { permissions: true } });
    expect(owner.permissions.map((p) => p.permissionKey)).toEqual(expect.arrayContaining(['payouts.view', 'payouts.manage']));
  });

  // ---------------------------------------------------------------------------
  // Seeded demo payouts: listing, filters, detail
  // ---------------------------------------------------------------------------

  it('lists the seeded payouts with filters and pagination', async () => {
    const a = as(ownerToken, ZEN);
    const all = await a.get(`/studios/${ZEN}/payouts?pageSize=100`);
    expect(all.status).toBe(200);
    const ids = (all.body.items as PayoutBody[]).map((p) => p.providerPayoutId);
    expect(ids).toEqual(expect.arrayContaining(['mock_po_seed_a', 'mock_po_seed_b', 'mock_po_seed_c']));
    expect(all.body).toMatchObject({ page: 1, pageSize: 100 });
    const arrival = (all.body.items as { arrivalDate: string }[]).map((p) => p.arrivalDate);
    expect([...arrival].sort().reverse()).toEqual(arrival);

    const partial = await a.get(`/studios/${ZEN}/payouts?reconciliationStatus=PARTIAL&provider=MOCK`);
    expect((partial.body.items as PayoutBody[]).map((p) => p.providerPayoutId)).toContain('mock_po_seed_b');
    expect((partial.body.items as PayoutBody[]).every((p) => p.reconciliationStatus === 'PARTIAL')).toBe(true);

    const matched = await a.get(`/studios/${ZEN}/payouts?reconciliationStatus=MATCHED`);
    expect((matched.body.items as PayoutBody[]).map((p) => p.providerPayoutId)).toContain('mock_po_seed_a');
    expect((matched.body.items as PayoutBody[]).map((p) => p.providerPayoutId)).not.toContain('mock_po_seed_b');

    expect(((await a.get(`/studios/${ZEN}/payouts?provider=IYZICO`)).body.items as PayoutBody[]).length).toBe(0);
    const pending = await a.get(`/studios/${ZEN}/payouts?status=PENDING`);
    expect((pending.body.items as PayoutBody[]).map((p) => p.providerPayoutId)).toContain('mock_po_seed_c');

    const page = await a.get(`/studios/${ZEN}/payouts?pageSize=1&page=2`);
    expect(page.body.items).toHaveLength(1);
    expect(page.body.total).toBeGreaterThanOrEqual(3);

    const future = new Date(Date.now() + 400 * 24 * 3600_000).toISOString();
    expect((await a.get(`/studios/${ZEN}/payouts?from=${encodeURIComponent(future)}`)).body.items).toHaveLength(0);

    expect((await a.get(`/studios/${ZEN}/payouts?provider=PAYPAL`)).status).toBe(400);
    expect((await a.get(`/studios/${ZEN}/payouts?pageSize=1000`)).status).toBe(400);
  });

  it('shows the items, matched payments and the arithmetic of a seeded payout', async () => {
    const a = as(ownerToken, ZEN);
    const list = await a.get(`/studios/${ZEN}/payouts?pageSize=100`);
    const seedA = (list.body.items as PayoutBody[]).find((p) => p.providerPayoutId === 'mock_po_seed_a') as PayoutBody;
    const res = await a.get(`/studios/${ZEN}/payouts/${seedA.id}`);
    expect(res.status).toBe(200);
    const detail = res.body as DetailBody;
    expect(detail).toMatchObject({ currency: cur, itemCount: 3, matchedItemCount: 3, reconciliationStatus: 'MATCHED', grossAmount: '2000.00', feeAmount: '58.00', refundAmount: '150.00', netAmount: '1792.00' });
    expect(detail.itemsNetAmount).toBe('1792.00');
    expect(detail.netDifference).toBe('0.00');
    expect(detail.items.map((i) => i.type)).toEqual(['CHARGE', 'CHARGE', 'REFUND']);
    expect(detail.items.every((i) => i.payment !== null && i.matchSource === 'AUTO')).toBe(true);
    // The refund is linked to the payment of its original charge.
    expect(detail.items[2].payment?.id).toBe(detail.items[1].payment?.id);
  });

  it('answers 404 for an unknown payout and 400 for a malformed id', async () => {
    const a = as(ownerToken, ZEN);
    expect((await a.get(`/studios/${ZEN}/payouts/11111111-1111-4111-8111-111111111111`)).status).toBe(404);
    expect((await a.get(`/studios/${ZEN}/payouts/not-a-uuid`)).status).toBe(400);
  });

  // ---------------------------------------------------------------------------
  // Sync with the MOCK provider, automatic matching, idempotency
  // ---------------------------------------------------------------------------

  let payoutId: string;
  let unmatchedItemId: string;
  let refundItemId: string;
  let pay1: string;

  it('syncs the mock provider: one payout per day and currency, charges and refunds matched by reference', async () => {
    const p1 = await makePayment(ZEN, memberId, { key: '1', amount: '100.00' });
    pay1 = p1.id;
    ledger(ZEN, 'CHARGE', `${REF}_1`, 100);
    ledger(ZEN, 'CHARGE', `${REF}_2`, 50); // no payment of ours: stays unmatched
    ledger(ZEN, 'REFUND', 'mock_rfnd_E2EPO_1', 20, `${REF}_1`); // matched through the original charge

    const res = await as(ownerToken, ZEN).post(`/studios/${ZEN}/payouts/sync`);
    expect(res.status).toBe(200);
    const mockResult = (res.body.results as { provider: string; outcome: string; payouts: number; items: number; matched: number }[]).find((r) => r.provider === 'MOCK');
    expect(mockResult).toEqual({ provider: 'MOCK', outcome: 'SYNCED', payouts: 1, items: 3, matched: 2 });

    const payout = (await myPayout(ZEN)) as PayoutBody;
    expect(payout).toMatchObject({
      provider: 'MOCK',
      status: 'PENDING',
      currency: cur,
      itemCount: 3,
      matchableItemCount: 3,
      matchedItemCount: 2,
      reconciliationStatus: 'PARTIAL',
      grossAmount: '150.00',
      feeAmount: '4.35',
      refundAmount: '20.00',
      netAmount: '125.65',
    });
    payoutId = payout.id;

    const detail = (await as(ownerToken, ZEN).get(`/studios/${ZEN}/payouts/${payoutId}`)).body as DetailBody;
    expect(detail.netDifference).toBe('0.00');
    const byRef = (ref: string) => detail.items.find((i) => i.providerReference === ref) as ItemBody;
    expect(byRef(`${REF}_1`).payment?.id).toBe(pay1);
    expect(byRef('mock_rfnd_E2EPO_1')).toMatchObject({ type: 'REFUND', amount: '-20.00', relatedReference: `${REF}_1` });
    expect(byRef('mock_rfnd_E2EPO_1').payment?.id).toBe(pay1);
    expect(byRef(`${REF}_2`).payment).toBeNull();
    unmatchedItemId = byRef(`${REF}_2`).id;
    refundItemId = byRef('mock_rfnd_E2EPO_1').id;
  });

  it('is idempotent: a second sync changes nothing and adds nothing', async () => {
    const before = await prisma.payoutItem.count({ where: { studioId: ZEN, payoutId } });
    const res = await as(ownerToken, ZEN).post(`/studios/${ZEN}/payouts/sync`);
    expect(res.status).toBe(200);
    expect((res.body.results as { provider: string; outcome: string; matched: number }[]).find((r) => r.provider === 'MOCK')).toMatchObject({ outcome: 'SYNCED', matched: 0 });
    expect(await prisma.payoutItem.count({ where: { studioId: ZEN, payoutId } })).toBe(before);
    expect(await prisma.payout.count({ where: { studioId: ZEN, provider: 'MOCK', providerPayoutId: { startsWith: `mock_po_${zenShort}_${cur}_` } } })).toBe(1);
    expect(await myPayout(ZEN)).toMatchObject({ id: payoutId, reconciliationStatus: 'PARTIAL', matchedItemCount: 2 });

    const connection = await as(ownerToken, ZEN).get(`/studios/${ZEN}/payouts/connections`);
    const mockConnection = (connection.body.items as { provider: string; supported: boolean; lastSyncedAt: string | null; lastError: string | null }[]).find((c) => c.provider === 'MOCK');
    expect(mockConnection).toMatchObject({ supported: true, lastError: null });
    expect(mockConnection?.lastSyncedAt).not.toBeNull();
  });

  it('picks up a new charge later and links a payment that appears after the first sync', async () => {
    ledger(ZEN, 'CHARGE', `${REF}_3`, 30);
    const late = await makePayment(ZEN, memberId, { key: '3', amount: '30.00' });
    void late;
    const res = await as(ownerToken, ZEN).post(`/studios/${ZEN}/payouts/sync`);
    expect((res.body.results as { provider: string; items: number; matched: number }[]).find((r) => r.provider === 'MOCK')).toMatchObject({ items: 4, matched: 1 });
    expect(await myPayout(ZEN)).toMatchObject({ id: payoutId, itemCount: 4, matchedItemCount: 3, grossAmount: '180.00', reconciliationStatus: 'PARTIAL' });
  });

  // ---------------------------------------------------------------------------
  // Manual match and unmatch
  // ---------------------------------------------------------------------------

  let manualPaymentId: string;

  it('lists payment candidates for an item, exact amounts first', async () => {
    const manual = await makePayment(ZEN, memberId, { key: 'M', amount: '50.00', reference: null });
    manualPaymentId = manual.id;
    await makePayment(ZEN, memberId, { key: 'N', amount: '77.00', reference: null });
    const res = await as(ownerToken, ZEN).get(`/studios/${ZEN}/payouts/${payoutId}/items/${unmatchedItemId}/candidates`);
    expect(res.status).toBe(200);
    const items = res.body.items as { id: string; exactAmount: boolean; amount: string; currency: string }[];
    expect(items[0]).toMatchObject({ id: manualPaymentId, exactAmount: true, amount: '50.00' });
    expect(items.some((c) => c.amount === '77.00' && !c.exactAmount)).toBe(true);
    expect(items.every((c) => c.currency === cur)).toBe(true);
  });

  it('matches an item by hand: audit logged, payout becomes matched, guards enforced', async () => {
    const a = as(ownerToken, ZEN);
    const res = await a.post(`/studios/${ZEN}/payouts/${payoutId}/items/${unmatchedItemId}/match`).send({ paymentId: manualPaymentId });
    expect(res.status).toBe(200);
    const detail = res.body as DetailBody;
    expect(detail).toMatchObject({ matchedItemCount: 4, reconciliationStatus: 'MATCHED' });
    expect(detail.items.find((i) => i.id === unmatchedItemId)).toMatchObject({ matchSource: 'MANUAL', payment: { id: manualPaymentId } });
    const audit = await prisma.auditLog.findFirst({ where: { studioId: ZEN, action: 'payouts.match', entityId: payoutId, userId: ownerUserId } });
    expect(audit?.metadata).toMatchObject({ itemId: unmatchedItemId, paymentId: manualPaymentId });

    // A payment in another currency, of another studio, a malformed body and a fee line are all refused.
    const usd = await makePayment(ZEN, memberId, { key: 'USD', amount: '50.00', currency: other, reference: null });
    expect((await a.post(`/studios/${ZEN}/payouts/${payoutId}/items/${unmatchedItemId}/match`).send({ paymentId: usd.id })).status).toBe(409);
    const foreign = await makePayment(FLOW, flowMemberId, { key: 'F', amount: '50.00', reference: null });
    expect((await a.post(`/studios/${ZEN}/payouts/${payoutId}/items/${unmatchedItemId}/match`).send({ paymentId: foreign.id })).status).toBe(404);
    expect((await a.post(`/studios/${ZEN}/payouts/${payoutId}/items/${unmatchedItemId}/match`).send({ paymentId: 'nope' })).status).toBe(400);
    expect((await a.post(`/studios/${ZEN}/payouts/${payoutId}/items/${unmatchedItemId}/match`).send({ paymentId: manualPaymentId, extra: 1 })).status).toBe(400);
    const fee = await prisma.payoutItem.create({
      data: { studioId: ZEN, payoutId, providerItemId: 'mock_txn_e2epo_fee', type: 'FEE', amount: '-1.00', fee: '0', net: '-1.00', currency: cur, occurredAt: new Date() },
    });
    expect((await a.post(`/studios/${ZEN}/payouts/${payoutId}/items/${fee.id}/match`).send({ paymentId: manualPaymentId })).status).toBe(400);
    await prisma.payoutItem.delete({ where: { id: fee.id } });
    expect((await a.post(`/studios/${ZEN}/payouts/${payoutId}/items/11111111-1111-4111-8111-111111111111/match`).send({ paymentId: manualPaymentId })).status).toBe(404);
  });

  it('unmatches: payout is partial again, audit logged, and a later sync does not re-link it', async () => {
    const a = as(ownerToken, ZEN);
    const res = await a.delete(`/studios/${ZEN}/payouts/${payoutId}/items/${unmatchedItemId}/match`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ matchedItemCount: 3, reconciliationStatus: 'PARTIAL' });
    expect((res.body as DetailBody).items.find((i) => i.id === unmatchedItemId)).toMatchObject({ matchSource: 'UNMATCHED_MANUAL', payment: null });
    expect(await prisma.auditLog.count({ where: { studioId: ZEN, action: 'payouts.unmatch', entityId: payoutId } })).toBe(1);

    // A payment carrying exactly the item's reference now exists; the hand-made decision still stands.
    await makePayment(ZEN, memberId, { key: '2', amount: '50.00' });
    const sync = await a.post(`/studios/${ZEN}/payouts/sync`);
    expect((sync.body.results as { provider: string; matched: number }[]).find((r) => r.provider === 'MOCK')?.matched).toBe(0);
    const after = (await a.get(`/studios/${ZEN}/payouts/${payoutId}`)).body as DetailBody;
    expect(after.items.find((i) => i.id === unmatchedItemId)?.payment).toBeNull();
    expect(after.reconciliationStatus).toBe('PARTIAL');

    // Refund items can be re-matched by hand as well (to the payment of their original charge).
    const rematch = await a.post(`/studios/${ZEN}/payouts/${payoutId}/items/${refundItemId}/match`).send({ paymentId: pay1 });
    expect(rematch.status).toBe(200);
    expect((rematch.body as DetailBody).items.find((i) => i.id === refundItemId)).toMatchObject({ matchSource: 'MANUAL' });
  });

  // ---------------------------------------------------------------------------
  // Tenant isolation
  // ---------------------------------------------------------------------------

  it('keeps studios apart: another studio sees none of it and cannot touch it', async () => {
    const flow = as(flowOwnerToken, FLOW);
    const list = await flow.get(`/studios/${FLOW}/payouts?pageSize=100`);
    expect(list.status).toBe(200);
    expect((list.body.items as PayoutBody[]).map((p) => p.providerPayoutId).filter((id) => id.startsWith('mock_po_'))).toEqual([]);

    expect((await flow.get(`/studios/${FLOW}/payouts/${payoutId}`)).status).toBe(404);
    expect((await flow.get(`/studios/${FLOW}/payouts/${payoutId}/items/${unmatchedItemId}/candidates`)).status).toBe(404);
    expect((await flow.post(`/studios/${FLOW}/payouts/${payoutId}/items/${unmatchedItemId}/match`).send({ paymentId: manualPaymentId })).status).toBe(404);
    expect((await flow.delete(`/studios/${FLOW}/payouts/${payoutId}/items/${unmatchedItemId}/match`)).status).toBe(404);
    // Another studio's id in the path with our own header is refused by the tenant guard.
    expect((await flow.get(`/studios/${ZEN}/payouts`)).status).toBe(403);
    expect((await flow.post(`/studios/${ZEN}/payouts/sync`)).status).toBe(403);
    expect((await download(flowOwnerToken, FLOW, 'kind=payouts&format=csv', ZEN)).status).toBe(403);

    // Zen's ledger never leaks into Flow's sync, and a Flow sync writes only Flow rows.
    await flow.post(`/studios/${FLOW}/payouts/sync`);
    expect(await prisma.payout.count({ where: { studioId: FLOW, providerPayoutId: { contains: zenShort } } })).toBe(0);
    const zenPayoutStillOne = await prisma.payout.count({ where: { studioId: ZEN, provider: 'MOCK', providerPayoutId: { startsWith: `mock_po_${zenShort}_` } } });
    expect(zenPayoutStillOne).toBe(1);

    // Export of Flow does not contain Zen's payouts either.
    const csv = await download(flowOwnerToken, FLOW, 'kind=payouts&format=csv');
    expect(csv.status).toBe(200);
    expect((csv.body as Buffer).toString('utf8')).not.toContain('mock_po_seed_a');
  });

  // ---------------------------------------------------------------------------
  // Connections
  // ---------------------------------------------------------------------------

  it('stores the provider account id and validates it', async () => {
    const a = as(ownerToken, ZEN);
    const ok = await a.patch(`/studios/${ZEN}/payouts/connections/STRIPE`).send({ providerAccountId: 'acct_e2e_1' });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ provider: 'STRIPE', providerAccountId: 'acct_e2e_1', supported: true });
    const list = await a.get(`/studios/${ZEN}/payouts/connections`);
    expect((list.body.items as { provider: string; providerAccountId: string | null }[]).find((c) => c.provider === 'STRIPE')?.providerAccountId).toBe('acct_e2e_1');
    expect((await a.patch(`/studios/${ZEN}/payouts/connections/STRIPE`).send({ providerAccountId: 'acct e2e' })).status).toBe(400);
    expect((await a.patch(`/studios/${ZEN}/payouts/connections/PAYPAL`).send({ providerAccountId: 'acct_x' })).status).toBe(400);
    expect((await a.patch(`/studios/${ZEN}/payouts/connections/STRIPE`).send({ providerAccountId: null })).body.providerAccountId).toBeNull();
    await prisma.payoutConnection.deleteMany({ where: { studioId: ZEN, provider: 'STRIPE' } });
  });

  it('reports a provider without a payout adapter as unsupported, not as an error', async () => {
    await prisma.payoutConnection.create({ data: { studioId: ZEN, provider: 'IYZICO' } });
    const a = as(ownerToken, ZEN);
    const connections = await a.get(`/studios/${ZEN}/payouts/connections`);
    expect((connections.body.items as { provider: string; supported: boolean }[]).find((c) => c.provider === 'IYZICO')?.supported).toBe(false);
    const res = await a.post(`/studios/${ZEN}/payouts/sync`);
    expect(res.status).toBe(200);
    expect((res.body.results as { provider: string; outcome: string }[]).find((r) => r.provider === 'IYZICO')?.outcome).toBe('UNSUPPORTED');
    await prisma.payoutConnection.deleteMany({ where: { studioId: ZEN, provider: 'IYZICO' } });
  });

  // ---------------------------------------------------------------------------
  // Restricted mode
  // ---------------------------------------------------------------------------

  it('refuses writes in restricted mode but keeps reading and exporting', async () => {
    await prisma.studio.update({ where: { id: NOVA }, data: { billingStatus: 'RESTRICTED' } });
    try {
      const nova = as(novaOwnerToken, NOVA);
      const sync = await nova.post(`/studios/${NOVA}/payouts/sync`);
      expect(sync.status).toBe(403);
      expect(sync.body.code).toBe('BILLING_RESTRICTED');
      expect((await nova.get(`/studios/${NOVA}/payouts`)).status).toBe(200);
      expect((await download(novaOwnerToken, NOVA, 'kind=payouts&format=csv')).status).toBe(200);
    } finally {
      await prisma.studio.update({ where: { id: NOVA }, data: { billingStatus: novaStatus as 'TRIALING' } });
    }
  });

  // ---------------------------------------------------------------------------
  // Export
  // ---------------------------------------------------------------------------

  it('exports the payout list as CSV: BOM, translated header, delimiter, amounts', async () => {
    const res = await download(ownerToken, ZEN, 'kind=payouts&format=csv&locale=tr');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="payouts-payouts-\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.csv"/);
    const text = (res.body as Buffer).toString('utf8');
    expect(text.charCodeAt(0)).toBe(0xfeff);
    const lines = text.slice(1).trimEnd().split('\r\n');
    const columns = ['arrivalDate', 'provider', 'providerPayoutId', 'status', 'reconciliationStatus', 'itemCount', 'matchedItemCount', 'gross', 'fee', 'refund', 'net', 'currency'];
    expect(lines[0]).toBe(columns.map((k) => BUNDLED_MESSAGES.tr[`payouts.col.${k}`]).join(';'));
    const seedA = lines.find((l) => l.includes('mock_po_seed_a')) as string;
    const cells = seedA.split(';');
    expect(cells.slice(1, 5)).toEqual(['MOCK', 'mock_po_seed_a', 'PAID', 'MATCHED']);
    expect(cells.slice(5)).toEqual(['3', '3', '2000.00', '58.00', '150.00', '1792.00', cur]);

    const english = await download(ownerToken, ZEN, 'kind=payouts&format=csv&locale=en&delimiter=comma');
    expect((english.body as Buffer).toString('utf8').split('\r\n')[0]).toContain('Arrival date,Provider,Provider payout ID');
    expect((await download(ownerToken, ZEN, 'kind=payouts&format=json')).status).toBe(400);
    expect((await download(ownerToken, ZEN, 'kind=payouts&format=csv&from=2020-01-01&to=2023-01-01')).status).toBe(400);
  });

  it('exports an XLSX with one sheet per currency, numbers as numbers and a totals row', async () => {
    const res = await download(ownerToken, ZEN, 'kind=payouts&format=xlsx&locale=en');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe(XLSX);
    const files = readZipText(res.body as Buffer);
    const workbookXml = files.get('xl/workbook.xml') as string;
    const names = [...workbookXml.matchAll(/<sheet name="([^"]*)"/g)].map((m) => m[1]);
    expect(names).toContain(cur);
    const sheetXml = files.get(`xl/worksheets/sheet${names.indexOf(cur) + 1}.xml`) as string;
    expect(sheetXml).not.toMatch(/<f[\s>/]/);
    const rows = parseSheetCells(sheetXml);
    expect((rows.get(1) ?? [])[0].value).toBe('Arrival date');
    let seedRow: ParsedCell[] = [];
    for (const [n, cells] of rows) if (n > 1 && cells[2]?.value === 'mock_po_seed_a') seedRow = cells;
    expect(seedRow[0].t).toBe('n'); // date serial
    expect(seedRow[7].t).toBe('n');
    expect(Number(seedRow[7].value)).toBe(2000);
    expect(Number(seedRow[10].value)).toBe(1792);
    // Totals row: bold label in the first column, no formula.
    const last = [...rows.entries()].sort((x, y) => y[0] - x[0])[0][1];
    expect(last[0].value).toBe('Total');
  });

  it('exports the items, with the matched receipt number', async () => {
    // Pending payouts arrive tomorrow, so the range reaches past today.
    const soon = encodeURIComponent(new Date(Date.now() + 2 * 24 * 3600_000).toISOString());
    const res = await download(ownerToken, ZEN, `kind=items&format=csv&locale=tr&to=${soon}`);
    expect(res.status).toBe(200);
    const text = (res.body as Buffer).toString('utf8');
    const lines = text.slice(1).trimEnd().split('\r\n');
    expect(lines[0].split(';')[3]).toBe(BUNDLED_MESSAGES.tr['payouts.col.type']);
    const charge = lines.find((l) => l.includes(`${REF}_1`) && l.includes('CHARGE')) as string;
    expect(charge.split(';')).toEqual(expect.arrayContaining(['CHARGE', `${REF}_1`, '100.00', '2.90', '97.10', cur, 'E2EPO-1', pay1]));
    const refund = lines.find((l) => l.includes('mock_rfnd_E2EPO_1')) as string;
    expect(refund.split(';')).toEqual(expect.arrayContaining(['REFUND', '-20.00', '-20.00']));
    // Range filter: nothing arrived in the far past.
    const empty = await download(ownerToken, ZEN, 'kind=items&format=csv&from=2020-03-01T00:00:00Z&to=2020-03-31T00:00:00Z');
    expect((empty.body as Buffer).toString('utf8').trimEnd().split('\r\n')).toHaveLength(1);
    expect(await prisma.auditLog.count({ where: { studioId: ZEN, action: 'payouts.export' } })).toBeGreaterThanOrEqual(4);
  });

  // ---------------------------------------------------------------------------
  // Background sync
  // ---------------------------------------------------------------------------

  it('the background sync visits a studio and provider at most every six hours', async () => {
    const sync = app.get(PayoutSyncService);
    await prisma.payoutConnection.deleteMany({ where: { studioId: ZEN } });
    ledger(ZEN, 'CHARGE', `${REF}_4`, 10);
    const first = await sync.syncDue(new Date(), 100, ZEN);
    expect(first.failed).toBe(0);
    const connection = await prisma.payoutConnection.findUniqueOrThrow({ where: { studioId_provider: { studioId: ZEN, provider: 'MOCK' } } });
    expect(connection.lastSyncedAt).not.toBeNull();
    expect(await prisma.payoutItem.count({ where: { studioId: ZEN, providerReference: `${REF}_4` } })).toBe(1);

    // Within six hours nothing is due for this studio any more.
    ledger(ZEN, 'CHARGE', `${REF}_5`, 10);
    await sync.syncDue(new Date(), 100, ZEN);
    expect(await prisma.payoutItem.count({ where: { studioId: ZEN, providerReference: `${REF}_5` } })).toBe(0);
    // Seven hours later it is.
    await sync.syncDue(new Date(Date.now() + 7 * 3600_000), 100, ZEN);
    expect(await prisma.payoutItem.count({ where: { studioId: ZEN, providerReference: `${REF}_5` } })).toBe(1);
  });
});
