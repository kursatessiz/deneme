import { Injectable } from '@nestjs/common';
import { Prisma } from '@platform/database';
import type {
  CohortReportDTO,
  MembersReportDTO,
  OccupancyDayRowDTO,
  OccupancyHeatmapCellDTO,
  OccupancyReportDTO,
  OccupancyServiceRowDTO,
  ReportFilters,
  ReportGranularity,
  ReportRange,
  RenewalReportDTO,
  RevenueMethodRowDTO,
  RevenuePackageRowDTO,
  RevenuePeriodRowDTO,
  RevenueReportDTO,
  TrainerReportDTO,
  TrainerReportRowDTO,
} from '@platform/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { TenantContext } from '../auth/tenant-context';
import { assertBranchAccess } from '../branches/branch-access';
import {
  buildCohorts,
  countChurned,
  computeRenewalRate,
  ratio,
  type CohortMemberActivity,
  type PackageEndInfo,
} from './report-calculations';

const ZERO = new Prisma.Decimal(0);
const COHORT_MAX_MONTHS = 12;

interface OccupancyDayRow {
  day: Date;
  sessions: bigint;
  capacity: bigint | null;
  booked: bigint;
  attended: bigint;
}

interface OccupancyServiceRow {
  service_type_id: string;
  service_type_name: string;
  sessions: bigint;
  capacity: bigint | null;
  booked: bigint;
  attended: bigint;
}

interface OccupancyHeatmapRow {
  weekday: number;
  hour: number;
  sessions: bigint;
  capacity: bigint | null;
  booked: bigint;
}

interface RevenuePeriodRow {
  period: Date;
  amount: Prisma.Decimal;
  payment_count: bigint;
}

interface RevenuePackageRow {
  package_definition_id: string | null;
  package_definition_name: string | null;
  amount: Prisma.Decimal;
  payment_count: bigint;
}

interface TrainerRow {
  trainer_profile_id: string;
  trainer_name: string;
  sessions: bigint;
  capacity: bigint | null;
  booked: bigint;
  attended: bigint;
  no_shows: bigint;
  late_cancellations: bigint;
  substitutions: bigint;
}

@Injectable()
export class ReportsService {

  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------------
  // 1. Occupancy
  // ---------------------------------------------------------------------------

  async occupancy(tenant: TenantContext, range: ReportRange, filters: ReportFilters): Promise<OccupancyReportDTO> {
    const branchId = this.resolveBranchFilter(tenant, filters);
    const tz = await this.studioTimezone(tenant.studioId);
    const branchSql = this.branchScopeRaw(tenant, branchId, Prisma.sql`s.branch_id`);

    // Pre-aggregate bookings per schedule first: joining bookings straight
    // into a schedule-level GROUP BY would multiply SUM(s.capacity) by the
    // booking row count for that schedule.
    const scheduleCte = Prisma.sql`
      sched AS (
        SELECT s.id, s.branch_id, s.service_type_id, s.capacity,
          (s.start_time AT TIME ZONE 'UTC' AT TIME ZONE ${tz})::date AS day,
          EXTRACT(ISODOW FROM (s.start_time AT TIME ZONE 'UTC' AT TIME ZONE ${tz}))::int - 1 AS weekday,
          EXTRACT(HOUR FROM (s.start_time AT TIME ZONE 'UTC' AT TIME ZONE ${tz}))::int AS hour
        FROM session_schedules s
        WHERE s.studio_id = ${tenant.studioId}::uuid
          AND s.is_cancelled = false
          AND s.start_time >= ${range.from} AND s.start_time < ${range.to}
          ${branchSql}
      ),
      book AS (
        SELECT b.schedule_id,
          COUNT(*) FILTER (WHERE b.status IN ('CONFIRMED', 'ATTENDED', 'NO_SHOW')) AS booked,
          COUNT(*) FILTER (WHERE b.status = 'ATTENDED') AS attended
        FROM bookings b
        WHERE b.schedule_id IN (SELECT id FROM sched)
        GROUP BY b.schedule_id
      )`;

    const [dayRows, serviceRows, heatmapRows] = await Promise.all([
      this.prisma.$queryRaw<OccupancyDayRow[]>(Prisma.sql`
        WITH ${scheduleCte}
        SELECT
          sched.day AS day,
          COUNT(*)::bigint AS sessions,
          SUM(sched.capacity)::bigint AS capacity,
          COALESCE(SUM(book.booked), 0)::bigint AS booked,
          COALESCE(SUM(book.attended), 0)::bigint AS attended
        FROM sched
        LEFT JOIN book ON book.schedule_id = sched.id
        GROUP BY sched.day
        ORDER BY sched.day`),
      this.prisma.$queryRaw<OccupancyServiceRow[]>(Prisma.sql`
        WITH ${scheduleCte}
        SELECT
          st.id AS service_type_id,
          st.name AS service_type_name,
          COUNT(*)::bigint AS sessions,
          SUM(sched.capacity)::bigint AS capacity,
          COALESCE(SUM(book.booked), 0)::bigint AS booked,
          COALESCE(SUM(book.attended), 0)::bigint AS attended
        FROM sched
        JOIN service_types st ON st.id = sched.service_type_id
        LEFT JOIN book ON book.schedule_id = sched.id
        GROUP BY st.id, st.name
        ORDER BY st.name`),
      this.prisma.$queryRaw<OccupancyHeatmapRow[]>(Prisma.sql`
        WITH ${scheduleCte}
        SELECT
          sched.weekday AS weekday,
          sched.hour AS hour,
          COUNT(*)::bigint AS sessions,
          SUM(sched.capacity)::bigint AS capacity,
          COALESCE(SUM(book.booked), 0)::bigint AS booked
        FROM sched
        LEFT JOIN book ON book.schedule_id = sched.id
        GROUP BY sched.weekday, sched.hour`),
    ]);

    const byDay: OccupancyDayRowDTO[] = dayRows.map((r) => {
      const capacity = Number(r.capacity ?? 0);
      const booked = Number(r.booked);
      return {
        date: toIsoDate(r.day),
        sessions: Number(r.sessions),
        capacity,
        booked,
        attended: Number(r.attended),
        occupancy: ratio(booked, capacity),
      };
    });

    const byServiceType: OccupancyServiceRowDTO[] = serviceRows.map((r) => {
      const capacity = Number(r.capacity ?? 0);
      const booked = Number(r.booked);
      return {
        serviceTypeId: r.service_type_id,
        serviceTypeName: r.service_type_name,
        sessions: Number(r.sessions),
        capacity,
        booked,
        attended: Number(r.attended),
        occupancy: ratio(booked, capacity),
      };
    });

    const heatmapByCell = new Map<string, OccupancyHeatmapCellDTO>();
    for (const r of heatmapRows) {
      const capacity = Number(r.capacity ?? 0);
      const booked = Number(r.booked);
      heatmapByCell.set(`${r.weekday}-${r.hour}`, {
        weekday: r.weekday,
        hour: r.hour,
        sessions: Number(r.sessions),
        capacity,
        booked,
        occupancy: ratio(booked, capacity),
      });
    }
    const heatmap: OccupancyHeatmapCellDTO[] = [];
    for (let weekday = 0; weekday < 7; weekday++) {
      for (let hour = 0; hour < 24; hour++) {
        heatmap.push(
          heatmapByCell.get(`${weekday}-${hour}`) ?? { weekday, hour, sessions: 0, capacity: 0, booked: 0, occupancy: 0 },
        );
      }
    }

    return { from: range.from.toISOString(), to: range.to.toISOString(), byDay, byServiceType, heatmap };
  }

  // ---------------------------------------------------------------------------
  // 2. Revenue
  // ---------------------------------------------------------------------------

  async revenue(
    tenant: TenantContext,
    range: ReportRange,
    filters: ReportFilters,
    granularity: ReportGranularity,
  ): Promise<RevenueReportDTO> {
    const branchId = this.resolveBranchFilter(tenant, filters);
    const tz = await this.studioTimezone(tenant.studioId);
    const branchSql = this.branchScopeRaw(tenant, branchId, Prisma.sql`p.branch_id`);
    const bucket = granularity === 'week' ? 'week' : granularity === 'month' ? 'month' : 'day';

    const [periodRows, methodRows, packageRows, totalRow, refundRow] = await Promise.all([
      this.prisma.$queryRaw<RevenuePeriodRow[]>(Prisma.sql`
        SELECT
          date_trunc(${bucket}, p.paid_at AT TIME ZONE 'UTC' AT TIME ZONE ${tz}) AS period,
          SUM(p.amount) AS amount,
          COUNT(*)::bigint AS payment_count
        FROM payments p
        WHERE p.studio_id = ${tenant.studioId}::uuid
          AND p.payment_status IN ('COMPLETED', 'REFUNDED')
          AND p.paid_at >= ${range.from} AND p.paid_at < ${range.to}
          ${branchSql}
        GROUP BY period
        ORDER BY period`),
      this.prisma.payment.groupBy({
        by: ['paymentMethod'],
        where: {
          studioId: tenant.studioId,
          // Gross revenue: refunded payments were revenue first; refunds are reported separately.
          paymentStatus: { in: ['COMPLETED', 'REFUNDED'] },
          paidAt: { gte: range.from, lt: range.to },
          ...(branchId ? { branchId } : tenant.branchIds ? { OR: [{ branchId: { in: [...tenant.branchIds] } }, { branchId: null }] } : {}),
        },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      this.prisma.$queryRaw<RevenuePackageRow[]>(Prisma.sql`
        SELECT
          pd.id AS package_definition_id,
          pd.name AS package_definition_name,
          SUM(p.amount) AS amount,
          COUNT(*)::bigint AS payment_count
        FROM payments p
        LEFT JOIN member_packages mp ON mp.id = p.member_package_id
        LEFT JOIN package_definitions pd ON pd.id = mp.package_definition_id
        WHERE p.studio_id = ${tenant.studioId}::uuid
          AND p.payment_status IN ('COMPLETED', 'REFUNDED')
          AND p.paid_at >= ${range.from} AND p.paid_at < ${range.to}
          ${branchSql}
        GROUP BY pd.id, pd.name
        ORDER BY amount DESC`),
      this.prisma.payment.aggregate({
        where: {
          studioId: tenant.studioId,
          // Gross revenue: refunded payments were revenue first; refunds are reported separately.
          paymentStatus: { in: ['COMPLETED', 'REFUNDED'] },
          paidAt: { gte: range.from, lt: range.to },
          ...(branchId ? { branchId } : tenant.branchIds ? { OR: [{ branchId: { in: [...tenant.branchIds] } }, { branchId: null }] } : {}),
        },
        _sum: { amount: true },
      }),
      this.prisma.$queryRaw<{ refund_total: Prisma.Decimal | null }[]>(Prisma.sql`
        SELECT SUM(p.refunded_amount) AS refund_total
        FROM payments p
        WHERE p.studio_id = ${tenant.studioId}::uuid
          AND p.payment_status IN ('COMPLETED', 'REFUNDED')
          AND p.paid_at >= ${range.from} AND p.paid_at < ${range.to}
          ${branchSql}`),
    ]);

    const byPeriod: RevenuePeriodRowDTO[] = periodRows.map((r) => ({
      period: bucket === 'month' ? toIsoMonth(r.period) : toIsoDate(r.period),
      amount: decimalOrZero(r.amount).toFixed(2),
      paymentCount: Number(r.payment_count),
    }));

    const byMethod: RevenueMethodRowDTO[] = methodRows.map((r) => ({
      paymentMethod: r.paymentMethod,
      amount: decimalOrZero(r._sum.amount).toFixed(2),
      paymentCount: r._count._all,
    }));

    const byPackage: RevenuePackageRowDTO[] = packageRows.map((r) => ({
      packageDefinitionId: r.package_definition_id,
      packageDefinitionName: r.package_definition_name ?? 'Paketsiz',
      amount: decimalOrZero(r.amount).toFixed(2),
      paymentCount: Number(r.payment_count),
    }));

    return {
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      granularity,
      total: decimalOrZero(totalRow._sum.amount).toFixed(2),
      byPeriod,
      byMethod,
      byPackage,
      refundTotal: decimalOrZero(refundRow[0]?.refund_total ?? null).toFixed(2),
      netTotal: decimalOrZero(totalRow._sum.amount).minus(decimalOrZero(refundRow[0]?.refund_total ?? null)).toFixed(2),
    };
  }

  // ---------------------------------------------------------------------------
  // 3. Members (active, new, churn, ARPU)
  // ---------------------------------------------------------------------------

  async members(tenant: TenantContext, range: ReportRange, filters: ReportFilters): Promise<MembersReportDTO> {
    const branchId = this.resolveBranchFilter(tenant, filters);
    const homeBranchWhere = branchId
      ? { homeBranchId: branchId }
      : tenant.branchIds
        ? { OR: [{ homeBranchId: { in: [...tenant.branchIds] } }, { homeBranchId: null }] }
        : {};

    const [activeMembers, newMembers, revenueRow, endings] = await Promise.all([
      this.prisma.memberProfile.count({
        where: { studioId: tenant.studioId, membership: { status: 'ACTIVE' }, ...homeBranchWhere },
      }),
      this.prisma.memberProfile.count({
        where: {
          studioId: tenant.studioId,
          ...homeBranchWhere,
          membership: { status: 'ACTIVE', joinedAt: { gte: range.from, lt: range.to } },
        },
      }),
      this.prisma.payment.aggregate({
        where: {
          studioId: tenant.studioId,
          // Gross revenue: refunded payments were revenue first; refunds are reported separately.
          paymentStatus: { in: ['COMPLETED', 'REFUNDED'] },
          paidAt: { gte: range.from, lt: range.to },
          ...(branchId
            ? { branchId }
            : tenant.branchIds
              ? { OR: [{ branchId: { in: [...tenant.branchIds] } }, { branchId: null }] }
              : {}),
        },
        _sum: { amount: true },
      }),
      this.lastPackageEndings(tenant, range, branchId),
    ]);

    const revenue = decimalOrZero(revenueRow._sum.amount);
    const arpu = activeMembers === 0 ? ZERO : revenue.div(activeMembers);

    return {
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      activeMembers,
      newMembers,
      churnedMembers: countChurned(endings),
      revenue: revenue.toFixed(2),
      arpu: arpu.toFixed(2),
    };
  }

  // ---------------------------------------------------------------------------
  // 4. Renewal rate
  // ---------------------------------------------------------------------------

  async renewal(tenant: TenantContext, range: ReportRange, filters: ReportFilters): Promise<RenewalReportDTO> {
    const branchId = this.resolveBranchFilter(tenant, filters);
    const endings = await this.lastPackageEndings(tenant, range, branchId);
    const { expiredPackages, renewedPackages, renewalRate } = computeRenewalRate(endings);
    return { from: range.from.toISOString(), to: range.to.toISOString(), expiredPackages, renewedPackages, renewalRate };
  }

  /**
   * The last package each member had that ended inside the range, and the
   * start date of whatever package (if any) they bought right after it.
   * Members are limited to those whose home branch is visible to the caller.
   */
  private async lastPackageEndings(tenant: TenantContext, range: ReportRange, branchId?: string): Promise<PackageEndInfo[]> {
    const branchSql = this.branchScopeRaw(tenant, branchId, Prisma.sql`mprof.home_branch_id`);
    const rows = await this.prisma.$queryRaw<{ member_id: string; end_date: Date; next_start: Date | null }[]>(Prisma.sql`
      WITH last_ending AS (
        SELECT DISTINCT ON (mp.member_id) mp.member_id, mp.end_date
        FROM member_packages mp
        JOIN member_profiles mprof ON mprof.id = mp.member_id
        WHERE mp.studio_id = ${tenant.studioId}::uuid
          AND mp.end_date >= ${range.from} AND mp.end_date < ${range.to}
          ${branchSql}
        ORDER BY mp.member_id, mp.end_date DESC
      )
      SELECT
        le.member_id,
        le.end_date,
        (SELECT MIN(next.start_date) FROM member_packages next
         WHERE next.member_id = le.member_id AND next.start_date > le.end_date) AS next_start
      FROM last_ending le`);

    return rows.map((r) => ({ memberId: r.member_id, endDate: r.end_date, nextPurchaseDate: r.next_start }));
  }

  // ---------------------------------------------------------------------------
  // 5. Cohorts
  // ---------------------------------------------------------------------------

  async cohorts(tenant: TenantContext, filters: ReportFilters): Promise<CohortReportDTO> {
    const branchId = this.resolveBranchFilter(tenant, filters);
    const branchSql = this.branchScopeRaw(tenant, branchId, Prisma.sql`mprof.home_branch_id`);

    const firstPurchases = await this.prisma.$queryRaw<{ member_id: string; first_month: Date }[]>(Prisma.sql`
      SELECT mp.member_id, date_trunc('month', MIN(mp.start_date)) AS first_month
      FROM member_packages mp
      JOIN member_profiles mprof ON mprof.id = mp.member_id
      WHERE mp.studio_id = ${tenant.studioId}::uuid
        ${branchSql}
      GROUP BY mp.member_id`);
    if (firstPurchases.length === 0) return { cohorts: [] };

    const memberIds = firstPurchases.map((r) => r.member_id);
    const earliestMonth = firstPurchases.reduce((min, r) => (r.first_month < min ? r.first_month : min), firstPurchases[0].first_month);

    const [activePackageMonths, attendanceMonths] = await Promise.all([
      this.prisma.$queryRaw<{ member_id: string; month: Date }[]>(Prisma.sql`
        SELECT DISTINCT mp.member_id, date_trunc('month', gs)::date AS month
        FROM member_packages mp
        CROSS JOIN LATERAL generate_series(date_trunc('month', mp.start_date), date_trunc('month', mp.end_date), interval '1 month') gs
        WHERE mp.member_id = ANY(${memberIds}::uuid[]) AND mp.start_date >= ${earliestMonth}`),
      this.prisma.$queryRaw<{ member_id: string; month: Date }[]>(Prisma.sql`
        SELECT DISTINCT b.member_id, date_trunc('month', s.start_time) AS month
        FROM bookings b
        JOIN session_schedules s ON s.id = b.schedule_id
        WHERE b.member_id = ANY(${memberIds}::uuid[]) AND b.status = 'ATTENDED' AND s.start_time >= ${earliestMonth}`),
    ]);

    const activeByMember = new Map<string, Set<string>>();
    for (const r of [...activePackageMonths, ...attendanceMonths]) {
      const set = activeByMember.get(r.member_id) ?? new Set<string>();
      set.add(toIsoMonth(r.month));
      activeByMember.set(r.member_id, set);
    }

    const members: CohortMemberActivity[] = firstPurchases.map((r) => ({
      memberId: r.member_id,
      firstPurchaseMonth: toIsoMonth(r.first_month),
      activeMonths: activeByMember.get(r.member_id) ?? new Set<string>(),
    }));

    return { cohorts: buildCohorts(members, COHORT_MAX_MONTHS) };
  }

  // ---------------------------------------------------------------------------
  // 6. Trainers
  // ---------------------------------------------------------------------------

  async trainers(tenant: TenantContext, range: ReportRange, filters: ReportFilters): Promise<TrainerReportDTO> {
    const branchId = this.resolveBranchFilter(tenant, filters);
    const branchSql = this.branchScopeRaw(tenant, branchId, Prisma.sql`s.branch_id`);

    // As with occupancy: aggregate bookings per schedule first, so joining
    // them in does not multiply SUM(s.capacity).
    const rows = await this.prisma.$queryRaw<TrainerRow[]>(Prisma.sql`
      WITH sched AS (
        SELECT s.id, s.trainer_id, s.capacity,
          (s.original_trainer_id IS NOT NULL AND s.original_trainer_id != s.trainer_id) AS is_substitution
        FROM session_schedules s
        WHERE s.studio_id = ${tenant.studioId}::uuid
          AND s.trainer_id IS NOT NULL
          AND s.is_cancelled = false
          AND s.start_time >= ${range.from} AND s.start_time < ${range.to}
          ${branchSql}
      ),
      book AS (
        SELECT b.schedule_id,
          COUNT(*) FILTER (WHERE b.status IN ('CONFIRMED', 'ATTENDED', 'NO_SHOW')) AS booked,
          COUNT(*) FILTER (WHERE b.status = 'ATTENDED') AS attended,
          COUNT(*) FILTER (WHERE b.status = 'NO_SHOW') AS no_shows,
          COUNT(*) FILTER (WHERE b.status = 'CANCELLED_LATE') AS late_cancellations
        FROM bookings b
        WHERE b.schedule_id IN (SELECT id FROM sched)
        GROUP BY b.schedule_id
      )
      SELECT
        tp.id AS trainer_profile_id,
        u.first_name || ' ' || u.last_name AS trainer_name,
        COUNT(*)::bigint AS sessions,
        SUM(sched.capacity)::bigint AS capacity,
        COALESCE(SUM(book.booked), 0)::bigint AS booked,
        COALESCE(SUM(book.attended), 0)::bigint AS attended,
        COALESCE(SUM(book.no_shows), 0)::bigint AS no_shows,
        COALESCE(SUM(book.late_cancellations), 0)::bigint AS late_cancellations,
        COUNT(*) FILTER (WHERE sched.is_substitution)::bigint AS substitutions
      FROM sched
      JOIN trainer_profiles tp ON tp.id = sched.trainer_id
      JOIN memberships m ON m.id = tp.membership_id
      JOIN users u ON u.id = m.user_id
      LEFT JOIN book ON book.schedule_id = sched.id
      GROUP BY tp.id, trainer_name
      ORDER BY trainer_name`);

    const trainerRows: TrainerReportRowDTO[] = rows.map((r) => {
      const capacity = Number(r.capacity ?? 0);
      const booked = Number(r.booked);
      return {
        trainerProfileId: r.trainer_profile_id,
        trainerName: r.trainer_name,
        sessions: Number(r.sessions),
        capacity,
        booked,
        attended: Number(r.attended),
        occupancy: ratio(booked, capacity),
        noShows: Number(r.no_shows),
        lateCancellations: Number(r.late_cancellations),
        substitutions: Number(r.substitutions),
      };
    });

    return { from: range.from.toISOString(), to: range.to.toISOString(), trainers: trainerRows };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /** Validates an explicit branch filter against the caller's access; returns it (or undefined). */
  private resolveBranchFilter(tenant: TenantContext, filters: ReportFilters): string | undefined {
    if (filters.branchId) {
      assertBranchAccess(tenant, filters.branchId);
      return filters.branchId;
    }
    return undefined;
  }

  /** Raw-SQL branch scope fragment for a nullable branch_id column. */
  private branchScopeRaw(tenant: TenantContext, branchId: string | undefined, column: Prisma.Sql): Prisma.Sql {
    if (branchId) {
      return Prisma.sql`AND ${column} = ${branchId}::uuid`;
    }
    if (tenant.branchIds === null) return Prisma.empty;
    return Prisma.sql`AND (${column} = ANY(${[...tenant.branchIds]}::uuid[]) OR ${column} IS NULL)`;
  }

  private async studioTimezone(studioId: string): Promise<string> {
    const studio = await this.prisma.studio.findUniqueOrThrow({ where: { id: studioId }, select: { timezone: true } });
    return studio.timezone;
  }

}

function decimalOrZero(value: Prisma.Decimal | null | undefined): Prisma.Decimal {
  return value ? new Prisma.Decimal(value) : ZERO;
}

function toIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function toIsoMonth(value: Date): string {
  return value.toISOString().slice(0, 7);
}
