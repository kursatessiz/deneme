import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { PrismaClient } from '@platform/database';
import { AppModule } from '../../src/app.module';

/**
 * Web panel backlog 2.4 (finance screens): the Expense CRUD endpoints
 * backing /finans (`finance.view` to list, `finance.manage` to create and
 * delete). Studio isolation, branch scoping for restricted staff and the
 * audit trail are covered here.
 */

const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Demo1234!';

describe('Expenses (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let server: any;

  let ZEN: string;
  let ownerToken: string;
  let trainerToken: string;

  const expenseIds: string[] = [];

  const login = async (phone: string) => {
    const res = await request(server).post('/auth/login').send({ emailOrPhone: phone, password: DEMO_PASSWORD });
    expect(res.status).toBe(200);
    return res.body.accessToken as string;
  };
  const as = (token: string) => ({
    get: (url: string) => request(server).get(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', ZEN),
    post: (url: string) => request(server).post(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', ZEN),
    delete: (url: string) => request(server).delete(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', ZEN),
  });

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer();
    prisma = new PrismaClient();

    ZEN = (await prisma.studio.findUniqueOrThrow({ where: { slug: 'zen-reformer-pilates' } })).id;
    ownerToken = await login('+905321000002');
    trainerToken = await login('+905321000004');
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { studioId: ZEN, action: { in: ['expense.create', 'expense.delete'] } } });
    await prisma.expense.deleteMany({ where: { id: { in: expenseIds } } });
    await prisma.$disconnect();
    await app.close();
  });

  it('trainer without finance.manage cannot create an expense', async () => {
    const res = await as(trainerToken).post('/expenses').send({ category: 'Kira', amount: 1500, spentAt: new Date().toISOString() });
    expect(res.status).toBe(403);
  });

  it('owner creates an expense and it appears in the list, with an audit log entry', async () => {
    const spentAt = new Date().toISOString();
    const createRes = await as(ownerToken).post('/expenses').send({ category: 'Kira', amount: 1500.5, spentAt, note: 'Eylul kira' });
    expect(createRes.status).toBe(201);
    expect(createRes.body.amount).toBe('1500.50');
    expect(createRes.body.category).toBe('Kira');
    expenseIds.push(createRes.body.id);

    const listRes = await as(ownerToken).get(`/expenses/studio/${ZEN}`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.some((e: { id: string }) => e.id === createRes.body.id)).toBe(true);

    const auditRes = await prisma.auditLog.findFirst({ where: { studioId: ZEN, action: 'expense.create' }, orderBy: { createdAt: 'desc' } });
    expect(auditRes).toBeTruthy();
  });

  it('filters the list by date range and category', async () => {
    const old = await prisma.expense.create({
      data: {
        studioId: ZEN,
        category: 'Temizlik',
        amount: 200,
        spentAt: new Date('2020-01-01T00:00:00.000Z'),
        createdByUserId: (await prisma.user.findUniqueOrThrow({ where: { phone: '+905321000002' } })).id,
      },
    });
    expenseIds.push(old.id);

    const res = await as(ownerToken).get(`/expenses/studio/${ZEN}?category=Kira`);
    expect(res.status).toBe(200);
    expect(res.body.every((e: { category: string }) => e.category === 'Kira')).toBe(true);

    const rangeRes = await as(ownerToken).get(`/expenses/studio/${ZEN}?from=2019-12-01T00:00:00.000Z&to=2020-02-01T00:00:00.000Z`);
    expect(rangeRes.status).toBe(200);
    expect(rangeRes.body.map((e: { id: string }) => e.id)).toContain(old.id);
  });

  it('trainer without finance.view cannot list expenses', async () => {
    const res = await as(trainerToken).get(`/expenses/studio/${ZEN}`);
    expect(res.status).toBe(403);
  });

  it('owner deletes an expense', async () => {
    const created = await as(ownerToken).post('/expenses').send({ category: 'Malzeme', amount: 75, spentAt: new Date().toISOString() });
    expect(created.status).toBe(201);

    const delRes = await as(ownerToken).delete(`/expenses/${created.body.id}/studio/${ZEN}`);
    expect(delRes.status).toBe(200);

    const listRes = await as(ownerToken).get(`/expenses/studio/${ZEN}`);
    expect(listRes.body.some((e: { id: string }) => e.id === created.body.id)).toBe(false);
  });

  it('a studio cannot see or delete another studio\'s expense', async () => {
    const otherStudio = await prisma.studio.findFirst({ where: { slug: { not: 'zen-reformer-pilates' } } });
    expect(otherStudio).toBeTruthy();
    const owner = await prisma.user.findUniqueOrThrow({ where: { phone: '+905321000002' } });
    const foreign = await prisma.expense.create({
      data: { studioId: otherStudio!.id, category: 'Diger', amount: 10, spentAt: new Date(), createdByUserId: owner.id },
    });

    const delRes = await as(ownerToken).delete(`/expenses/${foreign.id}/studio/${ZEN}`);
    expect(delRes.status).toBe(404);

    await prisma.expense.delete({ where: { id: foreign.id } });
  });
});
