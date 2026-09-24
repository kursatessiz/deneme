import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@platform/database';
import { resolvePermissions } from '@platform/shared';
import type {
  BranchDTO,
  BranchSummaryDTO,
  CreateBranchInput,
  PortfolioSummaryDTO,
  ReportRange,
  SetStaffBranchesInput,
  StudioPortfolioItemDTO,
  UpdateBranchInput,
} from '@platform/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { TenantContext } from '../auth/tenant-context';
import { assertBranchAccess, assertUnrestricted } from './branch-access';

const UNASSIGNED_LABEL = 'Şubesiz';

interface BookingAggregateRow {
  branch_id: string | null;
  booked: bigint;
  attended: bigint;
  no_shows: bigint;
  late_cancellations: bigint;
}

interface ScheduleAggregateRow {
  branch_id: string | null;
  sessions: bigint;
  capacity: bigint | null;
}

@Injectable()
export class BranchesService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------------
  // CRUD
  // ---------------------------------------------------------------------------

  /** Active branches for everyone; managers also see inactive ones. */
  async list(tenant: TenantContext): Promise<BranchDTO[]> {
    const canManage = tenant.permissions.has('branches.manage');
    const rows = await this.prisma.branch.findMany({
      where: { studioId: tenant.studioId, ...(canManage ? {} : { isActive: true }) },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    return rows.map(toBranchDTO);
  }

  async create(tenant: TenantContext, actorUserId: string, dto: CreateBranchInput): Promise<BranchDTO> {
    assertUnrestricted(tenant);
    try {
      const branch = await this.prisma.branch.create({
        data: {
          studioId: tenant.studioId,
          name: dto.name,
          address: dto.address ?? null,
          phone: dto.phone ?? null,
          email: dto.email ?? null,
          timezone: dto.timezone ?? null,
          sortOrder: dto.sortOrder,
        },
      });
      await this.audit(tenant.studioId, actorUserId, 'branch.create', branch.id, { name: branch.name });
      return toBranchDTO(branch);
    } catch (err) {
      throw this.mapUnique(err);
    }
  }

  async update(tenant: TenantContext, actorUserId: string, branchId: string, dto: UpdateBranchInput): Promise<BranchDTO> {
    const branch = await this.getOwned(tenant, branchId);
    assertBranchAccess(tenant, branch.id);

    if (dto.isActive === false && branch.isActive) {
      const upcoming = await this.prisma.sessionSchedule.count({
        where: { studioId: tenant.studioId, branchId, isCancelled: false, startTime: { gt: new Date() } },
      });
      if (upcoming > 0) {
        throw new BadRequestException(
          `Bu şubede ${upcoming} ileri tarihli seans var. Önce seansları iptal edin veya başka şubeye taşıyın.`,
        );
      }
    }

    try {
      const updated = await this.prisma.branch.update({
        where: { id: branch.id },
        data: {
          name: dto.name,
          address: dto.address,
          phone: dto.phone,
          email: dto.email,
          timezone: dto.timezone,
          sortOrder: dto.sortOrder,
          isActive: dto.isActive,
        },
      });
      await this.audit(tenant.studioId, actorUserId, 'branch.update', branch.id, { changes: dto });
      return toBranchDTO(updated);
    } catch (err) {
      throw this.mapUnique(err);
    }
  }

  // ---------------------------------------------------------------------------
  // Staff access
  // ---------------------------------------------------------------------------

  async getStaffBranches(tenant: TenantContext, membershipId: string): Promise<{ membershipId: string; branchIds: string[] }> {
    await this.getStaffMembership(tenant, membershipId);
    const rows = await this.prisma.membershipBranch.findMany({
      where: { membershipId, studioId: tenant.studioId },
      select: { branchId: true },
    });
    return { membershipId, branchIds: rows.map((r) => r.branchId) };
  }

  /** Replaces the grants. An empty list gives access to every branch. */
  async setStaffBranches(
    tenant: TenantContext,
    actorUserId: string,
    membershipId: string,
    dto: SetStaffBranchesInput,
  ): Promise<{ membershipId: string; branchIds: string[] }> {
    assertUnrestricted(tenant);
    const membership = await this.getStaffMembership(tenant, membershipId);
    if (membership.roleTemplate.isOwner) {
      throw new BadRequestException('İşletme sahibi tüm şubelere erişir; şube kısıtı uygulanamaz');
    }

    const branchIds = [...new Set(dto.branchIds)];
    if (branchIds.length > 0) {
      const found = await this.prisma.branch.count({ where: { id: { in: branchIds }, studioId: tenant.studioId } });
      if (found !== branchIds.length) {
        throw new BadRequestException('Seçilen şubelerden biri bu işletmeye ait değil');
      }
    }

    await this.prisma.$transaction([
      this.prisma.membershipBranch.deleteMany({ where: { membershipId, studioId: tenant.studioId } }),
      this.prisma.membershipBranch.createMany({
        data: branchIds.map((branchId) => ({ membershipId, branchId, studioId: tenant.studioId })),
      }),
      this.prisma.auditLog.create({
        data: {
          studioId: tenant.studioId,
          userId: actorUserId,
          action: 'membership.branches.set',
          entityType: 'Membership',
          entityId: membershipId,
          metadata: { branchIds },
        },
      }),
    ]);
    return { membershipId, branchIds };
  }

  // ---------------------------------------------------------------------------
  // Reporting
  // ---------------------------------------------------------------------------

  /** Per-branch activity. Restricted staff only see their own branches. */
  async summary(tenant: TenantContext, range: ReportRange): Promise<BranchSummaryDTO[]> {
    const branches = await this.prisma.branch.findMany({
      where: { studioId: tenant.studioId },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, isActive: true },
    });
    const rows = await this.aggregate(tenant.studioId, range);

    const visible = branches.filter((b) => tenant.branchIds === null || tenant.branchIds.has(b.id));
    const result = visible
      .filter((b) => b.isActive || rows.has(b.id))
      .map((b) => rows.get(b.id) ?? emptySummary(b.id, b.name))
      .map((r) => ({ ...r, branchName: branches.find((b) => b.id === r.branchId)?.name ?? r.branchName }));

    // Studio-wide activity is only shown to unrestricted users.
    const unassigned = rows.get(null);
    if (tenant.branchIds === null && unassigned && hasActivity(unassigned)) {
      result.push(unassigned);
    }
    return result;
  }

  /**
   * One row per studio where the caller can read reports across all
   * branches: owners of several businesses (franchise view).
   */
  async portfolio(userId: string, range: ReportRange): Promise<PortfolioSummaryDTO> {
    const memberships = await this.prisma.membership.findMany({
      where: { userId, status: 'ACTIVE', studio: { isActive: true } },
      include: {
        studio: { select: { id: true, name: true } },
        roleTemplate: { include: { permissions: true } },
        branchAccess: { select: { branchId: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    const eligible = memberships.filter((m) => {
      const perms = resolvePermissions({
        isOwner: m.roleTemplate.isOwner,
        permissions: m.roleTemplate.permissions.map((p) => p.permissionKey),
      });
      const unrestricted = m.roleTemplate.isOwner || m.branchAccess.length === 0;
      return unrestricted && perms.includes('reports.view');
    });

    const studios: StudioPortfolioItemDTO[] = [];
    for (const m of eligible) {
      const studioId = m.studio.id;
      const [rows, branchCount, activeMembers] = await Promise.all([
        this.aggregate(studioId, range),
        this.prisma.branch.count({ where: { studioId, isActive: true } }),
        this.prisma.memberProfile.count({ where: { studioId, membership: { status: 'ACTIVE' } } }),
      ]);
      const all = [...rows.values()];
      const capacity = sum(all.map((r) => r.capacity));
      const booked = sum(all.map((r) => r.booked));
      studios.push({
        studioId,
        studioName: m.studio.name,
        branchCount,
        activeMembers,
        sessions: sum(all.map((r) => r.sessions)),
        occupancy: ratio(booked, capacity),
        revenue: all.reduce((acc, r) => acc.add(new Prisma.Decimal(r.revenue)), new Prisma.Decimal(0)).toFixed(2),
      });
    }

    const totalCapacityWeighted = studios.reduce((acc, s) => acc + s.occupancy * s.sessions, 0);
    const totalSessions = sum(studios.map((s) => s.sessions));
    return {
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      studios,
      totals: {
        branchCount: sum(studios.map((s) => s.branchCount)),
        activeMembers: sum(studios.map((s) => s.activeMembers)),
        sessions: totalSessions,
        occupancy: totalSessions === 0 ? 0 : round(totalCapacityWeighted / totalSessions),
        revenue: studios.reduce((acc, s) => acc.add(new Prisma.Decimal(s.revenue)), new Prisma.Decimal(0)).toFixed(2),
      },
    };
  }

  /** Aggregates keyed by branch id (null = sessions or payments without a branch). */
  private async aggregate(studioId: string, range: ReportRange): Promise<Map<string | null, BranchSummaryDTO>> {
    const [scheduleRows, bookingRows, payments, homeMembers] = await Promise.all([
      this.prisma.$queryRaw<ScheduleAggregateRow[]>(Prisma.sql`
        SELECT s.branch_id, COUNT(*)::bigint AS sessions, SUM(s.capacity)::bigint AS capacity
        FROM session_schedules s
        WHERE s.studio_id = ${studioId}::uuid
          AND s.is_cancelled = false
          AND s.start_time >= ${range.from} AND s.start_time < ${range.to}
        GROUP BY s.branch_id`),
      this.prisma.$queryRaw<BookingAggregateRow[]>(Prisma.sql`
        SELECT s.branch_id,
          COUNT(*) FILTER (WHERE b.status IN ('CONFIRMED', 'ATTENDED', 'NO_SHOW'))::bigint AS booked,
          COUNT(*) FILTER (WHERE b.status = 'ATTENDED')::bigint AS attended,
          COUNT(*) FILTER (WHERE b.status = 'NO_SHOW')::bigint AS no_shows,
          COUNT(*) FILTER (WHERE b.status = 'CANCELLED_LATE')::bigint AS late_cancellations
        FROM bookings b
        JOIN session_schedules s ON s.id = b.schedule_id
        WHERE b.studio_id = ${studioId}::uuid
          AND s.is_cancelled = false
          AND s.start_time >= ${range.from} AND s.start_time < ${range.to}
        GROUP BY s.branch_id`),
      this.prisma.payment.groupBy({
        by: ['branchId'],
        where: { studioId, paymentStatus: 'COMPLETED', paidAt: { gte: range.from, lt: range.to } },
        _sum: { amount: true },
      }),
      this.prisma.memberProfile.groupBy({
        by: ['homeBranchId'],
        where: { studioId, membership: { status: 'ACTIVE' } },
        _count: { _all: true },
      }),
    ]);

    const out = new Map<string | null, BranchSummaryDTO>();
    const row = (id: string | null) => {
      let r = out.get(id);
      if (!r) {
        r = emptySummary(id, UNASSIGNED_LABEL);
        out.set(id, r);
      }
      return r;
    };
    for (const s of scheduleRows) {
      const r = row(s.branch_id);
      r.sessions = Number(s.sessions);
      r.capacity = Number(s.capacity ?? 0);
    }
    for (const b of bookingRows) {
      const r = row(b.branch_id);
      r.booked = Number(b.booked);
      r.attended = Number(b.attended);
      r.noShows = Number(b.no_shows);
      r.lateCancellations = Number(b.late_cancellations);
    }
    for (const p of payments) {
      row(p.branchId).revenue = (p._sum.amount ?? new Prisma.Decimal(0)).toFixed(2);
    }
    for (const h of homeMembers) {
      row(h.homeBranchId).homeMembers = h._count._all;
    }
    for (const r of out.values()) {
      r.occupancy = ratio(r.booked, r.capacity);
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async getOwned(tenant: TenantContext, branchId: string) {
    const branch = await this.prisma.branch.findFirst({ where: { id: branchId, studioId: tenant.studioId } });
    if (!branch) throw new NotFoundException('Şube bulunamadı');
    return branch;
  }

  private async getStaffMembership(tenant: TenantContext, membershipId: string) {
    const membership = await this.prisma.membership.findFirst({
      where: { id: membershipId, studioId: tenant.studioId },
      include: { roleTemplate: { select: { isOwner: true } } },
    });
    if (!membership) throw new NotFoundException('Personel bulunamadı');
    return membership;
  }

  private async audit(studioId: string, userId: string, action: string, entityId: string, metadata: object) {
    await this.prisma.auditLog.create({
      data: { studioId, userId, action, entityType: 'Branch', entityId, metadata: metadata as Prisma.InputJsonValue },
    });
  }

  private mapUnique(err: unknown): unknown {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return new ConflictException('Bu isimde bir şube zaten var');
    }
    return err;
  }
}

function toBranchDTO(b: {
  id: string;
  studioId: string;
  name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  timezone: string | null;
  sortOrder: number;
  isActive: boolean;
}): BranchDTO {
  return {
    id: b.id,
    studioId: b.studioId,
    name: b.name,
    address: b.address,
    phone: b.phone,
    email: b.email,
    timezone: b.timezone,
    sortOrder: b.sortOrder,
    isActive: b.isActive,
  };
}

function emptySummary(branchId: string | null, branchName: string): BranchSummaryDTO {
  return {
    branchId,
    branchName,
    sessions: 0,
    capacity: 0,
    booked: 0,
    attended: 0,
    noShows: 0,
    lateCancellations: 0,
    occupancy: 0,
    revenue: '0.00',
    homeMembers: 0,
  };
}

function hasActivity(r: BranchSummaryDTO): boolean {
  return r.sessions > 0 || r.booked > 0 || r.revenue !== '0.00' || r.homeMembers > 0;
}

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function ratio(part: number, whole: number): number {
  return whole === 0 ? 0 : round(part / whole);
}
