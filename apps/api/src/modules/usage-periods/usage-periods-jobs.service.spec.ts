import { UsagePeriodsJobsService, USAGE_JOB_INTERVAL_MS } from './usage-periods-jobs.service';
import { UsagePeriodsService } from './usage-periods.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { MessagingService } from '../messaging/engine/messaging.service';

const STUDIO = 'studio-1';
const DAY = 86_400_000;
const START = new Date('2026-09-01T10:00:00Z');

const monthBurn = (quota: number, extra: Record<string, unknown> = {}) => ({ unit: 'MONTH', length: 1, monthMode: 'CALENDAR', quota, expireUnused: true, ...extra });
const weekBurn = (quota: number) => ({ unit: 'WEEK', length: 1, quota, expireUnused: true });
const weekCap = (quota: number) => ({ unit: 'WEEK', length: 1, quota, expireUnused: false });
const rule = (tiers: unknown[], reminderDaysBefore = 3) => ({ version: 1, tiers, reminderDaysBefore });

interface PkgState {
  id: string;
  remainingUnits: number;
  status: string;
  usageRule: unknown;
  endDate: Date;
  entitlementKind: string;
}

interface Seed {
  pkg?: Partial<PkgState>;
  /** Net consumption booked at a given instant. */
  bookings?: { at: string; units: number }[];
  enabled?: boolean;
}

function build(seed: Seed = {}) {
  const pkg: PkgState = {
    id: 'pkg-1',
    remainingUnits: 20,
    status: 'ACTIVE',
    usageRule: rule([monthBurn(8)]),
    endDate: new Date('2027-03-01T10:00:00Z'),
    entitlementKind: 'SESSION_COUNT',
    ...seed.pkg,
  };
  const expiries: { id: string; studioId: string; memberPackageId: string; tierUnit: string; periodStart: Date; periodEnd: Date; units: number }[] = [];
  const row = () => ({
    id: pkg.id,
    studioId: STUDIO,
    memberId: 'member-1',
    entitlementKind: pkg.entitlementKind,
    startDate: START,
    endDate: pkg.endDate,
    usageRule: pkg.usageRule,
    remainingUnits: pkg.remainingUnits,
    status: pkg.status,
    packageDefinition: { name: 'Paket' },
    member: { membershipId: 'ms-1' },
  });
  const prisma = {
    studio: {
      findMany: jest.fn().mockResolvedValue(seed.enabled === false ? [] : [{ id: STUDIO, timezone: 'UTC' }]),
      findUnique: jest.fn().mockResolvedValue({ usagePeriodsEnabled: seed.enabled ?? true, timezone: 'UTC', defaultLocale: 'tr' }),
    },
    memberPackage: {
      findMany: jest.fn(async (args: { where: { id?: { gt: string } } }) => (args.where.id?.gt ? [] : [row()])),
      findFirst: jest.fn(async () => row()),
      updateMany: jest.fn(async (args: { data: { remainingUnits?: number; status?: string } }) => {
        if (args.data.remainingUnits !== undefined) pkg.remainingUnits = args.data.remainingUnits;
        if (args.data.status) pkg.status = args.data.status;
        return { count: 1 };
      }),
    },
    packageFreezeHistory: { findMany: jest.fn().mockResolvedValue([]) },
    booking: {
      findMany: jest.fn(async (args: { where: { schedule: { startTime: { gte: Date; lt: Date } } } }) => {
        const { gte, lt } = args.where.schedule.startTime;
        return (seed.bookings ?? [])
          .filter((b) => new Date(b.at) >= gte && new Date(b.at) < lt)
          .map((b) => ({ status: 'ATTENDED', unitsCharged: b.units, penaltyUnits: 0 }));
      }),
    },
    eventRegistration: { findMany: jest.fn().mockResolvedValue([]) },
    packageUnitExpiry: {
      findMany: jest.fn(async (args: { where: { tierUnit: string | { in: string[] }; periodEnd?: { gt: Date; lte: Date } } }) => {
        const units = typeof args.where.tierUnit === 'string' ? [args.where.tierUnit] : args.where.tierUnit.in;
        return expiries.filter((e) => units.includes(e.tierUnit) && (!args.where.periodEnd || (e.periodEnd > args.where.periodEnd.gt && e.periodEnd <= args.where.periodEnd.lte)));
      }),
      createMany: jest.fn(async (args: { data: (typeof expiries)[number][] }) => {
        let count = 0;
        for (const d of args.data) {
          if (expiries.some((e) => e.memberPackageId === d.memberPackageId && e.tierUnit === d.tierUnit && e.periodStart.getTime() === d.periodStart.getTime())) continue;
          expiries.push({ ...d, id: `e${expiries.length}` });
          count += 1;
        }
        return { count };
      }),
    },
    $queryRaw: jest.fn().mockResolvedValue([]),
    $transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
  };
  const messaging = { send: jest.fn().mockResolvedValue({ success: true }) };
  const usage = new UsagePeriodsService(prisma as unknown as PrismaService);
  const jobs = new UsagePeriodsJobsService(prisma as unknown as PrismaService, usage, messaging as unknown as MessagingService);
  return { prisma, messaging, jobs, pkg, expiries };
}

const ctx = { enabled: true, timeZone: 'UTC' };

describe('UsagePeriodsJobsService burn', () => {
  it('burns the unused part of every ended period and writes one row per period', async () => {
    // Periods of Sep and Oct ended by 2026-11-05; 3 used in September, 8 in October.
    const { jobs, pkg, expiries } = build({
      bookings: [
        { at: '2026-09-10T10:00:00Z', units: 3 },
        { at: '2026-10-10T10:00:00Z', units: 8 },
      ],
    });
    const res = await jobs.burnPackage('pkg-1', STUDIO, ctx, new Date('2026-11-05T00:00:00Z'));
    expect(res).toEqual({ periodsRecorded: 2, unitsBurned: 5, depleted: false });
    expect(pkg.remainingUnits).toBe(15);
    expect(expiries.map((e) => [e.tierUnit, e.periodEnd.toISOString(), e.units])).toEqual([
      ['MONTH', '2026-10-01T10:00:00.000Z', 5],
      ['MONTH', '2026-11-01T10:00:00.000Z', 0],
    ]);
  });

  it('writes a zero row for a fully used period so it is not evaluated again', async () => {
    const { jobs, expiries } = build({ bookings: [{ at: '2026-09-10T10:00:00Z', units: 8 }] });
    await jobs.burnPackage('pkg-1', STUDIO, ctx, new Date('2026-10-05T00:00:00Z'));
    expect(expiries).toHaveLength(1);
    expect(expiries[0].units).toBe(0);
  });

  it('is idempotent: a second run records and burns nothing more', async () => {
    const { jobs, pkg, expiries } = build({ bookings: [{ at: '2026-09-10T10:00:00Z', units: 3 }] });
    const now = new Date('2026-10-05T00:00:00Z');
    await jobs.burnPackage('pkg-1', STUDIO, ctx, now);
    const again = await jobs.burnPackage('pkg-1', STUDIO, ctx, now);
    expect(again).toEqual({ periodsRecorded: 0, unitsBurned: 0, depleted: false });
    expect(pkg.remainingUnits).toBe(15);
    expect(expiries).toHaveLength(1);
  });

  it('does not burn a period that has not ended yet', async () => {
    const { jobs, expiries } = build();
    const res = await jobs.burnPackage('pkg-1', STUDIO, ctx, new Date('2026-09-30T10:00:00Z'));
    expect(res.periodsRecorded).toBe(0);
    expect(expiries).toHaveLength(0);
  });

  it('clamps the burn to the units the package still holds and marks it DEPLETED at zero', async () => {
    const { jobs, pkg } = build({ pkg: { remainingUnits: 5 } });
    const res = await jobs.burnPackage('pkg-1', STUDIO, ctx, new Date('2026-10-05T00:00:00Z'));
    expect(res).toEqual({ periodsRecorded: 1, unitsBurned: 5, depleted: true });
    expect(pkg.remainingUnits).toBe(0);
    expect(pkg.status).toBe('DEPLETED');
  });

  it('processes finer tiers before coarser ones and counts finer burns inside the coarser period', async () => {
    // Week quota 2 burns, month quota 4 burns. Nothing is booked.
    // Weeks of Sep 1..8, 8..15, 15..22, 22..29 end inside September (the month ends Oct 1): 4 weeks x 2 = 8 would exceed
    // the month quota of 4, so the month burn is clamped at zero (quota - consumed - finerBurned < 0).
    const { jobs, expiries } = build({ pkg: { usageRule: rule([monthBurn(4), weekBurn(2)]) } });
    await jobs.burnPackage('pkg-1', STUDIO, ctx, new Date('2026-10-02T00:00:00Z'));
    const order = expiries.map((e) => e.tierUnit);
    expect(order.indexOf('MONTH')).toBeGreaterThan(order.lastIndexOf('WEEK'));
    const month = expiries.find((e) => e.tierUnit === 'MONTH');
    expect(month?.units).toBe(0);
    const weeks = expiries.filter((e) => e.tierUnit === 'WEEK' && e.periodEnd <= new Date('2026-10-01T10:00:00Z'));
    expect(weeks.reduce((s, w) => s + w.units, 0)).toBe(8);
  });

  it('lets the month burn only what the weeks left over (quota 10: weeks burn 4, month burns 6)', async () => {
    const { jobs, expiries } = build({ pkg: { usageRule: rule([monthBurn(10), weekBurn(1)]) } });
    await jobs.burnPackage('pkg-1', STUDIO, ctx, new Date('2026-10-02T00:00:00Z'));
    // Weeks ending inside September: Sep 8, 15, 22, 29 -> 4 x 1 burned.
    const month = expiries.find((e) => e.tierUnit === 'MONTH');
    expect(month?.units).toBe(6);
  });

  it('never burns for cap-only tiers', async () => {
    const { jobs, expiries, pkg } = build({ pkg: { usageRule: rule([weekCap(2)]) } });
    const res = await jobs.burnPackage('pkg-1', STUDIO, ctx, new Date('2026-12-01T00:00:00Z'));
    expect(res).toEqual({ periodsRecorded: 0, unitsBurned: 0, depleted: false });
    expect(expiries).toHaveLength(0);
    expect(pkg.remainingUnits).toBe(20);
  });

  it('skips non-ACTIVE packages, unlimited packages and a disabled switch', async () => {
    for (const seed of [{ pkg: { status: 'FROZEN' } }, { pkg: { entitlementKind: 'TIME_UNLIMITED', remainingUnits: null as unknown as number } }]) {
      const { jobs, expiries } = build(seed);
      const res = await jobs.burnPackage('pkg-1', STUDIO, ctx, new Date('2026-12-01T00:00:00Z'));
      expect(res.periodsRecorded).toBe(0);
      expect(expiries).toHaveLength(0);
    }
    const off = build();
    const res = await off.jobs.burnPackage('pkg-1', STUDIO, { enabled: false, timeZone: 'UTC' }, new Date('2026-12-01T00:00:00Z'));
    expect(res.periodsRecorded).toBe(0);
  });

  it('stops at the package end date: the clipped final period is left to normal expiry', async () => {
    const { jobs, expiries } = build({ pkg: { endDate: new Date('2026-10-15T10:00:00Z') } });
    await jobs.burnPackage('pkg-1', STUDIO, ctx, new Date('2026-12-01T00:00:00Z'));
    // Only the period ending 2026-10-01 fits before the end date; the one ending 2026-11-01 does not.
    expect(expiries.map((e) => e.periodEnd.toISOString())).toEqual(['2026-10-01T10:00:00.000Z']);
  });

  it('takes the package row lock before counting', async () => {
    const { jobs, prisma } = build();
    await jobs.burnPackage('pkg-1', STUDIO, ctx, new Date('2026-10-05T00:00:00Z'));
    expect(prisma.$queryRaw).toHaveBeenCalled();
  });
});

describe('UsagePeriodsJobsService run gating', () => {
  it('runs once a day: a second heartbeat inside 23 hours does nothing', async () => {
    const { jobs, prisma } = build({ bookings: [{ at: '2026-09-10T10:00:00Z', units: 3 }] });
    const first = await jobs.run(new Date('2026-10-05T00:00:00Z'));
    expect(first.ran).toBe(true);
    expect(first.unitsBurned).toBe(5);
    const calls = prisma.memberPackage.findMany.mock.calls.length;
    const second = await jobs.run(new Date(new Date('2026-10-05T00:00:00Z').getTime() + USAGE_JOB_INTERVAL_MS - 60_000));
    expect(second.ran).toBe(false);
    expect(prisma.memberPackage.findMany.mock.calls.length).toBe(calls);
    const third = await jobs.run(new Date(new Date('2026-10-05T00:00:00Z').getTime() + USAGE_JOB_INTERVAL_MS + 60_000));
    expect(third.ran).toBe(true);
    expect(third.unitsBurned).toBe(0);
  });

  it('only looks at studios with the switch on', async () => {
    const { jobs, prisma } = build({ enabled: false });
    const res = await jobs.run(new Date('2026-10-05T00:00:00Z'));
    expect(res.packagesChecked).toBe(0);
    expect(prisma.memberPackage.findMany).not.toHaveBeenCalled();
  });
});

describe('UsagePeriodsJobsService reminders', () => {
  // The September period of a 2026-09-01T10:00Z package ends 2026-10-01T10:00Z.
  const threeDaysBefore = new Date('2026-09-28T12:00:00Z');

  it('reminds a member with unused quota once the burning period is within the lead time (IN_APP and PUSH, no SMS)', async () => {
    const { jobs, messaging } = build({ bookings: [{ at: '2026-09-10T10:00:00Z', units: 3 }] });
    const sent = await jobs.remindPackage('pkg-1', STUDIO, ctx, threeDaysBefore);
    expect(sent).toBe(1);
    expect(messaging.send).toHaveBeenCalledTimes(2);
    const calls = messaging.send.mock.calls.map((c) => c[0]);
    expect(calls.map((c) => c.channel)).toEqual(['IN_APP', 'PUSH']);
    for (const c of calls) {
      expect(c).toMatchObject({
        studioId: STUDIO,
        recipient: { membershipId: 'ms-1' },
        purpose: 'TRANSACTIONAL',
        templateKey: 'USAGE_PERIOD_EXPIRY_REMINDER',
        category: 'PACKAGE',
      });
      expect(c.variables).toMatchObject({ packageName: 'Paket', units: 5 });
    }
    expect(calls[0].idempotencyKey).toBe('usage-reminder:pkg-1:MONTH:2026-09-01T10:00:00.000Z:IN_APP');
    expect(calls[1].idempotencyKey).toBe('usage-reminder:pkg-1:MONTH:2026-09-01T10:00:00.000Z:PUSH');
  });

  it('sends once per period: the engine reports the repeat as a duplicate', async () => {
    const { jobs, messaging } = build();
    await jobs.remindPackage('pkg-1', STUDIO, ctx, threeDaysBefore);
    messaging.send.mockResolvedValue({ success: true, duplicate: true });
    const again = await jobs.remindPackage('pkg-1', STUDIO, ctx, new Date(threeDaysBefore.getTime() + DAY));
    expect(again).toBe(0);
    const keys = messaging.send.mock.calls.map((c) => c[0].idempotencyKey);
    expect(new Set(keys).size).toBe(2); // the same two keys both times
  });

  it('does not remind before the lead time or when the period already ended', async () => {
    const { jobs, messaging } = build();
    expect(await jobs.remindPackage('pkg-1', STUDIO, ctx, new Date('2026-09-20T00:00:00Z'))).toBe(0);
    expect(await jobs.remindPackage('pkg-1', STUDIO, ctx, new Date('2026-10-01T10:00:00Z'))).toBe(0); // exactly at the boundary: new period
    expect(messaging.send).not.toHaveBeenCalled();
  });

  it('does not remind when nothing would burn (quota fully used)', async () => {
    const { jobs, messaging } = build({ bookings: [{ at: '2026-09-10T10:00:00Z', units: 8 }] });
    expect(await jobs.remindPackage('pkg-1', STUDIO, ctx, threeDaysBefore)).toBe(0);
    expect(messaging.send).not.toHaveBeenCalled();
  });

  it('only counts burning tiers: a cap-only tier never produces a reminder', async () => {
    const { jobs, messaging } = build({ pkg: { usageRule: rule([weekCap(2)]) } });
    for (let d = 0; d < 7; d += 1) await jobs.remindPackage('pkg-1', STUDIO, ctx, new Date(START.getTime() + (30 + d) * DAY));
    expect(messaging.send).not.toHaveBeenCalled();
  });

  it('is off when reminderDaysBefore is 0', async () => {
    const { jobs, messaging } = build({ pkg: { usageRule: rule([monthBurn(8)], 0) } });
    expect(await jobs.remindPackage('pkg-1', STUDIO, ctx, threeDaysBefore)).toBe(0);
    expect(messaging.send).not.toHaveBeenCalled();
  });

  it('does not remind about a period that runs past the package end date (it never burns)', async () => {
    const { jobs, messaging } = build({ pkg: { endDate: new Date('2026-09-29T10:00:00Z') } });
    expect(await jobs.remindPackage('pkg-1', STUDIO, ctx, threeDaysBefore)).toBe(0);
    expect(messaging.send).not.toHaveBeenCalled();
  });

  it('does nothing for a package that is not ACTIVE or when the switch is off', async () => {
    const frozen = build({ pkg: { status: 'FROZEN' } });
    frozen.prisma.memberPackage.findFirst.mockResolvedValue(null);
    expect(await frozen.jobs.remindPackage('pkg-1', STUDIO, ctx, threeDaysBefore)).toBe(0);
    const off = build();
    expect(await off.jobs.remindPackage('pkg-1', STUDIO, { enabled: false, timeZone: 'UTC' }, threeDaysBefore)).toBe(0);
    expect(off.messaging.send).not.toHaveBeenCalled();
  });

  it('keeps going when one channel send throws', async () => {
    const { jobs, messaging } = build();
    messaging.send.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce({ success: true });
    expect(await jobs.remindPackage('pkg-1', STUDIO, ctx, threeDaysBefore)).toBe(1);
    expect(messaging.send).toHaveBeenCalledTimes(2);
  });
});
