import { ForbiddenException } from '@nestjs/common';
import { UsagePeriodsService } from './usage-periods.service';
import type { UsagePackageRef } from './usage-periods.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { TenantContext } from '../auth/tenant-context';

const START = new Date('2026-10-01T10:00:00Z');
const ruleJson = {
  version: 1,
  tiers: [
    { unit: 'MONTH', length: 1, monthMode: 'CALENDAR', quota: 2, expireUnused: true },
    { unit: 'WEEK', length: 1, quota: 1, expireUnused: false },
  ],
  reminderDaysBefore: 3,
};

function pkg(over: Partial<UsagePackageRef> = {}): UsagePackageRef {
  return {
    id: 'pkg-1',
    studioId: 'studio-1',
    entitlementKind: 'SESSION_COUNT',
    startDate: START,
    endDate: new Date('2027-01-01T10:00:00Z'),
    usageRule: ruleJson,
    ...over,
  };
}

interface Fixture {
  enabled?: boolean;
  bookings?: { status: string; unitsCharged: number; penaltyUnits: number; start: Date }[];
  expiries?: { tierUnit: string; units: number; periodStart: Date; periodEnd: Date }[];
  freezes?: { freezeStartDate: Date; freezeEndDate: Date }[];
}

function build(fx: Fixture = {}) {
  const prisma = {
    studio: { findUnique: jest.fn().mockResolvedValue({ usagePeriodsEnabled: fx.enabled ?? true, timezone: 'UTC' }), update: jest.fn() },
    packageFreezeHistory: { findMany: jest.fn().mockResolvedValue(fx.freezes ?? []) },
    booking: {
      findMany: jest.fn(async (args: { where: { schedule: { startTime: { gte: Date; lt: Date } }; scheduleId?: { not: string } } }) => {
        const { gte, lt } = args.where.schedule.startTime;
        return (fx.bookings ?? []).filter((b) => b.start >= gte && b.start < lt);
      }),
    },
    eventRegistration: { findMany: jest.fn().mockResolvedValue([]) },
    packageUnitExpiry: {
      findMany: jest.fn(async (args: { where: { tierUnit: { in: string[] }; periodEnd: { gt: Date; lte: Date } } }) =>
        (fx.expiries ?? []).filter((e) => args.where.tierUnit.in.includes(e.tierUnit) && e.periodEnd > args.where.periodEnd.gt && e.periodEnd <= args.where.periodEnd.lte),
      ),
    },
    memberPackage: { findFirst: jest.fn().mockResolvedValue(pkg()) },
    auditLog: { create: jest.fn() },
    $queryRaw: jest.fn().mockResolvedValue([]),
    $transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
  };
  const service = new UsagePeriodsService(prisma as unknown as PrismaService);
  return { prisma, service };
}

const booking = (start: string, status = 'CONFIRMED', unitsCharged = 1, penaltyUnits = 0) => ({ status, unitsCharged, penaltyUnits, start: new Date(start) });

describe('UsagePeriodsService owner switch', () => {
  const tenant = (isOwner: boolean): TenantContext => ({
    studioId: 'studio-1',
    membershipId: 'm1',
    isOwner,
    isSuperAdmin: false,
    permissions: new Set(['studio.settings.manage']),
    memberProfileId: null,
    trainerProfileId: null,
    branchIds: null,
  });

  it('answers 403 to a non-owner even with the settings permission, and changes nothing', async () => {
    const { prisma, service } = build();
    await expect(service.setEnabled(tenant(false), 'user-1', true)).rejects.toThrow(ForbiddenException);
    expect(prisma.studio.update).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('lets the owner enable and writes studio.usagePeriods.enable', async () => {
    const { prisma, service } = build();
    prisma.studio.findUnique.mockResolvedValue({ usagePeriodsEnabled: false, timezone: 'UTC' });
    (prisma.studio as unknown as { findUniqueOrThrow: jest.Mock }).findUniqueOrThrow = jest.fn().mockResolvedValue({ usagePeriodsEnabled: false });
    await expect(service.setEnabled(tenant(true), 'user-1', true)).resolves.toEqual({ enabled: true });
    expect(prisma.studio.update).toHaveBeenCalledWith({ where: { id: 'studio-1' }, data: { usagePeriodsEnabled: true, usagePeriodsEnabledAt: expect.any(Date) } });
    expect(prisma.auditLog.create.mock.calls[0][0].data).toMatchObject({ studioId: 'studio-1', userId: 'user-1', action: 'studio.usagePeriods.enable' });
  });

  it('writes studio.usagePeriods.disable when the owner turns it off', async () => {
    const { prisma, service } = build();
    (prisma.studio as unknown as { findUniqueOrThrow: jest.Mock }).findUniqueOrThrow = jest.fn().mockResolvedValue({ usagePeriodsEnabled: true });
    await service.setEnabled(tenant(true), 'user-1', false);
    expect(prisma.auditLog.create.mock.calls[0][0].data.action).toBe('studio.usagePeriods.disable');
  });
});

describe('UsagePeriodsService rule resolution', () => {
  it('ignores every rule while the switch is off, sold packages included', async () => {
    const { service, prisma } = build({ enabled: false });
    const ctx = await service.context(prisma as unknown as PrismaService, 'studio-1');
    expect(service.activeRule(ctx, pkg())).toBeNull();
    expect(await service.findBlocking(prisma as unknown as PrismaService, ctx, pkg(), new Date('2026-10-05T10:00:00Z'), 1)).toBeNull();
    expect(await service.statusFor(prisma as unknown as PrismaService, ctx, pkg(), new Date('2026-10-05T10:00:00Z'))).toBeNull();
  });

  it('ignores a package without a snapshot or with an invalid one', async () => {
    const { service, prisma } = build();
    const ctx = await service.context(prisma as unknown as PrismaService, 'studio-1');
    expect(service.activeRule(ctx, pkg({ usageRule: null }))).toBeNull();
    expect(service.activeRule(ctx, pkg({ usageRule: { version: 7 } }))).toBeNull();
    expect(service.activeRule(ctx, pkg())).not.toBeNull();
  });

  it('snapshots the definition rule only with the switch on', async () => {
    const on = build({ enabled: true });
    expect(await on.service.snapshotFor(on.prisma as unknown as PrismaService, 'studio-1', { usageRule: ruleJson })).toMatchObject({ version: 1 });
    expect(await on.service.snapshotFor(on.prisma as unknown as PrismaService, 'studio-1', { usageRule: null })).toBeUndefined();
    const off = build({ enabled: false });
    expect(await off.service.snapshotFor(off.prisma as unknown as PrismaService, 'studio-1', { usageRule: ruleJson })).toBeUndefined();
  });
});

describe('UsagePeriodsService quota', () => {
  const at = new Date('2026-10-14T10:00:00Z'); // weeks of this package start 10-01, 10-08, 10-15

  it('allows a booking while every tier has room', async () => {
    const { service, prisma } = build({ bookings: [booking('2026-10-03T10:00:00Z')] });
    const ctx = await service.context(prisma as unknown as PrismaService, 'studio-1');
    expect(await service.findBlocking(prisma as unknown as PrismaService, ctx, pkg(), at, 1)).toBeNull();
  });

  it('blocks on the month quota once it is reached (2 sessions in the month)', async () => {
    const { service, prisma } = build({ bookings: [booking('2026-10-03T10:00:00Z'), booking('2026-10-04T10:00:00Z')] });
    const ctx = await service.context(prisma as unknown as PrismaService, 'studio-1');
    const blocked = await service.findBlocking(prisma as unknown as PrismaService, ctx, pkg(), at, 1);
    expect(blocked?.tier.unit).toBe('MONTH');
    expect(blocked?.period.end.toISOString()).toBe('2026-11-01T10:00:00.000Z');
  });

  it('blocks on the week cap first (finer tier) when the same week is used', async () => {
    const { service, prisma } = build({ bookings: [booking('2026-10-09T10:00:00Z')] });
    const ctx = await service.context(prisma as unknown as PrismaService, 'studio-1');
    const blocked = await service.findBlocking(prisma as unknown as PrismaService, ctx, pkg(), at, 1);
    expect(blocked?.tier.unit).toBe('WEEK');
    expect(blocked?.period.start.toISOString()).toBe('2026-10-08T10:00:00.000Z');
  });

  it('does not count a booking that was cancelled for free, but counts a penalty', async () => {
    const free = build({ bookings: [booking('2026-10-09T10:00:00Z', 'CANCELLED_EARLY', 1, 0)] });
    const ctxFree = await free.service.context(free.prisma as unknown as PrismaService, 'studio-1');
    expect(await free.service.findBlocking(free.prisma as unknown as PrismaService, ctxFree, pkg(), at, 1)).toBeNull();

    const penalty = build({ bookings: [booking('2026-10-09T10:00:00Z', 'CANCELLED_LATE', 1, 1)] });
    const ctxPenalty = await penalty.service.context(penalty.prisma as unknown as PrismaService, 'studio-1');
    expect((await penalty.service.findBlocking(penalty.prisma as unknown as PrismaService, ctxPenalty, pkg(), at, 1))?.tier.unit).toBe('WEEK');
  });

  it('counts a unit cost above the room as blocked', async () => {
    const { service, prisma } = build({ bookings: [booking('2026-10-03T10:00:00Z')] });
    const ctx = await service.context(prisma as unknown as PrismaService, 'studio-1');
    expect((await service.findBlocking(prisma as unknown as PrismaService, ctx, pkg(), at, 2))?.tier.unit).toBe('WEEK');
  });

  it('counts units burned by a finer burning tier inside the coarser period', async () => {
    const burning = {
      version: 1,
      tiers: [
        { unit: 'WEEK', length: 1, quota: 2, expireUnused: true },
        { unit: 'MONTH', length: 1, monthMode: 'CALENDAR', quota: 4, expireUnused: true },
      ],
      reminderDaysBefore: 3,
    };
    const { service, prisma } = build({
      bookings: [booking('2026-10-02T10:00:00Z', 'CONFIRMED', 1)],
      expiries: [{ tierUnit: 'WEEK', units: 1, periodStart: new Date('2026-10-01T10:00:00Z'), periodEnd: new Date('2026-10-08T10:00:00Z') }],
    });
    const ctx = await service.context(prisma as unknown as PrismaService, 'studio-1');
    const checks = await service.tierChecks(prisma as unknown as PrismaService, ctx, pkg({ usageRule: burning }), burning as never, at);
    const month = checks.find((c) => c.tier.unit === 'MONTH');
    expect(month?.consumed).toBe(2); // 1 booked + 1 burned by the first week
  });

  it('counts visits of an unlimited package: a cap of 1 per week blocks the second visit', async () => {
    const cap = { version: 1, tiers: [{ unit: 'WEEK', length: 1, quota: 1, expireUnused: false }], reminderDaysBefore: 3 };
    const unlimited = pkg({ entitlementKind: 'TIME_UNLIMITED', usageRule: cap });
    const { service, prisma } = build({ bookings: [booking('2026-10-09T10:00:00Z', 'CONFIRMED', 1)] });
    const ctx = await service.context(prisma as unknown as PrismaService, 'studio-1');
    expect((await service.findBlocking(prisma as unknown as PrismaService, ctx, unlimited, at, 5))?.tier.unit).toBe('WEEK');
  });

  it('skips a tier for a session that starts before the package', async () => {
    const { service, prisma } = build();
    const ctx = await service.context(prisma as unknown as PrismaService, 'studio-1');
    expect(await service.findBlocking(prisma as unknown as PrismaService, ctx, pkg(), new Date('2026-09-01T00:00:00Z'), 1)).toBeNull();
  });

  it('builds a localized quota error with the renewal date', async () => {
    const { service, prisma } = build({ bookings: [booking('2026-10-03T10:00:00Z'), booking('2026-10-04T10:00:00Z')] });
    const ctx = await service.context(prisma as unknown as PrismaService, 'studio-1');
    const blocked = await service.findBlocking(prisma as unknown as PrismaService, ctx, pkg(), at, 1);
    const error = service.quotaError(blocked!, 'UTC');
    const body = error.getResponse() as { code: string; params: { period: string; date: string } };
    expect(body.code).toBe('apiErrors.schedules.periodQuotaReached');
    expect(body.params.date).toMatch(/2026/);
    expect(body.params.period.length).toBeGreaterThan(0);
  });

  it('reports the current period status for the screens, clipped to the package end', async () => {
    const { service, prisma } = build({ bookings: [booking('2026-10-09T10:00:00Z')] });
    const ctx = await service.context(prisma as unknown as PrismaService, 'studio-1');
    const status = await service.statusFor(prisma as unknown as PrismaService, ctx, pkg({ endDate: new Date('2026-10-20T00:00:00Z') }), new Date('2026-10-09T12:00:00Z'));
    expect(status).toEqual([
      { unit: 'WEEK', length: 1, periodStart: '2026-10-08T10:00:00.000Z', periodEnd: '2026-10-15T10:00:00.000Z', quota: 1, used: 1, remaining: 0, expireUnused: false },
      { unit: 'MONTH', length: 1, periodStart: '2026-10-01T10:00:00.000Z', periodEnd: '2026-10-20T00:00:00.000Z', quota: 2, used: 1, remaining: 1, expireUnused: true },
    ]);
  });
});

describe('UsagePeriodsService assertWithinQuota', () => {
  const at = new Date('2026-10-14T10:00:00Z');

  it('takes no lock and does not throw when the package has no active rule', async () => {
    const { service, prisma } = build();
    prisma.memberPackage.findFirst.mockResolvedValue(pkg({ usageRule: null }));
    await expect(service.assertWithinQuota(prisma as never, 'studio-1', 'pkg-1', at, 1)).resolves.toBeUndefined();
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('takes no lock while the switch is off', async () => {
    const { service, prisma } = build({ enabled: false });
    await service.assertWithinQuota(prisma as never, 'studio-1', 'pkg-1', at, 1);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('locks the package row and throws when the quota is reached', async () => {
    const { service, prisma } = build({ bookings: [booking('2026-10-03T10:00:00Z'), booking('2026-10-04T10:00:00Z')] });
    await expect(service.assertWithinQuota(prisma as never, 'studio-1', 'pkg-1', at, 1)).rejects.toMatchObject({
      response: { code: 'apiErrors.schedules.periodQuotaReached' },
    });
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('locks and passes when there is room', async () => {
    const { service, prisma } = build({ bookings: [booking('2026-10-03T10:00:00Z')] });
    await expect(service.assertWithinQuota(prisma as never, 'studio-1', 'pkg-1', at, 1)).resolves.toBeUndefined();
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('leaves the booking being re-opened out of the count', async () => {
    const { service, prisma } = build();
    await service.assertWithinQuota(prisma as never, 'studio-1', 'pkg-1', at, 1, 'schedule-9');
    const where = prisma.booking.findMany.mock.calls[0][0].where;
    expect(where.scheduleId).toEqual({ not: 'schedule-9' });
  });
});
