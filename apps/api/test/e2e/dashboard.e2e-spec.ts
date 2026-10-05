import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { Prisma, PrismaClient } from '@platform/database';
import { DASHBOARD_WIDGETS, buildDefaultDashboardLayout, itemsCollide } from '@platform/shared';
import type { DashboardDataResponseDTO, DashboardLayout, DashboardLayoutItem, DashboardLayoutResponseDTO } from '@platform/shared';
import { AppModule } from '../../src/app.module';

/**
 * Overview card board (docs/WEB_PANEL.md, "Genel bakış kartları"): the
 * per-membership layout endpoints and the batched card data. Covers tenant
 * isolation, membership isolation, stripping cards a trainer may not see,
 * validation versus normalization, and real seeded figures for revenue and
 * the active member count. Every layout written here is deleted in afterAll.
 */

const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Demo1234!';
const OWNER_PHONE = '+905321000002';
const RECEPTION_PHONE = '+905321000003';
const TRAINER_PHONE = '+905321000004';
const MEMBER_PHONE = '+905321000016';

const id = (n: number) => `0e2e0000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('Dashboard (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let server: Parameters<typeof request>[0];

  let ZEN: string;
  let FLOW: string;
  let flowBranchId: string;
  let ownerToken: string;
  let receptionToken: string;
  let trainerToken: string;
  let memberToken: string;
  const membershipIds: string[] = [];

  const login = async (phone: string) => {
    const res = await request(server).post('/auth/login').send({ emailOrPhone: phone, password: DEMO_PASSWORD });
    expect(res.status).toBe(200);
    return res.body.accessToken as string;
  };
  const as = (token: string, studioId: string, pathStudio = studioId) => {
    const url = (suffix: string) => `/studios/${pathStudio}/dashboard/${suffix}`;
    const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId);
    return {
      getLayout: () => auth(request(server).get(url('layout'))),
      putLayout: (body: unknown) => auth(request(server).put(url('layout'))).send(body as object),
      deleteLayout: () => auth(request(server).delete(url('layout'))),
      data: (body: unknown) => auth(request(server).post(url('data'))).send(body as object),
    };
  };

  const layout = (items: readonly object[]): unknown => ({ version: 1, items });

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer();
    prisma = new PrismaClient();

    ZEN = (await prisma.studio.findUniqueOrThrow({ where: { slug: 'zen-reformer-pilates' } })).id;
    FLOW = (await prisma.studio.findUniqueOrThrow({ where: { slug: 'flow-pilates-wellness' } })).id;
    flowBranchId = (await prisma.branch.findFirstOrThrow({ where: { studioId: FLOW } })).id;
    for (const phone of [OWNER_PHONE, RECEPTION_PHONE, TRAINER_PHONE]) {
      membershipIds.push((await prisma.membership.findFirstOrThrow({ where: { studioId: ZEN, user: { phone } } })).id);
    }
    await prisma.dashboardLayout.deleteMany({ where: { membershipId: { in: membershipIds } } });

    ownerToken = await login(OWNER_PHONE);
    receptionToken = await login(RECEPTION_PHONE);
    trainerToken = await login(TRAINER_PHONE);
    memberToken = await login(MEMBER_PHONE);
  });

  afterAll(async () => {
    await prisma.dashboardLayout.deleteMany({ where: { membershipId: { in: membershipIds } } });
    await prisma.$disconnect();
    await app.close();
  });

  describe('layout', () => {
    it('returns the permission based default before anything is saved', async () => {
      const res = await as(ownerToken, ZEN).getLayout();
      expect(res.status).toBe(200);
      const body = res.body as DashboardLayoutResponseDTO;
      expect(body.customized).toBe(false);
      expect(body.updatedAt).toBeNull();
      expect(body.layout).toEqual(buildDefaultDashboardLayout([], true));
    });

    it('saves, reads back and audits the owner layout', async () => {
      const items = [
        { id: id(1), widget: 'revenue', x: 0, y: 0, w: 4, h: 2, settings: { period: 'today' } },
        { id: id(2), widget: 'revenueTrend', x: 4, y: 0, w: 8, h: 4 },
      ];
      const put = await as(ownerToken, ZEN).putLayout(layout(items));
      expect(put.status).toBe(200);
      expect(put.body.customized).toBe(true);

      const get = await as(ownerToken, ZEN).getLayout();
      expect(get.status).toBe(200);
      expect(get.body.customized).toBe(true);
      expect(get.body.layout.items).toEqual(items);

      const audit = await prisma.auditLog.findFirst({ where: { studioId: ZEN, action: 'dashboard.layout.update' }, orderBy: { createdAt: 'desc' } });
      expect(audit?.entityType).toBe('DashboardLayout');
    });

    it('normalizes sizes outside the card limits and overlapping cards instead of storing them', async () => {
      const res = await as(ownerToken, ZEN).putLayout(
        layout([
          { id: id(1), widget: 'revenue', x: 0, y: 0, w: 12, h: 9 },
          { id: id(2), widget: 'activeMembers', x: 0, y: 0, w: 3, h: 2 },
          { id: id(3), widget: 'weekCalendar', x: 8, y: 5, w: 2, h: 2 },
        ]),
      );
      expect(res.status).toBe(200);
      const items = (res.body as DashboardLayoutResponseDTO).layout.items;
      const byId = new Map(items.map((i) => [i.id, i]));
      expect(byId.get(id(1))).toMatchObject({ w: 4, h: 3, y: 0 });
      expect(byId.get(id(3))).toMatchObject({ w: 6, h: 4, x: 6 });
      for (let i = 0; i < items.length; i += 1) {
        for (let j = i + 1; j < items.length; j += 1) expect(itemsCollide(items[i], items[j])).toBe(false);
      }
      const stored = await prisma.dashboardLayout.findFirstOrThrow({ where: { membershipId: membershipIds[0] } });
      expect((stored.layout as unknown as DashboardLayout).items).toEqual(items);
    });

    it.each([
      ['an unknown card', [{ id: id(1), widget: 'weather', x: 0, y: 0, w: 3, h: 2 }]],
      ['a second singleton', [{ id: id(1), widget: 'todaySchedule', x: 0, y: 0, w: 6, h: 5 }, { id: id(2), widget: 'todaySchedule', x: 6, y: 0, w: 6, h: 5 }]],
      ['a card past the right edge', [{ id: id(1), widget: 'revenue', x: 10, y: 0, w: 3, h: 2 }]],
      ['a period the card does not offer', [{ id: id(1), widget: 'revenueTrend', x: 0, y: 0, w: 6, h: 4, settings: { period: 'today' } }]],
      ['a non-integer position', [{ id: id(1), widget: 'revenue', x: 1.5, y: 0, w: 3, h: 2 }]],
    ])('rejects %s with 400', async (_label, items) => {
      const res = await as(ownerToken, ZEN).putLayout(layout(items));
      expect(res.status).toBe(400);
    });

    it('rejects more than 30 cards', async () => {
      const items = Array.from({ length: 31 }, (_, i) => ({ id: id(100 + i), widget: 'revenue', x: 0, y: i * 2, w: 3, h: 2 }));
      expect((await as(ownerToken, ZEN).putLayout(layout(items))).status).toBe(400);
    });

    it('keeps two memberships of the same studio apart', async () => {
      const receptionItems = [{ id: id(10), widget: 'todaySchedule', x: 0, y: 0, w: 12, h: 6 }];
      expect((await as(receptionToken, ZEN).putLayout(layout(receptionItems))).status).toBe(200);

      const owner = await as(ownerToken, ZEN).getLayout();
      expect(owner.body.layout.items.some((i: DashboardLayoutItem) => i.id === id(10))).toBe(false);
      const reception = await as(receptionToken, ZEN).getLayout();
      expect(reception.body.layout.items).toEqual(receptionItems);

      const rows = await prisma.dashboardLayout.findMany({ where: { membershipId: { in: membershipIds.slice(0, 2) } } });
      expect(rows).toHaveLength(2);
      expect(new Set(rows.map((r) => r.membershipId)).size).toBe(2);
    });

    it('strips cards a trainer may not see, on read and on write', async () => {
      const def = await as(trainerToken, ZEN).getLayout();
      expect(def.status).toBe(200);
      const widgets = (def.body as DashboardLayoutResponseDTO).layout.items.map((i) => i.widget);
      expect(widgets).toContain('todaySchedule');
      expect(widgets).not.toContain('revenue');

      const put = await as(trainerToken, ZEN).putLayout(
        layout([
          { id: id(20), widget: 'revenue', x: 0, y: 0, w: 3, h: 2 },
          { id: id(21), widget: 'todaySessions', x: 3, y: 0, w: 3, h: 2 },
        ]),
      );
      expect(put.status).toBe(200);
      expect(put.body.layout.items.map((i: DashboardLayoutItem) => i.widget)).toEqual(['todaySessions']);
      expect(put.body.layout.items[0]).toMatchObject({ x: 3, y: 0 });

      // A stored card the role lost later is dropped on read too.
      await prisma.dashboardLayout.update({
        where: { membershipId: membershipIds[2] },
        data: { layout: { version: 1, items: [{ id: id(22), widget: 'recentPayments', x: 0, y: 0, w: 6, h: 5 }] } as unknown as Prisma.InputJsonValue },
      });
      const read = await as(trainerToken, ZEN).getLayout();
      expect(read.body.layout.items).toEqual([]);
    });

    it('resets to the default', async () => {
      const res = await as(ownerToken, ZEN).deleteLayout();
      expect(res.status).toBe(200);
      expect(res.body.customized).toBe(false);
      expect(await prisma.dashboardLayout.count({ where: { membershipId: membershipIds[0] } })).toBe(0);
      expect((await as(ownerToken, ZEN).getLayout()).body.customized).toBe(false);
    });

    it('refuses a member without dashboard.view', async () => {
      expect((await as(memberToken, ZEN).getLayout()).status).toBe(403);
    });
  });

  describe('tenant isolation', () => {
    it('cannot read or write another studio board', async () => {
      expect((await as(ownerToken, FLOW).getLayout()).status).toBe(403);
      expect((await as(ownerToken, FLOW).putLayout(layout([]))).status).toBe(403);
      expect((await as(ownerToken, FLOW).data({ widgets: [{ id: id(1), widget: 'revenue' }] })).status).toBe(403);
      // Path and header naming different studios is refused as well.
      expect((await as(ownerToken, ZEN, FLOW).getLayout()).status).toBe(403);
      expect((await as(ownerToken, ZEN, FLOW).deleteLayout()).status).toBe(403);
    });

    it('cannot filter the data by another studio branch', async () => {
      const res = await as(ownerToken, ZEN).data({ branchId: flowBranchId, widgets: [{ id: id(1), widget: 'revenue' }] });
      expect(res.status).toBe(404);
    });
  });

  describe('data', () => {
    it('returns real figures for revenue and the active member count', async () => {
      const res = await as(ownerToken, ZEN).data({
        widgets: [
          { id: id(1), widget: 'revenue', settings: { period: 'last30' } },
          { id: id(2), widget: 'activeMembers' },
          { id: id(3), widget: 'todaySchedule' },
          { id: id(4), widget: 'revenueTrend', settings: { period: 'week' } },
        ],
      });
      expect(res.status).toBe(200);
      const body = res.body as DashboardDataResponseDTO;
      const studio = await prisma.studio.findUniqueOrThrow({ where: { id: ZEN } });
      expect(body.currency).toBe(studio.currency);
      expect(body.timeZone).toBe(studio.timezone);

      const revenue = body.results.find((r) => r.id === id(1));
      if (revenue?.status !== 'ok' || revenue.data.kind !== 'revenue') throw new Error('revenue card missing');
      const window = { gte: new Date(revenue.data.from), lt: new Date(revenue.data.to) };
      const where = { studioId: ZEN, paymentStatus: { in: ['COMPLETED', 'REFUNDED'] as ('COMPLETED' | 'REFUNDED')[] }, paidAt: window };
      const agg = await prisma.payment.aggregate({ where, _sum: { amount: true, refundedAmount: true } });
      const expected = new Prisma.Decimal(agg._sum.amount ?? 0).minus(new Prisma.Decimal(agg._sum.refundedAmount ?? 0));
      expect(revenue.data.currentAmount).toBe(expected.toFixed(2));
      expect(revenue.data.currency).toBe(studio.currency);
      expect(Number(revenue.data.currentAmount)).toBeGreaterThan(0);

      const members = body.results.find((r) => r.id === id(2));
      if (members?.status !== 'ok' || members.data.kind !== 'activeMembers') throw new Error('members card missing');
      const activeCount = await prisma.memberProfile.count({ where: { studioId: ZEN, membership: { status: 'ACTIVE' } } });
      expect(members.data.count).toBe(activeCount);
      expect(activeCount).toBeGreaterThan(0);

      const schedule = body.results.find((r) => r.id === id(3));
      expect(schedule?.status).toBe('ok');
      const trend = body.results.find((r) => r.id === id(4));
      if (trend?.status !== 'ok' || trend.data.kind !== 'revenueTrend') throw new Error('trend card missing');
      expect(trend.data.points.length).toBeGreaterThanOrEqual(1);
      expect(trend.data.points.length).toBeLessThanOrEqual(7);
    });

    it('answers forbidden per card for a trainer instead of failing the batch', async () => {
      const res = await as(trainerToken, ZEN).data({
        widgets: [
          { id: id(1), widget: 'revenue' },
          { id: id(2), widget: 'recentPayments' },
          { id: id(3), widget: 'todaySessions' },
          { id: id(4), widget: 'weekCalendar' },
        ],
      });
      expect(res.status).toBe(200);
      const status = Object.fromEntries((res.body as DashboardDataResponseDTO).results.map((r) => [r.widget, r.status]));
      expect(status).toEqual({ revenue: 'forbidden', recentPayments: 'forbidden', todaySessions: 'ok', weekCalendar: 'ok' });
      const forbidden = (res.body as DashboardDataResponseDTO).results.find((r) => r.widget === 'revenue');
      expect(forbidden && 'data' in forbidden).toBe(false);
    });

    it('computes every card of the catalogue for the owner, with and without a branch filter', async () => {
      const branchId = (await prisma.branch.findFirstOrThrow({ where: { studioId: ZEN } })).id;
      const widgets = DASHBOARD_WIDGETS.map((w, i) => ({ id: id(200 + i), widget: w.key }));
      for (const body of [{ widgets }, { branchId, widgets }]) {
        const res = await as(ownerToken, ZEN).data(body);
        expect(res.status).toBe(200);
        const failed = (res.body as DashboardDataResponseDTO).results.filter((r) => r.status !== 'ok').map((r) => r.widget);
        expect(failed).toEqual([]);
      }
    });

    it('validates the batch', async () => {
      expect((await as(ownerToken, ZEN).data({ widgets: [] })).status).toBe(400);
      expect((await as(ownerToken, ZEN).data({ widgets: [{ id: id(1), widget: 'weather' }] })).status).toBe(400);
    });
  });
});
