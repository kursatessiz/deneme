import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@platform/database';
import type { Funnel } from '@platform/database';
import { FUNNEL_MAX_GROUPS, READY_MADE_FUNNELS, TenantFunnelStepsSchema, buildFunnelSteps, findReadyMadeFunnel, previousPeriodWindow } from '@platform/shared';
import type {
  CreateFunnelInput,
  FunnelAggregate,
  FunnelGroupDTO,
  FunnelReportDTO,
  FunnelReportQuery,
  FunnelSummaryDTO,
  ReportRange,
  UpdateFunnelInput,
} from '@platform/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { TenantContext } from '../auth/tenant-context';
import { assertBranchAccess } from '../branches/branch-access';
import { buildFunnelSql, parseFunnelRows } from './funnel-sql';
import type { FunnelSqlGroup } from './funnel-sql';
import { apiError } from '../../common/api-error';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toSummary(f: Funnel): FunnelSummaryDTO {
  return {
    id: f.id,
    kind: 'TENANT',
    name: f.name,
    slug: null,
    steps: TenantFunnelStepsSchema.parse(f.steps),
    windowDays: f.windowDays,
    requiresSiteTracking: false,
    createdAt: f.createdAt.toISOString(),
  };
}

/**
 * Conversion funnels (G5d-1, docs/HUNILER.md). Tenant funnels are rows of
 * `funnels`; ready-made ones are code in @platform/shared. Every query
 * filters by the tenant's studioId (also inside the report SQL).
 */
@Injectable()
export class FunnelsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(tenant: TenantContext): Promise<FunnelSummaryDTO[]> {
    const rows = await this.prisma.funnel.findMany({ where: { studioId: tenant.studioId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    const isPlatform = await this.isPlatformStudio(tenant.studioId);
    const ready: FunnelSummaryDTO[] = READY_MADE_FUNNELS.filter((f) => isPlatform || !f.platformOnly).map((f) => ({
      id: f.id,
      kind: 'READY_MADE',
      name: null,
      slug: f.slug,
      steps: [...f.steps],
      windowDays: f.windowDays,
      requiresSiteTracking: f.requiresSiteTracking,
      createdAt: null,
    }));
    return [...ready, ...rows.map(toSummary)];
  }

  async create(tenant: TenantContext, actorUserId: string, input: CreateFunnelInput): Promise<FunnelSummaryDTO> {
    const row = await this.prisma.funnel.create({
      data: { studioId: tenant.studioId, name: input.name, steps: input.steps, windowDays: input.windowDays, createdByMembershipId: tenant.membershipId },
    });
    await this.audit(tenant, actorUserId, 'funnel.create', row.id, { name: row.name });
    return toSummary(row);
  }

  async update(tenant: TenantContext, actorUserId: string, id: string, input: UpdateFunnelInput): Promise<FunnelSummaryDTO> {
    const data: Prisma.FunnelUpdateManyMutationInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.steps !== undefined) data.steps = input.steps;
    if (input.windowDays !== undefined) data.windowDays = input.windowDays;
    // The studioId stays in the write itself, not only in a preceding lookup.
    const res = await this.prisma.funnel.updateMany({ where: { id, studioId: tenant.studioId }, data });
    if (res.count === 0) throw new NotFoundException(apiError('apiErrors.funnels.funnelNotFound'));
    await this.audit(tenant, actorUserId, 'funnel.update', id, { fields: Object.keys(input) });
    return toSummary(await this.findOwned(tenant, id));
  }

  async remove(tenant: TenantContext, actorUserId: string, id: string): Promise<void> {
    const res = await this.prisma.funnel.deleteMany({ where: { id, studioId: tenant.studioId } });
    if (res.count === 0) throw new NotFoundException(apiError('apiErrors.funnels.funnelNotFound'));
    await this.audit(tenant, actorUserId, 'funnel.delete', id, {});
  }

  async report(tenant: TenantContext, id: string, range: ReportRange, query: FunnelReportQuery): Promise<FunnelReportDTO> {
    if (query.branchId) assertBranchAccess(tenant, query.branchId);
    return this.reportFor({ studioId: tenant.studioId, branchIds: tenant.branchIds === null ? null : [...tenant.branchIds] }, id, range, query);
  }

  /**
   * The same report for a studio without a tenant context: the platform
   * marketing dashboard (docs/PAZARLAMA_MODULU.md 3.3) reads the platform
   * tenant's `platform_b2b` funnel through it. The studioId still filters
   * every query; there is no branch restriction.
   */
  async reportForStudio(studioId: string, id: string, range: ReportRange): Promise<FunnelReportDTO> {
    return this.reportFor({ studioId, branchIds: null }, id, range, {});
  }

  private async reportFor(scope: { studioId: string; branchIds: string[] | null }, id: string, range: ReportRange, query: FunnelReportQuery): Promise<FunnelReportDTO> {
    const funnel = await this.resolve(scope.studioId, id);
    const breakdown = query.breakdown ?? null;
    const empty: FunnelAggregate = { counts: funnel.steps.map(() => 0), medianSeconds: funnel.steps.map(() => null) };

    const run = async (from: Date, to: Date, withBreakdown: boolean): Promise<FunnelSqlGroup[]> => {
      const sql = buildFunnelSql({
        studioId: scope.studioId,
        steps: funnel.steps,
        windowDays: funnel.windowDays,
        from,
        to,
        breakdown: withBreakdown ? breakdown : null,
        branchId: query.branchId,
        branchIds: scope.branchIds,
      });
      const rows = await this.prisma.$queryRaw<Record<string, unknown>[]>(sql);
      return parseFunnelRows(rows, funnel.steps.length);
    };

    const current = await run(range.from, range.to, true);
    const steps = buildFunnelSteps(funnel.steps, current.find((g) => g.key === null)?.aggregate ?? empty);

    const groups: FunnelGroupDTO[] = current
      .filter((g) => g.key !== null)
      .sort((a, b) => (b.aggregate.counts[0] ?? 0) - (a.aggregate.counts[0] ?? 0) || String(a.key).localeCompare(String(b.key)))
      .slice(0, FUNNEL_MAX_GROUPS)
      .map((g) => ({ key: g.key as string, label: g.label, steps: buildFunnelSteps(funnel.steps, g.aggregate) }));

    let previous: FunnelReportDTO['previous'] = null;
    if (query.compare === 'previous') {
      const window = previousPeriodWindow(range);
      const prev = await run(window.from, window.to, false);
      previous = {
        from: window.from.toISOString(),
        to: window.to.toISOString(),
        steps: buildFunnelSteps(funnel.steps, prev.find((g) => g.key === null)?.aggregate ?? empty),
      };
    }

    return { funnel, from: range.from.toISOString(), to: range.to.toISOString(), breakdown, steps, groups, previous };
  }

  private async isPlatformStudio(studioId: string): Promise<boolean> {
    const studio = await this.prisma.studio.findUnique({ where: { id: studioId }, select: { isPlatform: true } });
    return studio?.isPlatform === true;
  }

  private async resolve(studioId: string, id: string): Promise<FunnelSummaryDTO> {
    const ready = findReadyMadeFunnel(id);
    if (ready) {
      if (ready.platformOnly && !(await this.isPlatformStudio(studioId))) throw new NotFoundException(apiError('apiErrors.funnels.funnelNotFound'));
      return {
        id: ready.id,
        kind: 'READY_MADE',
        name: null,
        slug: ready.slug,
        steps: [...ready.steps],
        windowDays: ready.windowDays,
        requiresSiteTracking: ready.requiresSiteTracking,
        createdAt: null,
      };
    }
    if (!UUID_RE.test(id)) throw new NotFoundException(apiError('apiErrors.funnels.funnelNotFound'));
    return toSummary(await this.findOwned({ studioId }, id));
  }

  private async findOwned(tenant: Pick<TenantContext, 'studioId'>, id: string): Promise<Funnel> {
    const row = await this.prisma.funnel.findFirst({ where: { id, studioId: tenant.studioId } });
    if (!row) throw new NotFoundException(apiError('apiErrors.funnels.funnelNotFound'));
    return row;
  }

  private audit(tenant: TenantContext, userId: string, action: string, entityId: string, metadata: Prisma.InputJsonObject) {
    return this.prisma.auditLog.create({ data: { studioId: tenant.studioId, userId, action, entityType: 'Funnel', entityId, metadata } });
  }
}
