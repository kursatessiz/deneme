import { Injectable, NotFoundException } from '@nestjs/common';
import type { ErrorEvent, ErrorGroup, Prisma } from '@platform/database';
import { BreadcrumbSchema, ERROR_LIMITS, isErrorCode } from '@platform/shared';
import type {
  Breadcrumb,
  ErrorEventDTO,
  ErrorGroupDetailDTO,
  ErrorGroupListDTO,
  ErrorGroupListQuery,
  ErrorGroupStatus,
  ErrorGroupSummaryDTO,
  ErrorSeverity,
  ErrorSource,
  StudioErrorGroupDTO,
} from '@platform/shared';
import { PrismaService } from '../prisma/prisma.service';
import { ErrorCaptureService } from './error-capture.service';

const PAGE_SIZE = 25;
const DAY_MS = 24 * 60 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toSummary(g: ErrorGroup): ErrorGroupSummaryDTO {
  return {
    id: g.id,
    source: g.source as ErrorSource,
    title: g.title,
    type: g.type,
    status: g.status as ErrorGroupStatus,
    count: g.count,
    affectedStudioCount: g.affectedStudioCount,
    affectedUserCount: g.affectedUserCount,
    firstSeenAt: g.firstSeenAt.toISOString(),
    lastSeenAt: g.lastSeenAt.toISOString(),
    lastRelease: g.lastRelease,
    resolvedInRelease: g.resolvedInRelease,
    lastCode: g.lastCode,
    critical: g.critical,
  };
}

function parseBreadcrumbs(raw: Prisma.JsonValue | null): Breadcrumb[] {
  if (!Array.isArray(raw)) return [];
  const out: Breadcrumb[] = [];
  for (const item of raw) {
    const parsed = BreadcrumbSchema.safeParse(item);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

function toEvent(e: ErrorEvent, studioNames: Map<string, string>): ErrorEventDTO {
  return {
    id: e.id,
    code: e.code,
    source: e.source as ErrorSource,
    severity: e.severity as ErrorSeverity,
    release: e.release,
    environment: e.environment,
    route: e.route,
    requestId: e.requestId,
    studioId: e.studioId,
    studioName: e.studioId ? (studioNames.get(e.studioId) ?? null) : null,
    userIdHash: e.userIdHash,
    type: e.type,
    message: e.message,
    stack: e.stack,
    breadcrumbs: parseBreadcrumbs(e.breadcrumbs),
    statusCode: e.statusCode,
    occurredAt: e.occurredAt.toISOString(),
  };
}

export type ErrorGroupAction = 'resolve' | 'ignore' | 'reopen';

/**
 * Read models and actions for the super admin panel (every tenant) and the
 * tenant owner view (one studio, no stack traces or internals).
 */
@Injectable()
export class ErrorQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly capture: ErrorCaptureService,
  ) {}

  async list(query: ErrorGroupListQuery): Promise<ErrorGroupListDTO> {
    const and: Prisma.ErrorGroupWhereInput[] = [];
    if (query.source) and.push({ source: query.source });
    if (query.status) and.push({ status: query.status });
    if (query.release) and.push({ OR: [{ lastRelease: query.release }, { events: { some: { release: query.release } } }] });
    if (query.studioId) and.push({ studios: { some: { studioId: query.studioId } } });
    const q = query.q?.trim();
    if (q) {
      const code = q.toUpperCase();
      if (isErrorCode(code)) and.push({ OR: [{ events: { some: { code } } }, { lastCode: code }] });
      else if (UUID.test(q)) and.push({ OR: [{ id: q }, { events: { some: { OR: [{ id: q }, { requestId: q }] } } }] });
      else and.push({ title: { contains: q, mode: 'insensitive' } });
    }
    const where: Prisma.ErrorGroupWhereInput = and.length > 0 ? { AND: and } : {};
    const [total, rows] = await Promise.all([
      this.prisma.errorGroup.count({ where }),
      this.prisma.errorGroup.findMany({ where, orderBy: { lastSeenAt: 'desc' }, skip: (query.page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
    ]);
    return { items: rows.map(toSummary), total, page: query.page, pageSize: PAGE_SIZE };
  }

  async detail(id: string): Promise<ErrorGroupDetailDTO> {
    const group = await this.findGroup(id);
    const [events, releases, studios] = await Promise.all([
      this.prisma.errorEvent.findMany({ where: { groupId: id }, orderBy: { occurredAt: 'desc' }, take: ERROR_LIMITS.eventsPerGroup }),
      this.prisma.errorEvent.groupBy({
        by: ['release'],
        where: { groupId: id },
        _count: { _all: true },
        _max: { occurredAt: true },
        orderBy: { _max: { occurredAt: 'desc' } },
        take: 20,
      }),
      this.prisma.errorGroupStudio.findMany({ where: { groupId: id }, orderBy: { lastSeenAt: 'desc' }, take: 20 }),
    ]);
    const studioIds = new Set<string>([...studios.map((s) => s.studioId), ...events.flatMap((e) => (e.studioId ? [e.studioId] : []))]);
    const names = new Map(
      (await this.prisma.studio.findMany({ where: { id: { in: [...studioIds] } }, select: { id: true, name: true } })).map((s) => [s.id, s.name]),
    );
    return {
      ...toSummary(group),
      fingerprint: group.fingerprint,
      note: group.note,
      topFrame: group.topFrame,
      releases: releases.map((r) => ({ release: r.release, count: r._count._all, lastSeenAt: (r._max.occurredAt ?? group.lastSeenAt).toISOString() })),
      studios: studios.map((s) => ({ studioId: s.studioId, studioName: names.get(s.studioId) ?? null, count: s.count, lastSeenAt: s.lastSeenAt.toISOString() })),
      events: events.map((e) => toEvent(e, names)),
    };
  }

  async act(id: string, action: ErrorGroupAction, userId: string, release?: string): Promise<ErrorGroupSummaryDTO> {
    await this.findGroup(id);
    const data: Prisma.ErrorGroupUpdateInput =
      action === 'resolve'
        ? // A later regression alert must not be swallowed by an earlier alert's cooldown.
          { status: 'RESOLVED', resolvedInRelease: release ?? this.capture.currentRelease, resolvedAt: new Date(), lastAlertAt: null }
        : action === 'ignore'
          ? { status: 'IGNORED' }
          : { status: 'OPEN', resolvedInRelease: null, resolvedAt: null };
    const updated = await this.prisma.errorGroup.update({ where: { id }, data });
    await this.audit(userId, `error_group.${action}`, id, action === 'resolve' ? { release: updated.resolvedInRelease } : {});
    return toSummary(updated);
  }

  async setNote(id: string, note: string, userId: string): Promise<ErrorGroupSummaryDTO> {
    await this.findGroup(id);
    const updated = await this.prisma.errorGroup.update({ where: { id }, data: { note: note || null } });
    await this.audit(userId, 'error_group.note', id, { length: note.length });
    return toSummary(updated);
  }

  /**
   * The tenant owner view: groups this studio hit in the last 30 days, with
   * its own counts. The message is the studio's own latest scrubbed client
   * message; server-side (api/job) errors never expose theirs.
   */
  async forStudio(studioId: string, now = new Date()): Promise<StudioErrorGroupDTO[]> {
    const rows = await this.prisma.errorGroupStudio.findMany({
      where: { studioId, lastSeenAt: { gte: new Date(now.getTime() - ERROR_LIMITS.retentionDays * DAY_MS) } },
      include: { group: { select: { id: true, source: true, status: true } } },
      orderBy: { lastSeenAt: 'desc' },
      take: 100,
    });
    const clientGroupIds = rows.filter((r) => r.group.source === 'web' || r.group.source === 'mobile').map((r) => r.groupId);
    const latest =
      clientGroupIds.length > 0
        ? await this.prisma.errorEvent.findMany({
            where: { studioId, groupId: { in: clientGroupIds } },
            orderBy: { occurredAt: 'desc' },
            distinct: ['groupId'],
            select: { groupId: true, message: true },
          })
        : [];
    const messages = new Map(latest.map((e) => [e.groupId, e.message]));
    return rows.map((r) => ({
      id: r.groupId,
      source: r.group.source as ErrorSource,
      safeMessage: messages.get(r.groupId)?.slice(0, 300) ?? null,
      status: r.group.status as ErrorGroupStatus,
      count: r.count,
      firstSeenAt: r.firstSeenAt.toISOString(),
      lastSeenAt: r.lastSeenAt.toISOString(),
      lastCode: r.lastCode,
    }));
  }

  private async findGroup(id: string): Promise<ErrorGroup> {
    const group = UUID.test(id) ? await this.prisma.errorGroup.findUnique({ where: { id } }) : null;
    if (!group) throw new NotFoundException('Hata grubu bulunamadı');
    return group;
  }

  private async audit(userId: string, action: string, entityId: string, metadata: Record<string, unknown>): Promise<void> {
    await this.prisma.auditLog.create({
      data: { studioId: null, userId, action, entityType: 'ErrorGroup', entityId, metadata: metadata as Prisma.InputJsonValue },
    });
  }
}
