import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { PrismaClient } from '@platform/database';
import type { RetailSettings } from '@platform/database';
import { computeCartTotals, defaultRetailTaxRate } from '@platform/shared';
import { AppModule } from '../../src/app.module';

/**
 * G3c-2 retail and stock end to end (docs/PERAKENDE.md): permissions,
 * tenant isolation, currency and tax stored on products and sales, stock
 * receive/adjust/transfer with the append-only ledger, negative stock
 * refused, oversell prevention under concurrent checkouts, gapless receipt
 * numbers per studio, member sales through the payment, promo and loyalty
 * hooks, refunds that return stock and move the payment, voids, the
 * low-stock list and the sales report with CSV.
 *
 * Everything created is named "E2E RTL" (products, categories, promo
 * codes) or uses the +90539777 phone prefix, and is removed in afterAll;
 * the Zen retail settings are restored, so the suite passes twice in a row
 * on the same database.
 */

const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Demo1234!';
const PREFIX = '+90539777';
const NAME = 'E2E RTL';

interface SaleBody {
  id: string;
  receiptNumber: string;
  status: string;
  total: string;
  taxTotal: string;
  netTotal: string;
  currency: string;
  paymentId: string | null;
  refundedAmount: string;
  lines: { id: string; productId: string; quantity: number; taxRate: string; total: string; refundedQuantity: number }[];
}

describe('Retail G3c-2 (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let server: Parameters<typeof request>[0];

  let ZEN: string;
  let FLOW: string;
  let currency: string;
  let pricesIncludeTax: boolean;
  let defaultRate: string;
  let mainBranch: string;
  let secondBranch: string;
  let flowBranch: string;

  let ownerToken: string;
  let receptionToken: string;
  let trainerToken: string;
  let flowOwnerToken: string;

  let originalSettings: RetailSettings | null;
  let memberId: string;
  let memberUserId: string;

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
  const base = (studioId: string) => `/studios/${studioId}/retail`;
  const owner = () => as(ownerToken, ZEN);

  const stockOf = async (productId: string, branchId: string) =>
    (await prisma.stockLevel.findUnique({ where: { productId_branchId: { productId, branchId } } }))?.quantity ?? 0;

  async function createProduct(body: Record<string, unknown>, token = ownerToken, studioId = ZEN) {
    const res = await as(token, studioId).post(`${base(studioId)}/products`).send(body);
    return res;
  }

  async function stockedProduct(suffix: string, price: string, quantity: number, extra: Record<string, unknown> = {}) {
    const res = await createProduct({ name: `${NAME} ${suffix}`, price, ...extra });
    expect(res.status).toBe(201);
    if (quantity > 0) {
      const rec = await owner().post(`${base(ZEN)}/stock/receive`).send({ productId: res.body.id, branchId: mainBranch, quantity });
      expect(rec.status).toBe(201);
    }
    return res.body.id as string;
  }

  const sell = (lines: { productId: string; quantity: number; discount?: string }[], extra: Record<string, unknown> = {}, token = ownerToken) =>
    as(token, ZEN).post(`${base(ZEN)}/sales`).send({ branchId: mainBranch, lines, paymentMethod: 'CASH', ...extra });

  async function cleanup() {
    const products = await prisma.product.findMany({ where: { name: { startsWith: NAME } }, select: { id: true } });
    const productIds = products.map((p) => p.id);
    const sales = await prisma.sale.findMany({ where: { lines: { some: { productId: { in: productIds } } } }, select: { id: true, paymentId: true } });
    const paymentIds = sales.map((s) => s.paymentId).filter((id): id is string => Boolean(id));
    await prisma.sale.deleteMany({ where: { id: { in: sales.map((s) => s.id) } } });
    await prisma.loyaltyLedger.deleteMany({ where: { sourceType: 'payment', sourceId: { in: paymentIds } } });
    await prisma.payment.deleteMany({ where: { id: { in: paymentIds } } });
    await prisma.stockMovement.deleteMany({ where: { productId: { in: productIds } } });
    await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    await prisma.productCategory.deleteMany({ where: { name: { startsWith: NAME } } });
    await prisma.promoCode.deleteMany({ where: { code: { startsWith: 'E2ERTL' } } });

    const users = await prisma.user.findMany({ where: { phone: { startsWith: PREFIX } }, select: { id: true } });
    const userIds = users.map((u) => u.id);
    const contacts = await prisma.contact.findMany({ where: { phone: { startsWith: PREFIX } }, select: { id: true } });
    const contactIds = contacts.map((c) => c.id);
    await prisma.notificationLog.deleteMany({ where: { contactId: { in: contactIds } } });
    await prisma.contactTask.deleteMany({ where: { contactId: { in: contactIds } } });
    await prisma.contact.deleteMany({ where: { id: { in: contactIds } } });
    await prisma.payment.deleteMany({ where: { member: { membership: { userId: { in: userIds } } } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer();
    prisma = new PrismaClient();

    const zen = await prisma.studio.findUniqueOrThrow({
      where: { slug: 'zen-reformer-pilates' },
      include: { invoiceSettings: { select: { defaultVatRate: true } } },
    });
    ZEN = zen.id;
    currency = zen.currency;
    pricesIncludeTax = zen.pricesIncludeTax;
    defaultRate = defaultRetailTaxRate(zen.taxRegime, zen.invoiceSettings ? zen.invoiceSettings.defaultVatRate.toString() : null);
    FLOW = (await prisma.studio.findUniqueOrThrow({ where: { slug: 'flow-pilates-wellness' } })).id;
    const zenBranches = await prisma.branch.findMany({ where: { studioId: ZEN, isActive: true }, orderBy: { createdAt: 'asc' } });
    mainBranch = zenBranches[0].id;
    secondBranch = zenBranches[1].id;
    flowBranch = (await prisma.branch.findFirstOrThrow({ where: { studioId: FLOW } })).id;

    ownerToken = await login('+905321000002');
    receptionToken = await login('+905321000003');
    trainerToken = await login('+905321000004');
    flowOwnerToken = await login('+905321000022');

    await cleanup();
    originalSettings = await prisma.retailSettings.findUnique({ where: { studioId: ZEN } });
    await prisma.retailSettings.upsert({ where: { studioId: ZEN }, create: { studioId: ZEN }, update: { allowBackorder: false } });

    const role = await prisma.roleTemplate.findFirstOrThrow({ where: { studioId: ZEN, key: 'member' } });
    const template = await prisma.user.findFirstOrThrow({ where: { phone: '+905321000016' }, select: { passwordHash: true } });
    const user = await prisma.user.create({
      data: { phone: `${PREFIX}0001`, firstName: 'Rtl', lastName: 'Musteri', passwordHash: template.passwordHash, phoneVerifiedAt: new Date() },
    });
    const membership = await prisma.membership.create({ data: { userId: user.id, studioId: ZEN, roleTemplateId: role.id, status: 'ACTIVE', joinedAt: new Date() } });
    memberId = (await prisma.memberProfile.create({ data: { membershipId: membership.id, studioId: ZEN } })).id;
    memberUserId = user.id;
  });

  afterAll(async () => {
    await cleanup();
    if (originalSettings) {
      await prisma.retailSettings.update({
        where: { studioId: ZEN },
        data: { allowBackorder: originalSettings.allowBackorder, receiptPrefix: originalSettings.receiptPrefix },
      });
    } else {
      await prisma.retailSettings.update({ where: { studioId: ZEN }, data: { allowBackorder: false, receiptPrefix: 'S' } });
    }
    await prisma.$disconnect();
    await app.close();
  });

  // ---------------------------------------------------------------------------

  describe('permissions and tenant isolation', () => {
    it('lets reception view and sell but not manage or refund; the trainer sees nothing', async () => {
      const productId = await stockedProduct('Yetki', '10.00', 5);
      expect((await as(trainerToken, ZEN).get(`${base(ZEN)}/products`)).status).toBe(403);
      expect((await as(trainerToken, ZEN).post(`${base(ZEN)}/sales`).send({ branchId: mainBranch, lines: [{ productId, quantity: 1 }], paymentMethod: 'CASH' })).status).toBe(403);

      const list = await as(receptionToken, ZEN).get(`${base(ZEN)}/products?search=${encodeURIComponent(`${NAME} Yetki`)}`);
      expect(list.status).toBe(200);
      expect(list.body.items).toHaveLength(1);
      expect((await createProduct({ name: `${NAME} Resepsiyon`, price: '1.00' }, receptionToken)).status).toBe(403);
      expect((await as(receptionToken, ZEN).post(`${base(ZEN)}/stock/receive`).send({ productId, branchId: mainBranch, quantity: 1 })).status).toBe(403);

      const sale = await sell([{ productId, quantity: 1 }], {}, receptionToken);
      expect(sale.status).toBe(201);
      expect((await as(receptionToken, ZEN).post(`${base(ZEN)}/sales/${sale.body.id}/refund`).send({ reason: 'deneme' })).status).toBe(403);
    });

    it('keeps products, stock and sales inside their studio', async () => {
      const productId = await stockedProduct('Kiraci', '12.00', 2);
      // Another studio's owner cannot reach Zen's routes at all.
      expect((await as(flowOwnerToken, ZEN).get(`${base(ZEN)}/products`)).status).toBe(403);
      // In their own studio the Zen product id simply does not exist.
      expect((await as(flowOwnerToken, FLOW).get(`${base(FLOW)}/products/${productId}`)).status).toBe(404);
      const foreignSale = await as(flowOwnerToken, FLOW)
        .post(`${base(FLOW)}/sales`)
        .send({ branchId: flowBranch, lines: [{ productId, quantity: 1 }], paymentMethod: 'CASH' });
      expect(foreignSale.status).toBe(404);
      expect(foreignSale.body.code).toBe('RETAIL_PRODUCT_NOT_FOUND');
      // A Zen branch is not a Flow branch.
      const flowProduct = await createProduct({ name: `${NAME} Flow`, price: '5.00' }, flowOwnerToken, FLOW);
      expect(flowProduct.status).toBe(201);
      const wrongBranch = await as(flowOwnerToken, FLOW).post(`${base(FLOW)}/stock/receive`).send({ productId: flowProduct.body.id, branchId: mainBranch, quantity: 1 });
      expect(wrongBranch.status).toBe(404);
      expect(wrongBranch.body.code).toBe('RETAIL_BRANCH_NOT_FOUND');
      expect(await stockOf(productId, mainBranch)).toBe(2);
      const flowList = await as(flowOwnerToken, FLOW).get(`${base(FLOW)}/products?search=${encodeURIComponent(NAME)}`);
      expect(flowList.body.items.map((p: { id: string }) => p.id)).toEqual([flowProduct.body.id]);
    });
  });

  // ---------------------------------------------------------------------------

  describe('catalogue and stock', () => {
    it('stores price with the studio currency and refuses another currency and duplicate codes', async () => {
      const category = await owner().post(`${base(ZEN)}/categories`).send({ name: `${NAME} Kategori` });
      expect(category.status).toBe(201);
      const created = await createProduct({ name: `${NAME} Havlu`, price: '120.50', taxRate: 20, sku: 'E2E-RTL-SKU', barcode: 'E2ERTL0001', categoryId: category.body.id, costPrice: '40' });
      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({ price: '120.50', currency, taxRate: '20', effectiveTaxRate: '20', costPrice: '40.00', categoryName: `${NAME} Kategori` });

      const other = currency === 'USD' ? 'EUR' : 'USD';
      const wrong = await createProduct({ name: `${NAME} Doviz`, price: '1.00', currency: other });
      expect(wrong.status).toBe(400);
      expect(wrong.body.code).toBe('RETAIL_CURRENCY_MISMATCH');
      const dupSku = await createProduct({ name: `${NAME} Kopya`, price: '1.00', sku: 'E2E-RTL-SKU' });
      expect(dupSku.status).toBe(409);
      expect(dupSku.body.code).toBe('RETAIL_DUPLICATE_SKU');
      const dupBarcode = await createProduct({ name: `${NAME} Kopya`, price: '1.00', barcode: 'E2ERTL0001' });
      expect(dupBarcode.body.code).toBe('RETAIL_DUPLICATE_BARCODE');

      const byBarcode = await owner().get(`${base(ZEN)}/products?barcode=E2ERTL0001`);
      expect(byBarcode.body.items).toHaveLength(1);
      const noTax = await createProduct({ name: `${NAME} Varsayilan vergi`, price: '10.00' });
      expect(noTax.body).toMatchObject({ taxRate: null, effectiveTaxRate: defaultRate });
    });

    it('receives, adjusts, counts and transfers through the ledger and never goes negative', async () => {
      const productId = await stockedProduct('Stok', '5.00', 10);
      const neg = await owner().post(`${base(ZEN)}/stock/adjust`).send({ productId, branchId: mainBranch, delta: -11, reason: 'kirik' });
      expect(neg.status).toBe(409);
      expect(neg.body.code).toBe('RETAIL_NEGATIVE_STOCK');
      expect(await stockOf(productId, mainBranch)).toBe(10);

      expect((await owner().post(`${base(ZEN)}/stock/adjust`).send({ productId, branchId: mainBranch, delta: -2, reason: 'kirik' })).status).toBe(201);
      expect((await owner().post(`${base(ZEN)}/stock/adjust`).send({ productId, branchId: mainBranch, countedQuantity: 7, reason: 'sayim' })).status).toBe(201);
      expect(await stockOf(productId, mainBranch)).toBe(7);

      const tooMany = await owner().post(`${base(ZEN)}/stock/transfer`).send({ productId, fromBranchId: mainBranch, toBranchId: secondBranch, quantity: 8 });
      expect(tooMany.status).toBe(409);
      expect(tooMany.body.code).toBe('RETAIL_INSUFFICIENT_STOCK');
      const moved = await owner().post(`${base(ZEN)}/stock/transfer`).send({ productId, fromBranchId: mainBranch, toBranchId: secondBranch, quantity: 3 });
      expect(moved.status).toBe(201);
      expect(moved.body.totalStock).toBe(7);
      expect(await stockOf(productId, mainBranch)).toBe(4);
      expect(await stockOf(productId, secondBranch)).toBe(3);

      const ledger = await owner().get(`${base(ZEN)}/stock/movements?productId=${productId}&limit=20`);
      expect(ledger.status).toBe(200);
      const rows = [...ledger.body.items].reverse() as { type: string; quantity: number; quantityAfter: number; branchId: string }[];
      expect(rows.map((r) => [r.type, r.quantity])).toEqual([
        ['RECEIVE', 10],
        ['ADJUSTMENT', -2],
        ['ADJUSTMENT', -1],
        ['TRANSFER', -3],
        ['TRANSFER', 3],
      ]);
      // Every row's running quantity matches the cached level at the end.
      const lastMain = rows.filter((r) => r.branchId === mainBranch).pop();
      expect(lastMain?.quantityAfter).toBe(4);

      const untracked = await createProduct({ name: `${NAME} Hizmet`, price: '3.00', trackStock: false });
      const recv = await owner().post(`${base(ZEN)}/stock/receive`).send({ productId: untracked.body.id, branchId: mainBranch, quantity: 1 });
      expect(recv.body.code).toBe('RETAIL_UNTRACKED_PRODUCT');
    });

    it('lists products at or below their low-stock threshold', async () => {
      const productId = await stockedProduct('Az kalan', '8.00', 2, { lowStockThreshold: 3 });
      const low = await as(receptionToken, ZEN).get(`${base(ZEN)}/stock/low`);
      expect(low.status).toBe(200);
      expect(low.body.items.find((i: { productId: string }) => i.productId === productId)).toMatchObject({ quantity: 2, lowStockThreshold: 3, branchId: mainBranch });
      await owner().post(`${base(ZEN)}/stock/receive`).send({ productId, branchId: mainBranch, quantity: 5 });
      const after = await owner().get(`${base(ZEN)}/stock/low`);
      expect(after.body.items.find((i: { productId: string }) => i.productId === productId)).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------

  describe('checkout', () => {
    it('stores currency and per-line tax exactly as the shared cart math computes them', async () => {
      const a = await stockedProduct('Vergi A', '99.99', 5, { taxRate: 20 });
      const b = await stockedProduct('Vergi B', '15.00', 5, { taxRate: 10 });
      const res = await sell([
        { productId: a, quantity: 2, discount: '5.00' },
        { productId: b, quantity: 1 },
      ]);
      expect(res.status).toBe(201);
      const sale = res.body as SaleBody;
      const expected = computeCartTotals({
        currency,
        pricesIncludeTax,
        lines: [
          { unitPrice: '99.99', quantity: 2, discount: '5.00', taxRate: '20' },
          { unitPrice: '15.00', quantity: 1, taxRate: '10' },
        ],
      });
      expect(sale).toMatchObject({ currency, total: expected.total, taxTotal: expected.taxTotal, netTotal: expected.netTotal, status: 'COMPLETED', paymentId: null });
      expect(sale.lines.map((l) => [l.taxRate, l.total])).toEqual([
        ['20', expected.lines[0].total],
        ['10', expected.lines[1].total],
      ]);
      const row = await prisma.sale.findUniqueOrThrow({ where: { id: sale.id } });
      expect(row.currency).toBe(currency);
      expect(row.total.toFixed(2)).toBe(expected.total);
      expect(await stockOf(a, mainBranch)).toBe(3);
      expect(await prisma.stockMovement.count({ where: { saleId: sale.id, type: 'SALE' } })).toBe(2);
    });

    it('refuses to sell more than is on the shelf unless backorder is on', async () => {
      const productId = await stockedProduct('Tek', '4.00', 1);
      const res = await sell([{ productId, quantity: 2 }]);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('RETAIL_INSUFFICIENT_STOCK');
      expect(await stockOf(productId, mainBranch)).toBe(1);

      expect((await owner().put(`${base(ZEN)}/settings`).send({ allowBackorder: true })).status).toBe(200);
      const back = await sell([{ productId, quantity: 2 }]);
      expect(back.status).toBe(201);
      expect(await stockOf(productId, mainBranch)).toBe(-1);
      expect((await owner().put(`${base(ZEN)}/settings`).send({ allowBackorder: false })).status).toBe(200);
      expect((await sell([{ productId, quantity: 1 }])).body.code).toBe('RETAIL_INSUFFICIENT_STOCK');
    });

    it('never oversells under concurrent checkouts and numbers receipts without gaps', async () => {
      const productId = await stockedProduct('Yaris', '7.00', 3);
      const before = await prisma.retailSettings.findUniqueOrThrow({ where: { studioId: ZEN } });
      const results = await Promise.all(Array.from({ length: 8 }, () => sell([{ productId, quantity: 1 }])));
      const ok = results.filter((r) => r.status === 201);
      const refused = results.filter((r) => r.status !== 201);
      expect(ok).toHaveLength(3);
      expect(refused).toHaveLength(5);
      for (const r of refused) {
        expect(r.status).toBe(409);
        expect(r.body.code).toBe('RETAIL_INSUFFICIENT_STOCK');
      }
      expect(await stockOf(productId, mainBranch)).toBe(0);
      expect(await prisma.stockMovement.count({ where: { productId, type: 'SALE' } })).toBe(3);

      const seqs = (await prisma.sale.findMany({ where: { id: { in: ok.map((r) => r.body.id as string) } }, select: { receiptSeq: true, receiptNumber: true } }))
        .map((s) => s.receiptSeq)
        .sort((x, y) => x - y);
      // Refused checkouts roll back their number, so the three sales take the next three numbers.
      expect(seqs).toEqual([before.lastReceiptSeq + 1, before.lastReceiptSeq + 2, before.lastReceiptSeq + 3]);
      const numbers = new Set(ok.map((r) => r.body.receiptNumber as string));
      expect(numbers.size).toBe(3);
      const after = await prisma.retailSettings.findUniqueOrThrow({ where: { studioId: ZEN } });
      expect(after.lastReceiptSeq).toBe(before.lastReceiptSeq + 3);
    });

    it('returns the first sale for a repeated idempotency key', async () => {
      const productId = await stockedProduct('Tekrar', '2.00', 5);
      const key = `e2e-rtl-${Date.now()}`;
      const first = await sell([{ productId, quantity: 1 }], { idempotencyKey: key });
      const second = await sell([{ productId, quantity: 1 }], { idempotencyKey: key });
      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect(second.body.id).toBe(first.body.id);
      expect(second.body.duplicate).toBe(true);
      expect(await stockOf(productId, mainBranch)).toBe(4);
    });

    it('links a member sale to a payment that carries the promo code and earns loyalty points', async () => {
      const productId = await stockedProduct('Uye', '100.00', 5);
      const promo = await prisma.promoCode.create({
        data: { studioId: ZEN, code: `E2ERTL${Date.now() % 100000}`, kind: 'FIXED_AMOUNT', value: 10, perUserLimit: 5, createdByUserId: memberUserId },
      });
      const walkIn = await sell([{ productId, quantity: 1 }], { promoCode: promo.code });
      expect(walkIn.status).toBe(400);
      expect(walkIn.body.code).toBe('RETAIL_PROMO_REQUIRES_MEMBER');

      const res = await sell([{ productId, quantity: 1 }], { memberId, promoCode: promo.code, paymentMethod: 'CREDIT_CARD_POS' });
      expect(res.status).toBe(201);
      const sale = res.body as SaleBody;
      expect(sale.total).toBe('90.00');
      expect(sale.paymentId).toBeTruthy();
      const payment = await prisma.payment.findUniqueOrThrow({ where: { id: sale.paymentId as string } });
      expect(payment).toMatchObject({ memberId, currency, paymentMethod: 'CREDIT_CARD_POS', paymentStatus: 'COMPLETED', promoCodeId: promo.id });
      expect(payment.amount.toFixed(2)).toBe('90.00');
      expect(await prisma.promoRedemption.count({ where: { paymentId: payment.id } })).toBe(1);
      const loyaltyRule = await prisma.loyaltyRule.findFirst({ where: { studioId: ZEN, kind: 'PURCHASE_AMOUNT', isActive: true, currency } });
      const settings = await prisma.loyaltySettings.findUnique({ where: { studioId: ZEN } });
      if (loyaltyRule && settings?.enabled) {
        expect(await prisma.loyaltyLedger.count({ where: { sourceType: 'payment', sourceId: payment.id, reason: 'EARN_PURCHASE' } })).toBe(1);
      }

      // The finance refund endpoint refuses a desk sale's payment: stock would not come back.
      const direct = await owner().post(`/payments/${payment.id}/refund`).send({ reason: 'dogrudan' });
      expect(direct.status).toBe(409);
      expect(direct.body.code).toBe('RETAIL_PAYMENT_IS_RETAIL');
    });
  });

  // ---------------------------------------------------------------------------

  describe('refunds', () => {
    it('refunds per line, returns stock, moves the payment and refuses refunding twice', async () => {
      const a = await stockedProduct('Iade A', '30.00', 10);
      const b = await stockedProduct('Iade B', '10.00', 10);
      const res = await sell(
        [
          { productId: a, quantity: 3 },
          { productId: b, quantity: 2 },
        ],
        { memberId },
      );
      expect(res.status).toBe(201);
      const sale = res.body as SaleBody;
      const lineA = sale.lines.find((l) => l.productId === a)!;
      const lineB = sale.lines.find((l) => l.productId === b)!;
      expect(await stockOf(a, mainBranch)).toBe(7);

      const partial = await owner()
        .post(`${base(ZEN)}/sales/${sale.id}/refund`)
        .send({ reason: 'bozuk', lines: [{ saleLineId: lineA.id, quantity: 1 }, { saleLineId: lineB.id, quantity: 1, restock: false }] });
      expect(partial.status).toBe(201);
      expect(partial.body.status).toBe('PARTIALLY_REFUNDED');
      expect(await stockOf(a, mainBranch)).toBe(8);
      expect(await stockOf(b, mainBranch)).toBe(8);
      const returns = await prisma.stockMovement.findMany({ where: { saleId: sale.id, type: 'RETURN' } });
      expect(returns.map((m) => [m.productId, m.quantity])).toEqual([[a, 1]]);
      const refundedAmount = partial.body.refundedAmount as string;
      const payment = await prisma.payment.findUniqueOrThrow({ where: { id: sale.paymentId as string } });
      expect(payment.refundedAmount.toFixed(2)).toBe(refundedAmount);
      expect(payment.paymentStatus).toBe('COMPLETED');

      const tooMuch = await owner().post(`${base(ZEN)}/sales/${sale.id}/refund`).send({ reason: 'fazla', lines: [{ saleLineId: lineA.id, quantity: 3 }] });
      expect(tooMuch.status).toBe(400);
      expect(tooMuch.body.code).toBe('RETAIL_REFUND_EXCEEDS_SOLD');

      const rest = await owner().post(`${base(ZEN)}/sales/${sale.id}/refund`).send({ reason: 'kalan' });
      expect(rest.status).toBe(201);
      expect(rest.body.status).toBe('REFUNDED');
      expect(rest.body.refundedAmount).toBe(sale.total);
      expect(await stockOf(a, mainBranch)).toBe(10);
      expect(await stockOf(b, mainBranch)).toBe(9);
      const paid = await prisma.payment.findUniqueOrThrow({ where: { id: sale.paymentId as string } });
      expect(paid.paymentStatus).toBe('REFUNDED');
      expect(paid.refundedAmount.toFixed(2)).toBe(sale.total);

      const again = await owner().post(`${base(ZEN)}/sales/${sale.id}/refund`).send({ reason: 'tekrar' });
      expect(again.status).toBe(409);
      expect(again.body.code).toBe('RETAIL_SALE_NOT_REFUNDABLE');
    });

    it('lets only one of two concurrent full refunds through', async () => {
      const productId = await stockedProduct('Iade yaris', '6.00', 4);
      const sale = (await sell([{ productId, quantity: 2 }])).body as SaleBody;
      const results = await Promise.all([1, 2].map(() => owner().post(`${base(ZEN)}/sales/${sale.id}/refund`).send({ reason: 'yaris' })));
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(await stockOf(productId, mainBranch)).toBe(4);
    });

    it('voids a sale without refunds and refuses to void one with refunds', async () => {
      const productId = await stockedProduct('Iptal', '9.00', 4);
      const sale = (await sell([{ productId, quantity: 2 }])).body as SaleBody;
      const voided = await owner().post(`${base(ZEN)}/sales/${sale.id}/void`).send({ reason: 'yanlis satis' });
      expect(voided.status).toBe(201);
      expect(voided.body.status).toBe('VOID');
      expect(await stockOf(productId, mainBranch)).toBe(4);

      const other = (await sell([{ productId, quantity: 2 }])).body as SaleBody;
      await owner().post(`${base(ZEN)}/sales/${other.id}/refund`).send({ reason: 'bir tane', lines: [{ saleLineId: other.lines[0].id, quantity: 1 }] });
      const refused = await owner().post(`${base(ZEN)}/sales/${other.id}/void`).send({ reason: 'yanlis satis' });
      expect(refused.status).toBe(409);
      expect(refused.body.code).toBe('RETAIL_SALE_HAS_REFUNDS');
    });
  });

  // ---------------------------------------------------------------------------

  describe('history and report', () => {
    it('lists sales, shows the receipt and reports by product and day with CSV', async () => {
      const productId = await stockedProduct('Rapor', '20.00', 10, { costPrice: '8.00' });
      const sale = (await sell([{ productId, quantity: 3 }])).body as SaleBody;
      await owner().post(`${base(ZEN)}/sales/${sale.id}/refund`).send({ reason: 'bir tane', lines: [{ saleLineId: sale.lines[0].id, quantity: 1 }] });

      const list = await as(receptionToken, ZEN).get(`${base(ZEN)}/sales?receipt=${sale.receiptNumber}`);
      expect(list.status).toBe(200);
      expect(list.body.items[0]).toMatchObject({ id: sale.id, receiptNumber: sale.receiptNumber, status: 'PARTIALLY_REFUNDED', itemCount: 3, currency });
      const detail = await as(receptionToken, ZEN).get(`${base(ZEN)}/sales/${sale.id}`);
      expect(detail.body.refunds).toHaveLength(1);
      expect((await as(flowOwnerToken, FLOW).get(`${base(FLOW)}/sales/${sale.id}`)).status).toBe(404);

      const from = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const to = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      const report = await owner().get(`${base(ZEN)}/reports/sales?from=${from}&to=${to}`);
      expect(report.status).toBe(200);
      expect(report.body.currency).toBe(currency);
      const row = report.body.byProduct.find((p: { productId: string }) => p.productId === productId);
      expect(row).toMatchObject({ quantity: 3, refundedQuantity: 1, cost: '16.00' });
      expect(report.body.byDay.length).toBeGreaterThan(0);

      const csv = await owner().get(`${base(ZEN)}/reports/sales?from=${from}&to=${to}&format=csv`);
      expect(csv.status).toBe(200);
      expect(csv.headers['content-type']).toContain('text/csv');
      expect(csv.text).toContain(`${NAME} Rapor`);
      const csvDay = await owner().get(`${base(ZEN)}/reports/sales?from=${from}&to=${to}&format=csv&view=day`);
      expect(csvDay.text.split('\r\n')[0]).not.toContain(`${NAME}`);
    });
  });
});
