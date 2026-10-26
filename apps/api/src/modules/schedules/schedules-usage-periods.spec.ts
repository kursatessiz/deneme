import { BadRequestException } from '@nestjs/common';
import { SchedulesService } from './schedules.service';
import { UsagePeriodsService } from '../usage-periods/usage-periods.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { GamificationService } from '../gamification/gamification.service';
import type { WebhooksService } from '../webhooks/webhooks.service';
import type { VideoMeetingService } from '../video/providers/video-meeting.service';
import type { TenantContext } from '../auth/tenant-context';

const STUDIO = 'studio-1';
const DAY = 24 * 60 * 60 * 1000;
const PKG_START = new Date(Date.now() - 10 * DAY);
const SESSION_START = new Date(Date.now() + 2 * DAY);

const tenant: TenantContext = {
  studioId: STUDIO,
  membershipId: 'm1',
  isOwner: true,
  isSuperAdmin: false,
  permissions: new Set(['bookings.manage']),
  memberProfileId: null,
  trainerProfileId: null,
  branchIds: null,
};

const weekCap = { version: 1, tiers: [{ unit: 'WEEK', length: 1, quota: 1, expireUnused: false }], reminderDaysBefore: 3 };

interface PkgSeed {
  id: string;
  endInDays: number;
  usageRule: unknown;
  remainingUnits?: number;
}

/** Bookings of the member by package id; each is placed in the same week as the session (one day before it). */
function build(opts: { enabled?: boolean; packages: PkgSeed[]; bookedBy?: Record<string, number>; bookedAfterFirstCheck?: Record<string, number> }) {
  const state = { calls: 0 };
  const rows = opts.packages.map((p) => ({
    id: p.id,
    studioId: STUDIO,
    memberId: 'member-1',
    packageDefinitionId: `def-${p.id}`,
    entitlementKind: 'SESSION_COUNT',
    totalUnits: 10,
    usedUnits: 0,
    remainingUnits: p.remainingUnits ?? 5,
    status: 'ACTIVE',
    startDate: PKG_START,
    endDate: new Date(Date.now() + p.endInDays * DAY),
    frozenUntil: null,
    createdAt: PKG_START,
    usageRule: p.usageRule,
    packageDefinition: { name: `Paket ${p.id}`, services: [{ serviceTypeId: 'service-1', unitCost: 1 }] },
  }));
  const prisma = {
    sessionSchedule: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'schedule-1',
        studioId: STUDIO,
        serviceTypeId: 'service-1',
        capacity: 5,
        bookedCount: 0,
        isCancelled: false,
        startTime: SESSION_START,
        endTime: new Date(SESSION_START.getTime() + 3_600_000),
        serviceType: { id: 'service-1', requiredResourceTypes: [], minRepeatIntervalDays: null, allowedEntitlementKinds: [] },
      }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    memberProfile: { findFirst: jest.fn().mockResolvedValue({ id: 'member-1', studioId: STUDIO }) },
    memberPackage: {
      findMany: jest.fn().mockResolvedValue(rows),
      findFirst: jest.fn(async (args: { where: { id: string } }) => rows.find((r) => r.id === args.where.id) ?? null),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    packageDefinitionService: { findUnique: jest.fn().mockResolvedValue({ unitCost: 1 }) },
    studio: { findUnique: jest.fn().mockResolvedValue({ usagePeriodsEnabled: opts.enabled ?? true, timezone: 'UTC' }) },
    packageFreezeHistory: { findMany: jest.fn().mockResolvedValue([]) },
    booking: {
      findMany: jest.fn(async (args: { where: { memberPackageId: string } }) => {
        state.calls += 1;
        const id = args.where.memberPackageId;
        const n = (opts.bookedBy?.[id] ?? 0) + (state.calls > 1 ? (opts.bookedAfterFirstCheck?.[id] ?? 0) : 0);
        return Array.from({ length: n }, () => ({ status: 'CONFIRMED', unitsCharged: 1, penaltyUnits: 0 }));
      }),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      create: jest.fn(async (args: { data: Record<string, unknown> }) => ({ id: 'booking-1', ...args.data })),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    eventRegistration: { findMany: jest.fn().mockResolvedValue([]) },
    packageUnitExpiry: { findMany: jest.fn().mockResolvedValue([]) },
    bookingResource: { create: jest.fn(), deleteMany: jest.fn() },
    waitlist: { updateMany: jest.fn().mockResolvedValue({ count: 0 }), findFirst: jest.fn() },
    auditLog: { create: jest.fn() },
    $queryRaw: jest.fn().mockResolvedValue([]),
    $executeRaw: jest.fn(),
    $transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
  };
  const usage = new UsagePeriodsService(prisma as unknown as PrismaService);
  const service = new SchedulesService(
    prisma as unknown as PrismaService,
    { notifyUser: jest.fn() } as unknown as NotificationsService,
    { onAttendance: jest.fn() } as unknown as GamificationService,
    { emit: jest.fn() } as unknown as WebhooksService,
    { createLink: jest.fn() } as unknown as VideoMeetingService,
    undefined,
    usage,
  );
  return { prisma, service };
}

const dto = { studioId: STUDIO, scheduleId: 'schedule-1', memberId: 'member-1', resourceIds: [] };

describe('SchedulesService usage period enforcement', () => {
  it('books and charges normally while the quota has room', async () => {
    const { prisma, service } = build({ packages: [{ id: 'a', endInDays: 30, usageRule: weekCap }] });
    const result = await service.bookSession(tenant, dto);
    expect(result.memberPackageId).toBe('a');
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1); // row lock taken for a package with a rule
  });

  it('picks another package when the soonest expiring one has its period quota reached', async () => {
    const { service } = build({
      packages: [
        { id: 'soon', endInDays: 5, usageRule: weekCap },
        { id: 'later', endInDays: 40, usageRule: null },
      ],
      bookedBy: { soon: 1 },
    });
    const result = await service.bookSession(tenant, dto);
    expect(result.memberPackageId).toBe('later');
  });

  it('refuses with the period quota error when the only package is full', async () => {
    const { prisma, service } = build({ packages: [{ id: 'only', endInDays: 30, usageRule: weekCap }], bookedBy: { only: 1 } });
    await expect(service.bookSession(tenant, dto)).rejects.toMatchObject({ response: { code: 'apiErrors.schedules.periodQuotaReached' } });
    expect(prisma.booking.create).not.toHaveBeenCalled();
  });

  it('refuses an explicitly chosen package whose quota is reached, even though another package could pay', async () => {
    const { prisma, service } = build({
      packages: [
        { id: 'full', endInDays: 5, usageRule: weekCap },
        { id: 'other', endInDays: 40, usageRule: null },
      ],
      bookedBy: { full: 1 },
    });
    await expect(service.bookSession(tenant, { ...dto, memberPackageId: 'full' })).rejects.toMatchObject({
      response: { code: 'apiErrors.schedules.periodQuotaReached' },
    });
    expect(prisma.booking.create).not.toHaveBeenCalled();
  });

  it('ignores the rule while the studio switch is off', async () => {
    const { prisma, service } = build({ enabled: false, packages: [{ id: 'only', endInDays: 30, usageRule: weekCap }], bookedBy: { only: 3 } });
    const result = await service.bookSession(tenant, dto);
    expect(result.memberPackageId).toBe('only');
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('re-checks under the row lock: a booking that slipped in after the first check blocks the charge', async () => {
    const { prisma, service } = build({ packages: [{ id: 'a', endInDays: 30, usageRule: weekCap }], bookedAfterFirstCheck: { a: 1 } });
    await expect(service.bookSession(tenant, dto)).rejects.toThrow(BadRequestException);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(prisma.booking.create).not.toHaveBeenCalled();
    expect(prisma.memberPackage.updateMany).not.toHaveBeenCalled(); // nothing was decremented
  });

  it('does not touch a package without a rule at all (no lock)', async () => {
    const { prisma, service } = build({ packages: [{ id: 'plain', endInDays: 30, usageRule: null }] });
    await service.bookSession(tenant, dto);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
});

describe('SchedulesService waitlist promotion with a full period quota', () => {
  it('skips the entry, keeps it on the waitlist and promotes the next member', async () => {
    const { prisma, service } = build({ packages: [{ id: 'full', endInDays: 30, usageRule: weekCap }], bookedBy: { full: 1 } });
    const entries = [
      { id: 'w1', memberId: 'member-1', memberPackageId: 'full', position: 1, status: 'WAITING' },
      { id: 'w2', memberId: 'member-2', memberPackageId: null, position: 2, status: 'WAITING' },
    ];
    const claimed: string[] = [];
    prisma.waitlist.findFirst.mockImplementation(async (args: { where: { id?: { notIn: string[] } } }) => {
      const skipped = args.where.id?.notIn ?? [];
      return entries.find((e) => !skipped.includes(e.id) && !claimed.includes(e.id)) ?? null;
    });
    const statusUpdates: { id: string; status: string }[] = [];
    prisma.waitlist.updateMany.mockImplementation(async (args: { where: { id?: string }; data: { status?: string } }) => {
      if (args.where.id && args.data.status) statusUpdates.push({ id: args.where.id, status: args.data.status });
      if (args.where.id && args.data.status === 'OFFERED') claimed.push(args.where.id);
      if (args.where.id && args.data.status === 'WAITING') claimed.splice(claimed.indexOf(args.where.id), 1);
      return { count: 1 };
    });
    // member-2 has no usable package: the entry fails the normal way, which is enough to show the loop moved on.
    prisma.memberPackage.findMany.mockImplementation(async (args: { where: { memberId: string } }) => (args.where.memberId === 'member-1' ? [] : []));
    await service.promoteFromWaitlist(STUDIO, 'schedule-1').catch(() => undefined);

    // w1 went OFFERED -> back to WAITING (never EXPIRED), and the loop then reached w2.
    expect(statusUpdates.filter((u) => u.id === 'w1').map((u) => u.status)).toEqual(['OFFERED', 'WAITING']);
    expect(statusUpdates.some((u) => u.id === 'w2' && u.status === 'OFFERED')).toBe(true);
    expect(statusUpdates.some((u) => u.id === 'w1' && u.status === 'EXPIRED')).toBe(false);
  });
});
