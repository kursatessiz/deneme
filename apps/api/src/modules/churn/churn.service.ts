import { HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@platform/database';
import type {
  ChurnListQuery,
  ChurnListResponseDTO,
  ChurnLevelCountDTO,
  ChurnMemberSummaryDTO,
  ChurnReasonDTO,
  ChurnRiskLevel,
  ChurnSummaryDTO,
  MarkContactedInput,
} from '@platform/shared';
import { CHURN_RISK_LEVELS, parseChurnWeights } from '@platform/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { TenantContext } from '../auth/tenant-context';
import { assertBranchAccess } from '../branches/branch-access';
import { scoreMemberChurnRisk, type ChurnMemberSignals } from './churn-scoring';

const DAY_MS = 24 * 60 * 60 * 1000;
const RATE_LIMIT_MS = 10 * 60 * 1000;

interface AttendanceRow {
  member_id: string;
  attended_last28: bigint;
  attended_prev28: bigint;
  last_attended_at: Date | null;
  late_cancels_last28: bigint;
  no_shows_last28: bigint;
}

interface PackageRow {
  member_id: string;
  id: string;
  status: 'ACTIVE' | 'FROZEN' | 'EXPIRED' | 'DEPLETED';
  entitlement_kind: 'SESSION_COUNT' | 'TIME_UNLIMITED' | 'CREDIT';
  start_date: Date;
  end_date: Date;
  remaining_units: number | null;
  total_units: number | null;
}

interface FailedPaymentRow {
  member_id: string;
  failed_count: bigint;
}

@Injectable()
export class ChurnService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------------
  // Computation
  // ---------------------------------------------------------------------------

  /**
   * Recomputes churn risk for every active member of one studio, in a
   * handful of studio-wide bounded queries (never per member), and upserts
   * MemberRiskSnapshot plus one MemberRiskHistory row per member. Existing
   * contacted/snoozed state on the snapshot is preserved across recomputes.
   */
  async recomputeStudio(studioId: string, now: Date = new Date()): Promise<{ studioId: string; membersScored: number }> {
    const studio = await this.prisma.studio.findUniqueOrThrow({ where: { id: studioId }, select: { churnWeights: true } });
    const weights = parseChurnWeights(studio.churnWeights);

    // Partner-guest memberships are excluded from churn scoring: they have
    // never onboarded into the app and are not real members to retain.
    const members = await this.prisma.memberProfile.findMany({
      where: { studioId, membership: { status: 'ACTIVE', isPartnerGuest: false } },
      select: { id: true, membership: { select: { joinedAt: true } } },
    });
    if (members.length === 0) return { studioId, membersScored: 0 };

    const memberIds = members.map((m) => m.id);
    const last28Start = new Date(now.getTime() - 28 * DAY_MS);
    const prev28Start = new Date(now.getTime() - 56 * DAY_MS);
    const failedPaymentWindowStart = last28Start;

    const [attendanceRows, packageRows, activeSubscriptionMemberIds, failedPaymentRows, existingSnapshots] = await Promise.all([
      this.prisma.$queryRaw<AttendanceRow[]>(Prisma.sql`
        SELECT
          b.member_id,
          COUNT(*) FILTER (WHERE b.status = 'ATTENDED' AND s.start_time >= ${last28Start} AND s.start_time < ${now})::bigint AS attended_last28,
          COUNT(*) FILTER (WHERE b.status = 'ATTENDED' AND s.start_time >= ${prev28Start} AND s.start_time < ${last28Start})::bigint AS attended_prev28,
          MAX(s.start_time) FILTER (WHERE b.status = 'ATTENDED') AS last_attended_at,
          COUNT(*) FILTER (WHERE b.status = 'CANCELLED_LATE' AND s.start_time >= ${last28Start} AND s.start_time < ${now})::bigint AS late_cancels_last28,
          COUNT(*) FILTER (WHERE b.status = 'NO_SHOW' AND s.start_time >= ${last28Start} AND s.start_time < ${now})::bigint AS no_shows_last28
        FROM bookings b
        JOIN session_schedules s ON s.id = b.schedule_id
        WHERE b.studio_id = ${studioId}::uuid AND b.member_id = ANY(${memberIds}::uuid[])
        GROUP BY b.member_id`),
      this.prisma.$queryRaw<PackageRow[]>(Prisma.sql`
        SELECT member_id, id, status, entitlement_kind, start_date, end_date, remaining_units, total_units
        FROM member_packages
        WHERE studio_id = ${studioId}::uuid AND member_id = ANY(${memberIds}::uuid[])
        ORDER BY member_id, end_date DESC`),
      this.prisma.memberSubscription
        .findMany({ where: { studioId, memberId: { in: memberIds }, status: 'ACTIVE' }, select: { memberId: true } })
        .then((rows) => new Set(rows.map((r) => r.memberId))),
      this.prisma.$queryRaw<FailedPaymentRow[]>(Prisma.sql`
        SELECT ms.member_id, COUNT(*)::bigint AS failed_count
        FROM payment_attempts pa
        JOIN member_subscriptions ms ON ms.id = pa.member_subscription_id
        WHERE pa.studio_id = ${studioId}::uuid
          AND ms.member_id = ANY(${memberIds}::uuid[])
          AND pa.status = 'FAILED'
          AND pa.created_at >= ${failedPaymentWindowStart} AND pa.created_at < ${now}
        GROUP BY ms.member_id`),
      this.prisma.memberRiskSnapshot.findMany({
        where: { studioId, memberId: { in: memberIds } },
        select: { memberId: true, score: true },
      }),
    ]);

    const attendanceByMember = new Map(attendanceRows.map((r) => [r.member_id, r]));
    const packagesByMember = new Map<string, PackageRow[]>();
    for (const row of packageRows) {
      const list = packagesByMember.get(row.member_id) ?? [];
      list.push(row);
      packagesByMember.set(row.member_id, list);
    }
    const failedByMember = new Map(failedPaymentRows.map((r) => [r.member_id, Number(r.failed_count)]));
    const previousScoreByMember = new Map(existingSnapshots.map((s) => [s.memberId, s.score]));

    const snapshotUpserts: { memberId: string; score: number; level: ChurnRiskLevel; onboarding: boolean; reasons: ChurnReasonDTO[]; lastAttendedAt: Date | null; activePackageEndDate: Date | null; previousScore: number | null }[] = [];
    const historyRows: { memberId: string; score: number; level: ChurnRiskLevel }[] = [];

    for (const member of members) {
      const attendance = attendanceByMember.get(member.id);
      const packages = packagesByMember.get(member.id) ?? [];
      const activePackageRow = packages.find((p) => p.status === 'ACTIVE' || p.status === 'FROZEN') ?? null;
      const hasRenewalPurchased =
        activeSubscriptionMemberIds.has(member.id) ||
        (activePackageRow ? packages.some((p) => p.id !== activePackageRow.id && p.start_date > activePackageRow.start_date) : false);

      const lastAttendedAt = attendance?.last_attended_at ?? null;
      const daysSinceLastAttendance = lastAttendedAt ? Math.floor((now.getTime() - lastAttendedAt.getTime()) / DAY_MS) : null;

      const signals: ChurnMemberSignals = {
        memberId: member.id,
        joinedAt: member.membership?.joinedAt ?? null,
        attendedLast28: Number(attendance?.attended_last28 ?? 0),
        attendedPrev28: Number(attendance?.attended_prev28 ?? 0),
        daysSinceLastAttendance,
        activePackage: activePackageRow
          ? {
              status: activePackageRow.status as 'ACTIVE' | 'FROZEN',
              entitlementKind: activePackageRow.entitlement_kind,
              startDate: activePackageRow.start_date,
              endDate: activePackageRow.end_date,
              remainingUnits: activePackageRow.remaining_units,
              totalUnits: activePackageRow.total_units,
            }
          : null,
        hasRenewalPurchased,
        lateCancelsLast28: Number(attendance?.late_cancels_last28 ?? 0),
        noShowsLast28: Number(attendance?.no_shows_last28 ?? 0),
        failedPaymentAttemptsLast28: failedByMember.get(member.id) ?? 0,
      };

      const result = scoreMemberChurnRisk(signals, weights, now);
      snapshotUpserts.push({
        memberId: member.id,
        score: result.score,
        level: result.level,
        onboarding: result.onboarding,
        reasons: result.reasons,
        lastAttendedAt,
        activePackageEndDate: activePackageRow?.end_date ?? null,
        previousScore: previousScoreByMember.get(member.id) ?? null,
      });
      historyRows.push({ memberId: member.id, score: result.score, level: result.level });
    }

    // Batched, chunked so a large studio never opens one huge transaction.
    const CHUNK = 100;
    for (let i = 0; i < snapshotUpserts.length; i += CHUNK) {
      const chunk = snapshotUpserts.slice(i, i + CHUNK);
      await this.prisma.$transaction([
        ...chunk.map((s) =>
          this.prisma.memberRiskSnapshot.upsert({
            where: { memberId: s.memberId },
            create: {
              studioId,
              memberId: s.memberId,
              score: s.score,
              previousScore: s.previousScore,
              level: s.level,
              onboarding: s.onboarding,
              reasons: s.reasons as unknown as Prisma.InputJsonValue,
              lastAttendedAt: s.lastAttendedAt,
              activePackageEndDate: s.activePackageEndDate,
              computedAt: now,
            },
            update: {
              score: s.score,
              previousScore: s.previousScore,
              level: s.level,
              onboarding: s.onboarding,
              reasons: s.reasons as unknown as Prisma.InputJsonValue,
              lastAttendedAt: s.lastAttendedAt,
              activePackageEndDate: s.activePackageEndDate,
              computedAt: now,
            },
          }),
        ),
        this.prisma.memberRiskHistory.createMany({
          data: chunk.map((h) => ({ studioId, memberId: h.memberId, score: h.score, level: h.level, computedAt: now })),
        }),
      ]);
    }

    return { studioId, membersScored: snapshotUpserts.length };
  }

  /**
   * Daily refresh driven by the 15-minute scheduler heartbeat (JobsService):
   * recomputes only active studios whose latest snapshot is older than
   * `maxAgeHours`, so each studio is scored about once a day.
   */
  async recomputeStale(now: Date = new Date(), maxAgeHours = 20): Promise<{ studiosProcessed: number; membersScored: number }> {
    const cutoff = new Date(now.getTime() - maxAgeHours * 60 * 60 * 1000);
    const [studios, latest] = await Promise.all([
      this.prisma.studio.findMany({ where: { isActive: true }, select: { id: true } }),
      this.prisma.memberRiskSnapshot.groupBy({ by: ['studioId'], _max: { computedAt: true } }),
    ]);
    const latestByStudio = new Map(latest.map((row) => [row.studioId, row._max.computedAt]));
    let studiosProcessed = 0;
    let membersScored = 0;
    for (const studio of studios) {
      const last = latestByStudio.get(studio.id);
      if (last && last > cutoff) continue;
      const result = await this.recomputeStudio(studio.id, now);
      studiosProcessed += 1;
      membersScored += result.membersScored;
    }
    return { studiosProcessed, membersScored };
  }

  /** Recomputes every active studio unconditionally; used by the super-admin trigger endpoint. */
  async recomputeAll(now: Date = new Date()): Promise<{ studiosProcessed: number; membersScored: number }> {
    const studios = await this.prisma.studio.findMany({ where: { isActive: true }, select: { id: true } });
    let membersScored = 0;
    for (const studio of studios) {
      const result = await this.recomputeStudio(studio.id, now);
      membersScored += result.membersScored;
    }
    return { studiosProcessed: studios.length, membersScored };
  }

  /** Rate-limited (once per 10 minutes per studio) wrapper for the staff-facing recompute endpoint. */
  async recomputeStudioRateLimited(tenant: TenantContext, actorUserId: string, now?: Date): Promise<{ studioId: string; membersScored: number }> {
    const cutoff = new Date(Date.now() - RATE_LIMIT_MS);
    const recent = await this.prisma.auditLog.findFirst({
      where: { studioId: tenant.studioId, action: 'churn.recompute', createdAt: { gte: cutoff } },
      orderBy: { createdAt: 'desc' },
    });
    if (recent) {
      throw new HttpException('Yeniden hesaplama en fazla 10 dakikada bir yapılabilir, lütfen daha sonra tekrar deneyin', HttpStatus.TOO_MANY_REQUESTS);
    }
    const result = await this.recomputeStudio(tenant.studioId, now);
    await this.prisma.auditLog.create({
      data: {
        studioId: tenant.studioId,
        userId: actorUserId,
        action: 'churn.recompute',
        entityType: 'Studio',
        entityId: tenant.studioId,
        metadata: { membersScored: result.membersScored },
      },
    });
    return result;
  }

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  async findAll(tenant: TenantContext, query: ChurnListQuery): Promise<ChurnListResponseDTO> {
    const homeBranchWhere = this.resolveHomeBranchWhere(tenant, query.branchId);
    const now = new Date();

    const where: Prisma.MemberRiskSnapshotWhereInput = {
      studioId: tenant.studioId,
      ...(query.level ? { level: query.level } : {}),
      ...(query.includeSnoozed ? {} : { OR: [{ snoozedUntil: null }, { snoozedUntil: { lt: now } }] }),
      member: {
        membership: { status: 'ACTIVE' },
        ...homeBranchWhere,
        ...(query.search
          ? {
              membership: {
                status: 'ACTIVE',
                user: {
                  OR: [
                    { firstName: { contains: query.search, mode: 'insensitive' as const } },
                    { lastName: { contains: query.search, mode: 'insensitive' as const } },
                    // Phone search only for callers allowed to see phones,
                    // otherwise it would be an enumeration oracle.
                    ...(tenant.permissions.has('members.contact.view') ? [{ phone: { contains: query.search } }] : []),
                  ],
                },
              },
            }
          : {}),
      },
    };

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.memberRiskSnapshot.count({ where }),
      this.prisma.memberRiskSnapshot.findMany({
        where,
        include: this.snapshotInclude(),
        orderBy: { score: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
    ]);

    return {
      items: rows.map((r) => this.toSummary(tenant, r)),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  /** Same filtering as findAll but unpaginated, for CSV export. */
  async findAllForExport(tenant: TenantContext, query: ChurnListQuery): Promise<ChurnMemberSummaryDTO[]> {
    const homeBranchWhere = this.resolveHomeBranchWhere(tenant, query.branchId);
    const now = new Date();
    const where: Prisma.MemberRiskSnapshotWhereInput = {
      studioId: tenant.studioId,
      ...(query.level ? { level: query.level } : {}),
      ...(query.includeSnoozed ? {} : { OR: [{ snoozedUntil: null }, { snoozedUntil: { lt: now } }] }),
      member: { membership: { status: 'ACTIVE' }, ...homeBranchWhere },
    };
    const rows = await this.prisma.memberRiskSnapshot.findMany({ where, include: this.snapshotInclude(), orderBy: { score: 'desc' } });
    return rows.map((r) => this.toSummary(tenant, r));
  }

  async summary(tenant: TenantContext): Promise<ChurnSummaryDTO> {
    const homeBranchWhere = this.resolveHomeBranchWhere(tenant, undefined);
    const visibleMembers = await this.prisma.memberProfile.findMany({
      where: { studioId: tenant.studioId, membership: { status: 'ACTIVE' }, ...homeBranchWhere },
      select: { id: true },
    });
    const memberIds = visibleMembers.map((m) => m.id);
    if (memberIds.length === 0) {
      return { studioId: tenant.studioId, counts: CHURN_RISK_LEVELS.map((level) => ({ level, count: 0, previousCount: 0 })), computedAt: null };
    }

    const snapshots = await this.prisma.memberRiskSnapshot.findMany({
      where: { studioId: tenant.studioId, memberId: { in: memberIds } },
      select: { level: true, computedAt: true },
    });
    const latestComputedAt = snapshots.reduce<Date | null>((max, s) => (!max || s.computedAt > max ? s.computedAt : max), null);

    const cutoff = new Date(Date.now() - 7 * DAY_MS);
    const historyRows = await this.prisma.memberRiskHistory.findMany({
      where: { studioId: tenant.studioId, memberId: { in: memberIds }, computedAt: { lte: cutoff } },
      orderBy: { computedAt: 'desc' },
      select: { memberId: true, level: true },
    });
    const seen = new Set<string>();
    const previousLevelByMember = new Map<string, ChurnRiskLevel>();
    for (const row of historyRows) {
      if (seen.has(row.memberId)) continue;
      seen.add(row.memberId);
      previousLevelByMember.set(row.memberId, row.level);
    }

    const counts = new Map<ChurnRiskLevel, number>(CHURN_RISK_LEVELS.map((l) => [l, 0]));
    for (const s of snapshots) counts.set(s.level, (counts.get(s.level) ?? 0) + 1);
    const previousCounts = new Map<ChurnRiskLevel, number>(CHURN_RISK_LEVELS.map((l) => [l, 0]));
    for (const level of previousLevelByMember.values()) previousCounts.set(level, (previousCounts.get(level) ?? 0) + 1);

    const result: ChurnLevelCountDTO[] = CHURN_RISK_LEVELS.map((level) => ({
      level,
      count: counts.get(level) ?? 0,
      previousCount: previousCounts.get(level) ?? 0,
    }));
    return { studioId: tenant.studioId, counts: result, computedAt: latestComputedAt ? latestComputedAt.toISOString() : null };
  }

  async findById(tenant: TenantContext, memberId: string): Promise<ChurnMemberSummaryDTO> {
    const row = await this.prisma.memberRiskSnapshot.findFirst({
      where: { studioId: tenant.studioId, memberId },
      include: this.snapshotInclude(),
    });
    if (!row) throw new NotFoundException('Bu üye için henüz risk puanı hesaplanmamış');
    assertBranchAccess(tenant, row.member.homeBranchId);
    return this.toSummary(tenant, row);
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  async markContacted(tenant: TenantContext, memberId: string, actorUserId: string, input: MarkContactedInput): Promise<ChurnMemberSummaryDTO> {
    const existing = await this.prisma.memberRiskSnapshot.findFirst({ where: { studioId: tenant.studioId, memberId } });
    if (!existing) throw new NotFoundException('Bu üye için henüz risk puanı hesaplanmamış');
    assertBranchAccess(tenant, await this.memberHomeBranchId(memberId));

    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.memberRiskSnapshot.update({
        where: { memberId },
        data: { contactedAt: now, contactedByUserId: actorUserId, contactNote: input.note },
      }),
      this.prisma.auditLog.create({
        data: {
          studioId: tenant.studioId,
          userId: actorUserId,
          action: 'churn.contacted',
          entityType: 'MemberProfile',
          entityId: memberId,
          metadata: { note: input.note },
        },
      }),
    ]);
    return this.findById(tenant, memberId);
  }

  async snooze(tenant: TenantContext, memberId: string, actorUserId: string, days: number): Promise<ChurnMemberSummaryDTO> {
    const existing = await this.prisma.memberRiskSnapshot.findFirst({ where: { studioId: tenant.studioId, memberId } });
    if (!existing) throw new NotFoundException('Bu üye için henüz risk puanı hesaplanmamış');
    assertBranchAccess(tenant, await this.memberHomeBranchId(memberId));

    const snoozedUntil = new Date(Date.now() + days * DAY_MS);
    await this.prisma.$transaction([
      this.prisma.memberRiskSnapshot.update({ where: { memberId }, data: { snoozedUntil } }),
      this.prisma.auditLog.create({
        data: {
          studioId: tenant.studioId,
          userId: actorUserId,
          action: 'churn.snoozed',
          entityType: 'MemberProfile',
          entityId: memberId,
          metadata: { days, snoozedUntil: snoozedUntil.toISOString() },
        },
      }),
    ]);
    return this.findById(tenant, memberId);
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async memberHomeBranchId(memberId: string): Promise<string | null> {
    const member = await this.prisma.memberProfile.findUniqueOrThrow({ where: { id: memberId }, select: { homeBranchId: true } });
    return member.homeBranchId;
  }

  private resolveHomeBranchWhere(tenant: TenantContext, requestedBranchId: string | undefined) {
    if (requestedBranchId) {
      assertBranchAccess(tenant, requestedBranchId);
      return { homeBranchId: requestedBranchId };
    }
    if (tenant.branchIds === null) return {};
    return { OR: [{ homeBranchId: { in: [...tenant.branchIds] } }, { homeBranchId: null }] };
  }

  private snapshotInclude() {
    return {
      member: { include: { membership: { include: { user: true } } } },
    } satisfies Prisma.MemberRiskSnapshotInclude;
  }

  private toSummary(tenant: TenantContext, row: Prisma.MemberRiskSnapshotGetPayload<{ include: { member: { include: { membership: { include: { user: true } } } } } }>): ChurnMemberSummaryDTO {
    const user = row.member.membership?.user;
    const dto: ChurnMemberSummaryDTO = {
      memberId: row.memberId,
      membershipId: row.member.membershipId,
      firstName: user?.firstName ?? '',
      lastName: user?.lastName ?? '',
      homeBranchId: row.member.homeBranchId ?? null,
      score: row.score,
      previousScore: row.previousScore,
      level: row.level,
      onboarding: row.onboarding,
      reasons: row.reasons as unknown as ChurnReasonDTO[],
      lastAttendedAt: row.lastAttendedAt ? row.lastAttendedAt.toISOString() : null,
      activePackageEndDate: row.activePackageEndDate ? row.activePackageEndDate.toISOString() : null,
      contactedAt: row.contactedAt ? row.contactedAt.toISOString() : null,
      snoozedUntil: row.snoozedUntil ? row.snoozedUntil.toISOString() : null,
      computedAt: row.computedAt.toISOString(),
    };
    if (tenant.permissions.has('members.contact.view')) {
      dto.phone = user?.phone;
    }
    return dto;
  }
}
