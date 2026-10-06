import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@platform/database';
import {
  canViewDashboardWidget,
  changeRatio,
  dashboardPeriodRange,
  enumerateZonedDays,
  maskLeaderboardName,
  memberGrowthRate,
  resolveWidgetPeriod,
  zonedMidnight,
  zonedStartOfDay,
  zonedStartOfWeek,
} from '@platform/shared';
import type {
  DashboardDataRequest,
  DashboardDataResponseDTO,
  DashboardPeriod,
  DashboardSessionRowDTO,
  DashboardWidgetKey,
  DashboardWidgetPayload,
  DashboardWidgetResultDTO,
  ReportFilters,
  ReportRange,
} from '@platform/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { TenantContext } from '../auth/tenant-context';
import { assertBranchAccess, branchScope } from '../branches/branch-access';
import { BranchesService } from '../branches/branches.service';
import { ChurnService } from '../churn/churn.service';
import { ReportsService } from '../reports/reports.service';
import { RetailCatalogService } from '../retail/retail-catalog.service';
import { TtlPromiseCache } from './dashboard-cache';
import { apiError } from '../../common/api-error';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Computed cards are reused for this long (per studio, branch, caller scope, card and settings). */
export const DASHBOARD_DATA_TTL_MS = 45_000;
const EXPIRING_WITHIN_DAYS = 14;
const LIST_LIMIT = 10;
const GROWTH_CHART_MONTHS = 6;
const BOOKED_STATUSES = ['CONFIRMED', 'ATTENDED'] as const;

interface StudioContext {
  timeZone: string;
  currency: string;
  now: Date;
  branchId: string | undefined;
}

/**
 * Figures of the overview cards. Every number comes from the services the
 * report, branch, churn and store screens already use (ReportsService,
 * BranchesService, ChurnService, RetailCatalogService); the thin queries
 * below exist only where no service returns what a card shows (the day's
 * sessions with their counts, recent payments, expiring packages, new
 * leads, monthly joins, upcoming events). Every query is filtered by the
 * caller's studio and branch scope.
 */
@Injectable()
export class DashboardDataService {
  private readonly logger = new Logger(DashboardDataService.name);
  private readonly cache = new TtlPromiseCache<DashboardWidgetPayload>(DASHBOARD_DATA_TTL_MS, 2000);

  constructor(
    private readonly prisma: PrismaService,
    private readonly reports: ReportsService,
    private readonly branches: BranchesService,
    private readonly churn: ChurnService,
    private readonly retail: RetailCatalogService,
  ) {}

  async compute(tenant: TenantContext, request: DashboardDataRequest): Promise<DashboardDataResponseDTO> {
    if (request.branchId) {
      assertBranchAccess(tenant, request.branchId);
      const branch = await this.prisma.branch.findFirst({ where: { id: request.branchId, studioId: tenant.studioId }, select: { id: true } });
      if (!branch) throw new NotFoundException(apiError('apiErrors.common.branchNotFound'));
    }
    const studio = await this.prisma.studio.findUniqueOrThrow({ where: { id: tenant.studioId }, select: { timezone: true, currency: true } });
    const ctx: StudioContext = { timeZone: studio.timezone, currency: studio.currency, now: new Date(), branchId: request.branchId };

    const results = await Promise.all(
      request.widgets.map(async (entry): Promise<DashboardWidgetResultDTO> => {
        if (!canViewDashboardWidget(entry.widget, tenant.permissions, tenant.isOwner)) {
          return { id: entry.id, widget: entry.widget, status: 'forbidden' };
        }
        const period = resolveWidgetPeriod(entry.widget, entry.settings);
        try {
          const data = await this.cache.getOrCreate(this.cacheKey(tenant, ctx, entry.widget, period), () => this.computeOne(tenant, ctx, entry.widget, period));
          return { id: entry.id, widget: entry.widget, status: 'ok', data };
        } catch (err) {
          this.logger.warn(`dashboard card ${entry.widget} failed for studio ${tenant.studioId}: ${err instanceof Error ? err.message : String(err)}`);
          return { id: entry.id, widget: entry.widget, status: 'error' };
        }
      }),
    );

    return { generatedAt: ctx.now.toISOString(), currency: ctx.currency, timeZone: ctx.timeZone, results };
  }

  /** Everything that changes what a card returns: studio, branch filter, the caller's branch scope and contact visibility, card, period. */
  private cacheKey(tenant: TenantContext, ctx: StudioContext, widget: DashboardWidgetKey, period: DashboardPeriod | null): string {
    const scope = tenant.branchIds === null ? '*' : [...tenant.branchIds].sort().join(',');
    const contact = tenant.permissions.has('members.contact.view') ? 'c' : '-';
    const reports = tenant.permissions.has('reports.view') ? 'r' : '-';
    return [tenant.studioId, ctx.branchId ?? '*', scope, contact, reports, widget, period ?? '', ctx.timeZone].join('|');
  }

  private async computeOne(tenant: TenantContext, ctx: StudioContext, widget: DashboardWidgetKey, period: DashboardPeriod | null): Promise<DashboardWidgetPayload> {
    const p = period ?? 'month';
    switch (widget) {
      case 'revenue':
        return this.revenue(tenant, ctx, p);
      case 'activeMembers':
        return this.activeMembers(tenant, ctx);
      case 'newMembers':
        return this.newMembers(tenant, ctx, p);
      case 'memberGrowth':
        return this.memberGrowth(tenant, ctx, p);
      case 'occupancy':
        return this.occupancy(tenant, ctx, p);
      case 'todaySessions':
        return this.todaySessions(tenant, ctx);
      case 'renewalRate':
        return this.renewalRate(tenant, ctx, p);
      case 'churnRisk': {
        const summary = await this.churn.summary(tenant, ctx.branchId);
        return { kind: 'churnRisk', counts: summary.counts, computedAt: summary.computedAt };
      }
      case 'newLeads':
        return this.newLeads(tenant, ctx, p);
      case 'revenueTrend':
        return this.revenueTrend(tenant, ctx, p);
      case 'occupancyTrend':
        return this.occupancyTrend(tenant, ctx, p);
      case 'memberGrowthChart':
        return this.memberGrowthChart(tenant, ctx);
      case 'todaySchedule': {
        const from = zonedStartOfDay(ctx.now, ctx.timeZone);
        const to = this.nextDay(from, ctx.timeZone);
        return { kind: 'sessions', from: from.toISOString(), to: to.toISOString(), timeZone: ctx.timeZone, sessions: await this.sessions(tenant, ctx, from, to, { includeCancelled: true }) };
      }
      case 'upcomingSessions': {
        const to = new Date(ctx.now.getTime() + 7 * DAY_MS);
        return {
          kind: 'sessions',
          from: ctx.now.toISOString(),
          to: to.toISOString(),
          timeZone: ctx.timeZone,
          sessions: await this.sessions(tenant, ctx, ctx.now, to, { includeCancelled: false, take: LIST_LIMIT }),
        };
      }
      case 'weekCalendar': {
        const from = zonedStartOfWeek(ctx.now, ctx.timeZone);
        // Next Monday in the studio zone (half a day of slack absorbs a daylight saving shift).
        const end = zonedStartOfWeek(new Date(from.getTime() + 7 * DAY_MS + 12 * 60 * 60 * 1000), ctx.timeZone);
        return { kind: 'sessions', from: from.toISOString(), to: end.toISOString(), timeZone: ctx.timeZone, sessions: await this.sessions(tenant, ctx, from, end, { includeCancelled: true }) };
      }
      case 'recentPayments':
        return this.recentPayments(tenant, ctx);
      case 'expiringPackages':
        return this.expiringPackages(tenant, ctx);
      case 'trainerPerformance': {
        const range = dashboardPeriodRange(p, ctx.now, ctx.timeZone);
        const report = await this.reports.trainers(tenant, { from: range.from, to: range.to }, this.filters(ctx));
        const trainers = [...report.trainers].sort((a, b) => b.sessions - a.sessions || a.trainerName.localeCompare(b.trainerName));
        return { kind: 'trainerPerformance', period: p, trainers };
      }
      case 'branches':
        return this.branchList(tenant, ctx);
      case 'lowStock': {
        const items = await this.retail.lowStock(tenant, ctx.branchId);
        return { kind: 'lowStock', items: items.slice(0, LIST_LIMIT) };
      }
      case 'upcomingEvents':
        return this.upcomingEvents(tenant, ctx);
      case 'quickActions':
      default:
        return { kind: 'none' };
    }
  }

  // -- Report backed figures --------------------------------------------------

  private filters(ctx: StudioContext): ReportFilters {
    return { branchId: ctx.branchId, format: 'json' };
  }

  private async revenue(tenant: TenantContext, ctx: StudioContext, period: DashboardPeriod): Promise<DashboardWidgetPayload> {
    const range = dashboardPeriodRange(period, ctx.now, ctx.timeZone);
    const [current, previous] = await Promise.all([
      this.reports.revenue(tenant, { from: range.from, to: range.to }, this.filters(ctx), 'day'),
      this.reports.revenue(tenant, { from: range.previousFrom, to: range.previousTo }, this.filters(ctx), 'day'),
    ]);
    // Net of refunds, the same figure as the revenue report's "net" line.
    const cur = Number(current.netTotal);
    const prev = Number(previous.netTotal);
    return {
      kind: 'revenue',
      period,
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      currency: ctx.currency,
      currentAmount: current.netTotal,
      previousAmount: previous.netTotal,
      current: cur,
      previous: prev,
      change: changeRatio(cur, prev),
    };
  }

  private async activeMembers(tenant: TenantContext, ctx: StudioContext): Promise<DashboardWidgetPayload> {
    const range: ReportRange = { from: new Date(ctx.now.getTime() - 30 * DAY_MS), to: ctx.now };
    const [report, expiringPackages] = await Promise.all([
      this.reports.members(tenant, range, this.filters(ctx)),
      this.prisma.memberPackage.count({
        where: {
          studioId: tenant.studioId,
          status: 'ACTIVE',
          member: this.memberHomeBranchWhere(tenant, ctx),
          OR: [{ remainingUnits: { lte: 2 } }, { endDate: { lte: new Date(ctx.now.getTime() + 7 * DAY_MS) } }],
        },
      }),
    ]);
    return { kind: 'activeMembers', count: report.activeMembers, expiringPackages };
  }

  private async newMembers(tenant: TenantContext, ctx: StudioContext, period: DashboardPeriod): Promise<DashboardWidgetPayload> {
    const range = dashboardPeriodRange(period, ctx.now, ctx.timeZone);
    const [current, previous] = await Promise.all([
      this.reports.members(tenant, { from: range.from, to: range.to }, this.filters(ctx)),
      this.reports.members(tenant, { from: range.previousFrom, to: range.previousTo }, this.filters(ctx)),
    ]);
    return {
      kind: 'newMembers',
      period,
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      current: current.newMembers,
      previous: previous.newMembers,
      change: changeRatio(current.newMembers, previous.newMembers),
    };
  }

  private async memberGrowth(tenant: TenantContext, ctx: StudioContext, period: DashboardPeriod): Promise<DashboardWidgetPayload> {
    const range = dashboardPeriodRange(period, ctx.now, ctx.timeZone);
    const [current, previous] = await Promise.all([
      this.reports.members(tenant, { from: range.from, to: range.to }, this.filters(ctx)),
      this.reports.members(tenant, { from: range.previousFrom, to: range.from }, this.filters(ctx)),
    ]);
    const rate = memberGrowthRate({ activeNow: current.activeMembers, joined: current.newMembers, churned: current.churnedMembers });
    const startBase = current.activeMembers - (current.newMembers - current.churnedMembers);
    const previousRate = memberGrowthRate({ activeNow: startBase, joined: previous.newMembers, churned: previous.churnedMembers });
    return {
      kind: 'memberGrowth',
      period,
      rate,
      previousRate,
      joined: current.newMembers,
      churned: current.churnedMembers,
      activeMembers: current.activeMembers,
    };
  }

  private async occupancy(tenant: TenantContext, ctx: StudioContext, period: DashboardPeriod): Promise<DashboardWidgetPayload> {
    const range = dashboardPeriodRange(period, ctx.now, ctx.timeZone);
    // Occupancy counts booked seats of the whole period, including sessions still ahead.
    const currentEnd = period === 'last30' ? range.to : range.end;
    const [current, previous] = await Promise.all([
      this.reports.occupancy(tenant, { from: range.from, to: currentEnd }, this.filters(ctx)),
      this.reports.occupancy(tenant, { from: range.previousFrom, to: range.from }, this.filters(ctx)),
    ]);
    const sum = (rows: { booked: number; capacity: number }[]) =>
      rows.reduce((acc, row) => ({ booked: acc.booked + row.booked, capacity: acc.capacity + row.capacity }), { booked: 0, capacity: 0 });
    const cur = sum(current.byDay);
    const prev = sum(previous.byDay);
    return {
      kind: 'occupancy',
      period,
      rate: cur.capacity > 0 ? cur.booked / cur.capacity : 0,
      previousRate: prev.capacity > 0 ? prev.booked / prev.capacity : null,
      booked: cur.booked,
      capacity: cur.capacity,
    };
  }

  private async renewalRate(tenant: TenantContext, ctx: StudioContext, period: DashboardPeriod): Promise<DashboardWidgetPayload> {
    const range = dashboardPeriodRange(period, ctx.now, ctx.timeZone);
    const [current, previous] = await Promise.all([
      this.reports.renewal(tenant, { from: range.from, to: range.to }, this.filters(ctx)),
      this.reports.renewal(tenant, { from: range.previousFrom, to: range.previousTo }, this.filters(ctx)),
    ]);
    return {
      kind: 'renewalRate',
      period,
      rate: current.renewalRate,
      previousRate: previous.expiredPackages > 0 ? previous.renewalRate : null,
      expired: current.expiredPackages,
      renewed: current.renewedPackages,
    };
  }

  private async revenueTrend(tenant: TenantContext, ctx: StudioContext, period: DashboardPeriod): Promise<DashboardWidgetPayload> {
    const range = dashboardPeriodRange(period, ctx.now, ctx.timeZone);
    const report = await this.reports.revenue(tenant, { from: range.from, to: range.to }, this.filters(ctx), 'day');
    const byDay = new Map(report.byPeriod.map((row) => [row.period, row.amount]));
    const points = enumerateZonedDays(range.from, range.to, ctx.timeZone).map((date) => ({ date, amount: byDay.get(date) ?? '0.00' }));
    return { kind: 'revenueTrend', period, currency: ctx.currency, total: report.total, points };
  }

  private async occupancyTrend(tenant: TenantContext, ctx: StudioContext, period: DashboardPeriod): Promise<DashboardWidgetPayload> {
    const range = dashboardPeriodRange(period, ctx.now, ctx.timeZone);
    const end = period === 'last30' ? range.to : range.end;
    const report = await this.reports.occupancy(tenant, { from: range.from, to: end }, this.filters(ctx));
    const byDay = new Map(report.byDay.map((row) => [row.date, row]));
    const points = enumerateZonedDays(range.from, end, ctx.timeZone).map((date) => {
      const row = byDay.get(date);
      return { date, rate: row?.occupancy ?? 0, booked: row?.booked ?? 0, capacity: row?.capacity ?? 0 };
    });
    return { kind: 'occupancyTrend', period, points };
  }

  // -- Thin queries -------------------------------------------------------------

  /** Member home branch filter: an explicit branch, or the caller's branches plus members without one. */
  private memberHomeBranchWhere(tenant: TenantContext, ctx: StudioContext): Prisma.MemberProfileWhereInput {
    if (ctx.branchId) return { homeBranchId: ctx.branchId };
    if (tenant.branchIds === null) return {};
    return { OR: [{ homeBranchId: { in: [...tenant.branchIds] } }, { homeBranchId: null }] };
  }

  private nextDay(midnight: Date, timeZone: string): Date {
    return zonedStartOfDay(new Date(midnight.getTime() + 36 * 60 * 60 * 1000), timeZone);
  }

  private async todaySessions(tenant: TenantContext, ctx: StudioContext): Promise<DashboardWidgetPayload> {
    const from = zonedStartOfDay(ctx.now, ctx.timeZone);
    const to = this.nextDay(from, ctx.timeZone);
    const rows = await this.prisma.sessionSchedule.findMany({
      where: { studioId: tenant.studioId, startTime: { gte: from, lt: to }, ...branchScope(tenant, ctx.branchId) },
      select: { capacity: true, isCancelled: true, _count: { select: { bookings: { where: { status: { in: [...BOOKED_STATUSES] } } } } } },
    });
    const active = rows.filter((row) => !row.isCancelled);
    return {
      kind: 'todaySessions',
      sessions: active.length,
      bookings: active.reduce((acc, row) => acc + row._count.bookings, 0),
      capacity: active.reduce((acc, row) => acc + row.capacity, 0),
      cancelled: rows.length - active.length,
    };
  }

  private async sessions(
    tenant: TenantContext,
    ctx: StudioContext,
    from: Date,
    to: Date,
    options: { includeCancelled: boolean; take?: number },
  ): Promise<DashboardSessionRowDTO[]> {
    const rows = await this.prisma.sessionSchedule.findMany({
      where: {
        studioId: tenant.studioId,
        startTime: { gte: from, lt: to },
        ...(options.includeCancelled ? {} : { isCancelled: false }),
        ...branchScope(tenant, ctx.branchId),
      },
      select: {
        id: true,
        title: true,
        startTime: true,
        endTime: true,
        capacity: true,
        isCancelled: true,
        serviceType: { select: { name: true } },
        resource: { select: { name: true } },
        branch: { select: { name: true } },
        trainer: { select: { membership: { select: { user: { select: { firstName: true, lastName: true } } } } } },
        _count: { select: { bookings: { where: { status: { in: [...BOOKED_STATUSES] } } } } },
      },
      orderBy: { startTime: 'asc' },
      take: options.take ?? 300,
    });
    return rows.map((row) => {
      const user = row.trainer?.membership.user;
      return {
        id: row.id,
        title: row.title,
        startTime: row.startTime.toISOString(),
        endTime: row.endTime.toISOString(),
        serviceTypeName: row.serviceType?.name ?? null,
        trainerName: user ? `${user.firstName} ${user.lastName}`.trim() : null,
        resourceName: row.resource?.name ?? null,
        branchName: row.branch?.name ?? null,
        booked: row._count.bookings,
        capacity: row.capacity,
        isCancelled: row.isCancelled,
      };
    });
  }

  private async newLeads(tenant: TenantContext, ctx: StudioContext, period: DashboardPeriod): Promise<DashboardWidgetPayload> {
    const range = dashboardPeriodRange(period, ctx.now, ctx.timeZone);
    // A lead is a contact on the sales pipeline (the same rule as the leads screen).
    const base: Prisma.ContactWhereInput = { studioId: tenant.studioId, mergedIntoId: null, pipelineStageId: { not: null }, AND: [branchScope(tenant, ctx.branchId)] };
    const [current, previous] = await Promise.all([
      this.prisma.contact.count({ where: { ...base, createdAt: { gte: range.from, lt: range.to } } }),
      this.prisma.contact.count({ where: { ...base, createdAt: { gte: range.previousFrom, lt: range.previousTo } } }),
    ]);
    return { kind: 'newLeads', period, from: range.from.toISOString(), to: range.to.toISOString(), current, previous, change: changeRatio(current, previous) };
  }

  private async memberGrowthChart(tenant: TenantContext, ctx: StudioContext): Promise<DashboardWidgetPayload> {
    const from = this.monthStart(ctx.now, ctx.timeZone, -(GROWTH_CHART_MONTHS - 1));
    const branchSql = ctx.branchId
      ? Prisma.sql`AND mp.home_branch_id = ${ctx.branchId}::uuid`
      : tenant.branchIds === null
        ? Prisma.empty
        : Prisma.sql`AND (mp.home_branch_id = ANY(${[...tenant.branchIds]}::uuid[]) OR mp.home_branch_id IS NULL)`;
    const rows = await this.prisma.$queryRaw<{ month: string; joined: bigint }[]>(Prisma.sql`
      SELECT to_char(date_trunc('month', m.joined_at AT TIME ZONE 'UTC' AT TIME ZONE ${ctx.timeZone}), 'YYYY-MM') AS month,
             COUNT(*)::bigint AS joined
      FROM member_profiles mp
      JOIN memberships m ON m.id = mp.membership_id
      WHERE mp.studio_id = ${tenant.studioId}::uuid
        AND m.joined_at >= ${from}
        ${branchSql}
      GROUP BY month`);
    const byMonth = new Map(rows.map((row) => [row.month, Number(row.joined)]));
    const points: { month: string; joined: number }[] = [];
    for (let i = GROWTH_CHART_MONTHS - 1; i >= 0; i -= 1) {
      const start = this.monthStart(ctx.now, ctx.timeZone, -i);
      const key = this.monthKey(start, ctx.timeZone);
      points.push({ month: key, joined: byMonth.get(key) ?? 0 });
    }
    return { kind: 'memberGrowthChart', points };
  }

  private monthStart(now: Date, timeZone: string, offset: number): Date {
    const key = this.monthKey(now, timeZone);
    const [year, month] = key.split('-').map(Number);
    return zonedMidnight(year, month + offset, 1, timeZone);
  }

  private monthKey(date: Date, timeZone: string): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit' }).format(date).slice(0, 7);
  }

  private async recentPayments(tenant: TenantContext, ctx: StudioContext): Promise<DashboardWidgetPayload> {
    const canViewContact = tenant.permissions.has('members.contact.view');
    const rows = await this.prisma.payment.findMany({
      where: { studioId: tenant.studioId, ...branchScope(tenant, ctx.branchId) },
      select: {
        id: true,
        paidAt: true,
        amount: true,
        currency: true,
        paymentMethod: true,
        paymentStatus: true,
        member: { select: { membership: { select: { user: { select: { firstName: true, lastName: true } } } } } },
        contact: { select: { firstName: true, lastName: true } },
      },
      orderBy: { paidAt: 'desc' },
      take: LIST_LIMIT,
    });
    const name = (first: string, last: string) => (canViewContact ? `${first.trim()} ${last.trim()}`.trim() : maskLeaderboardName(first, last));
    return {
      kind: 'recentPayments',
      payments: rows.map((row) => {
        const user = row.member?.membership.user;
        return {
          id: row.id,
          paidAt: row.paidAt.toISOString(),
          payerName: user ? name(user.firstName, user.lastName) : row.contact ? name(row.contact.firstName, row.contact.lastName) : null,
          amount: row.amount.toFixed(2),
          currency: row.currency,
          paymentMethod: row.paymentMethod,
          paymentStatus: row.paymentStatus,
        };
      }),
    };
  }

  private async expiringPackages(tenant: TenantContext, ctx: StudioContext): Promise<DashboardWidgetPayload> {
    const limit = new Date(ctx.now.getTime() + EXPIRING_WITHIN_DAYS * DAY_MS);
    const rows = await this.prisma.memberPackage.findMany({
      where: {
        studioId: tenant.studioId,
        status: 'ACTIVE',
        member: this.memberHomeBranchWhere(tenant, ctx),
        OR: [{ endDate: { gte: ctx.now, lte: limit } }, { remainingUnits: { lte: 2 } }],
      },
      select: {
        id: true,
        memberId: true,
        endDate: true,
        remainingUnits: true,
        packageDefinition: { select: { name: true } },
        member: { select: { membership: { select: { user: { select: { firstName: true, lastName: true } } } } } },
      },
      orderBy: { endDate: 'asc' },
      take: LIST_LIMIT,
    });
    return {
      kind: 'expiringPackages',
      withinDays: EXPIRING_WITHIN_DAYS,
      packages: rows.map((row) => ({
        memberPackageId: row.id,
        memberId: row.memberId,
        memberName: `${row.member.membership.user.firstName} ${row.member.membership.user.lastName}`.trim(),
        packageName: row.packageDefinition.name,
        endDate: row.endDate.toISOString(),
        remainingUnits: row.remainingUnits,
      })),
    };
  }

  private async branchList(tenant: TenantContext, ctx: StudioContext): Promise<DashboardWidgetPayload> {
    const list = await this.branches.list(tenant);
    const visible = list.filter((b) => (tenant.branchIds === null || tenant.branchIds.has(b.id)) && (!ctx.branchId || b.id === ctx.branchId));
    const canReport = tenant.isOwner || tenant.permissions.has('reports.view');
    const summary = canReport ? await this.branches.summary(tenant, { from: new Date(ctx.now.getTime() - 30 * DAY_MS), to: ctx.now }) : [];
    const byBranch = new Map(summary.map((row) => [row.branchId, row]));
    return {
      kind: 'branches',
      currency: ctx.currency,
      branches: visible.map((b) => {
        const row = byBranch.get(b.id);
        return {
          id: b.id,
          name: b.name,
          address: b.address,
          summary: canReport && row ? { sessions: row.sessions, occupancy: row.occupancy, revenue: row.revenue, homeMembers: row.homeMembers } : null,
        };
      }),
    };
  }

  private async upcomingEvents(tenant: TenantContext, ctx: StudioContext): Promise<DashboardWidgetPayload> {
    const rows = await this.prisma.event.findMany({
      where: { studioId: tenant.studioId, status: 'PUBLISHED', startsAt: { gte: ctx.now }, ...branchScope(tenant, ctx.branchId) },
      select: { id: true, title: true, startsAt: true, capacity: true, seatsTaken: true, status: true },
      orderBy: { startsAt: 'asc' },
      take: LIST_LIMIT,
    });
    return {
      kind: 'upcomingEvents',
      events: rows.map((row) => ({
        id: row.id,
        title: row.title,
        startsAt: row.startsAt ? row.startsAt.toISOString() : null,
        capacity: row.capacity,
        seatsTaken: row.seatsTaken,
        status: row.status,
      })),
    };
  }
}
