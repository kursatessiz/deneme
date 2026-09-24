import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@platform/database';
import {
  BadgeKind,
  BadgeThresholdParamsSchema,
  maskLeaderboardName,
  type BadgeDefinitionDTO,
  type BadgeThresholdParams,
  type CreateBadgeDefinitionInput,
  type EarnedBadgeDTO,
  type GamificationSettingsDTO,
  type LeaderboardDTO,
  type LeaderboardEntryDTO,
  type MemberAchievementSummaryDTO,
  type MyGamificationStatsDTO,
  type NextBadgeProgressDTO,
  type SetMonthlyGoalInput,
  type UpdateBadgeDefinitionInput,
} from '@platform/shared';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { TenantContext } from '../auth/tenant-context';
import { computeStreakWeeks, countDistinctServiceTypes, countSessionsInLocalMonth, getLocalMonthKey, isEarlyBirdSession } from './gamification-calculations';

interface AttendedSession {
  startTime: Date;
  serviceTypeId: string;
}

const LEADERBOARD_LIMIT = 20;
const NEXT_BADGES_LIMIT = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class GamificationService {
  private readonly logger = new Logger(GamificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  // ---------------------------------------------------------------------------
  // Studio setting: enable / disable gamification
  // ---------------------------------------------------------------------------

  async getSettings(tenant: TenantContext): Promise<GamificationSettingsDTO> {
    const studio = await this.prisma.studio.findUniqueOrThrow({ where: { id: tenant.studioId }, select: { gamificationEnabled: true } });
    return { enabled: studio.gamificationEnabled };
  }

  async updateSettings(tenant: TenantContext, enabled: boolean): Promise<GamificationSettingsDTO> {
    await this.prisma.studio.update({ where: { id: tenant.studioId }, data: { gamificationEnabled: enabled } });
    return { enabled };
  }

  // ---------------------------------------------------------------------------
  // Badge definitions (staff CRUD)
  // ---------------------------------------------------------------------------

  async listDefinitions(tenant: TenantContext): Promise<BadgeDefinitionDTO[]> {
    const rows = await this.prisma.badgeDefinition.findMany({
      where: { OR: [{ studioId: null }, { studioId: tenant.studioId }] },
      orderBy: [{ studioId: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map((r) => this.toDefinitionDTO(r));
  }

  async createDefinition(tenant: TenantContext, input: CreateBadgeDefinitionInput): Promise<BadgeDefinitionDTO> {
    try {
      const row = await this.prisma.badgeDefinition.create({
        data: {
          studioId: tenant.studioId,
          key: input.key,
          name: input.name,
          description: input.description || null,
          kind: input.kind,
          threshold: input.threshold,
          isActive: input.isActive,
        },
      });
      return this.toDefinitionDTO(row);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('Bu anahtarla bir rozet zaten var');
      }
      throw err;
    }
  }

  async updateDefinition(tenant: TenantContext, id: string, input: UpdateBadgeDefinitionInput): Promise<BadgeDefinitionDTO> {
    const existing = await this.prisma.badgeDefinition.findFirst({ where: { id, studioId: tenant.studioId } });
    if (!existing) {
      throw new NotFoundException('Rozet tanımı bulunamadı (yalnızca işletmenizin kendi rozetleri düzenlenebilir)');
    }
    if (input.threshold && input.threshold.kind !== existing.kind) {
      throw new BadRequestException('threshold.kind, rozetin türüyle eşleşmelidir');
    }
    const row = await this.prisma.badgeDefinition.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description || null } : {}),
        ...(input.threshold !== undefined ? { threshold: input.threshold } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
    });
    return this.toDefinitionDTO(row);
  }

  async deleteDefinition(tenant: TenantContext, id: string): Promise<void> {
    const existing = await this.prisma.badgeDefinition.findFirst({ where: { id, studioId: tenant.studioId } });
    if (!existing) {
      throw new NotFoundException('Rozet tanımı bulunamadı (yalnızca işletmenizin kendi rozetleri silinebilir)');
    }
    const earned = await this.prisma.memberBadge.count({ where: { badgeDefinitionId: id } });
    if (earned > 0) {
      throw new ConflictException('Bu rozet üyeler tarafından kazanılmış; silmek yerine pasif hale getirin');
    }
    await this.prisma.badgeDefinition.delete({ where: { id } });
  }

  /**
   * `kind` comes in as Prisma's generated enum, which is structurally
   * identical to `@platform/shared`'s `BadgeKind` but a distinct nominal
   * type; it is cast once here at the persistence boundary.
   */
  private toDefinitionDTO(row: {
    id: string;
    studioId: string | null;
    key: string;
    name: string;
    description: string | null;
    kind: string;
    threshold: Prisma.JsonValue;
    isActive: boolean;
    createdAt: Date;
  }): BadgeDefinitionDTO {
    const kind = row.kind as BadgeKind;
    const parsed = BadgeThresholdParamsSchema.safeParse(row.threshold);
    return {
      id: row.id,
      studioId: row.studioId,
      key: row.key,
      name: row.name,
      description: row.description,
      kind,
      threshold: parsed.success ? parsed.data : ({ kind } as BadgeThresholdParams),
      isActive: row.isActive,
      createdAt: row.createdAt.toISOString(),
    };
  }

  // ---------------------------------------------------------------------------
  // Evaluation: called after check-in, and for a manual studio backfill.
  // Never throws to the caller of onAttendance -- see SchedulesService.checkIn.
  // ---------------------------------------------------------------------------

  async onAttendance(bookingId: string): Promise<void> {
    const booking = await this.prisma.booking.findUnique({ where: { id: bookingId }, select: { studioId: true, memberId: true } });
    if (!booking) return;
    await this.evaluateMemberBadges(booking.studioId, booking.memberId, bookingId);
  }

  async backfill(tenant: TenantContext): Promise<{ membersEvaluated: number; badgesAwarded: number }> {
    const members = await this.prisma.memberProfile.findMany({ where: { studioId: tenant.studioId }, select: { id: true } });
    let badgesAwarded = 0;
    for (const member of members) {
      try {
        const newlyEarned = await this.evaluateMemberBadges(tenant.studioId, member.id);
        badgesAwarded += newlyEarned.length;
      } catch (err) {
        this.logger.warn(`Gamification backfill failed for member ${member.id}: ${(err as Error).message}`);
      }
    }
    return { membersEvaluated: members.length, badgesAwarded };
  }

  /** Recomputes every badge condition for a member from their full attendance history and awards any newly met ones. */
  private async evaluateMemberBadges(studioId: string, memberId: string, sourceRef?: string) {
    const studio = await this.prisma.studio.findUnique({ where: { id: studioId }, select: { timezone: true, gamificationEnabled: true } });
    if (!studio || !studio.gamificationEnabled) return [];

    const attendedBookings = await this.prisma.booking.findMany({
      where: { studioId, memberId, status: 'ATTENDED' },
      select: { schedule: { select: { startTime: true, serviceTypeId: true } } },
    });
    const sessions: AttendedSession[] = attendedBookings.map((b) => ({
      startTime: b.schedule.startTime,
      serviceTypeId: b.schedule.serviceTypeId,
    }));
    const attendedAt = sessions.map((s) => s.startTime);

    const goals = await this.prisma.memberGoal.findMany({ where: { studioId, memberId } });
    const anyMonthlyGoalMet = goals.some((g) => countSessionsInLocalMonth(attendedAt, studio.timezone, g.month) >= g.targetSessions);

    const definitions = await this.prisma.badgeDefinition.findMany({
      where: { isActive: true, OR: [{ studioId: null }, { studioId }] },
    });
    const alreadyEarned = await this.prisma.memberBadge.findMany({ where: { memberId }, select: { badgeDefinitionId: true } });
    const earnedIds = new Set(alreadyEarned.map((e) => e.badgeDefinitionId));

    const newlyEarned: { badgeDefinitionId: string; name: string; description: string | null; kind: BadgeKind }[] = [];

    for (const def of definitions) {
      if (earnedIds.has(def.id)) continue;
      const parsed = BadgeThresholdParamsSchema.safeParse(def.threshold);
      if (!parsed.success || parsed.data.kind !== (def.kind as BadgeKind)) {
        this.logger.warn(`Skipping badge ${def.id}: threshold does not match kind ${def.kind}`);
        continue;
      }
      const threshold = parsed.data;
      const met = this.isConditionMet(threshold, { sessions, attendedAt, timeZone: studio.timezone, anyMonthlyGoalMet });
      if (!met) continue;

      const created = await this.tryAward(studioId, memberId, def.id, sourceRef);
      if (created) newlyEarned.push({ badgeDefinitionId: def.id, name: def.name, description: def.description, kind: def.kind as BadgeKind });
    }

    if (newlyEarned.length > 0) {
      await this.notifyNewBadges(studioId, memberId, newlyEarned);
    }
    return newlyEarned;
  }

  private isConditionMet(
    threshold: BadgeThresholdParams,
    ctx: { sessions: AttendedSession[]; attendedAt: Date[]; timeZone: string; anyMonthlyGoalMet: boolean },
  ): boolean {
    switch (threshold.kind) {
      case BadgeKind.FIRST_SESSION:
        return ctx.sessions.length >= 1;
      case BadgeKind.MILESTONE_SESSIONS:
        return ctx.sessions.length >= threshold.sessions;
      case BadgeKind.STREAK_WEEKS: {
        const { bestStreakWeeks } = computeStreakWeeks(ctx.attendedAt, ctx.timeZone, threshold.minSessionsPerWeek);
        return bestStreakWeeks >= threshold.weeks;
      }
      case BadgeKind.VARIETY:
        return countDistinctServiceTypes(ctx.sessions.map((s) => s.serviceTypeId)) >= threshold.distinctServiceTypes;
      case BadgeKind.EARLY_BIRD:
        return ctx.sessions.some((s) => isEarlyBirdSession(s.startTime, ctx.timeZone, threshold.beforeHour));
      case BadgeKind.MONTHLY_GOAL_MET:
        return ctx.anyMonthlyGoalMet;
      default:
        return false;
    }
  }

  /** Idempotent via the unique (memberId, badgeDefinitionId) constraint; returns false on a race. */
  private async tryAward(studioId: string, memberId: string, badgeDefinitionId: string, sourceRef?: string): Promise<boolean> {
    try {
      await this.prisma.memberBadge.create({ data: { studioId, memberId, badgeDefinitionId, sourceRef: sourceRef ?? null } });
      return true;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return false;
      throw err;
    }
  }

  private async notifyNewBadges(
    studioId: string,
    memberId: string,
    badges: { name: string; description: string | null }[],
  ): Promise<void> {
    const member = await this.prisma.memberProfile.findUnique({
      where: { id: memberId },
      select: { membership: { select: { userId: true, isPartnerGuest: true } } },
    });
    // Partner guests never onboarded into the app; do not push engagement
    // notifications at them until they become a real member.
    if (!member || member.membership.isPartnerGuest) return;
    for (const badge of badges) {
      try {
        await this.notifications.notifyUser({
          userId: member.membership.userId,
          studioId,
          category: 'ACHIEVEMENT',
          message: { title: `Yeni rozet: ${badge.name}`, body: badge.description ?? 'Tebrikler, yeni bir rozet kazandın.' },
        });
      } catch (err) {
        this.logger.warn(`Achievement notification failed for member ${memberId}: ${(err as Error).message}`);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Member self-service
  // ---------------------------------------------------------------------------

  async myStats(tenant: TenantContext): Promise<MyGamificationStatsDTO> {
    const memberId = this.requireMemberId(tenant);
    const studio = await this.prisma.studio.findUniqueOrThrow({ where: { id: tenant.studioId }, select: { timezone: true } });

    const attendedBookings = await this.prisma.booking.findMany({
      where: { studioId: tenant.studioId, memberId, status: 'ATTENDED' },
      select: { schedule: { select: { startTime: true, serviceTypeId: true } } },
    });
    const sessions: AttendedSession[] = attendedBookings.map((b) => ({
      startTime: b.schedule.startTime,
      serviceTypeId: b.schedule.serviceTypeId,
    }));
    const attendedAt = sessions.map((s) => s.startTime);
    const totalAttendedSessions = sessions.length;
    const overallStreak = computeStreakWeeks(attendedAt, studio.timezone, 1);

    const currentMonth = getLocalMonthKey(new Date(), studio.timezone);
    const goal = await this.prisma.memberGoal.findUnique({ where: { memberId_month: { memberId, month: currentMonth } } });
    const progress = countSessionsInLocalMonth(attendedAt, studio.timezone, currentMonth);

    const definitions = await this.prisma.badgeDefinition.findMany({
      where: { isActive: true, OR: [{ studioId: null }, { studioId: tenant.studioId }] },
    });
    const earned = await this.prisma.memberBadge.findMany({
      where: { memberId },
      include: { badgeDefinition: true },
      orderBy: { earnedAt: 'desc' },
    });
    const earnedIds = new Set(earned.map((e) => e.badgeDefinitionId));

    const earnedBadges: EarnedBadgeDTO[] = earned.map((e) => ({
      badgeDefinitionId: e.badgeDefinitionId,
      key: e.badgeDefinition.key,
      name: e.badgeDefinition.name,
      description: e.badgeDefinition.description,
      kind: e.badgeDefinition.kind as BadgeKind,
      earnedAt: e.earnedAt.toISOString(),
    }));

    const distinctServiceTypes = countDistinctServiceTypes(sessions.map((s) => s.serviceTypeId));
    const goals = await this.prisma.memberGoal.findMany({ where: { memberId } });
    const anyMonthlyGoalMet = goals.some((g) => countSessionsInLocalMonth(attendedAt, studio.timezone, g.month) >= g.targetSessions);

    const nextBadges: NextBadgeProgressDTO[] = [];
    for (const def of definitions) {
      if (earnedIds.has(def.id)) continue;
      const parsed = BadgeThresholdParamsSchema.safeParse(def.threshold);
      if (!parsed.success || parsed.data.kind !== (def.kind as BadgeKind)) continue;
      const threshold = parsed.data;
      const progressInfo = this.progressFor(threshold, {
        totalAttendedSessions,
        distinctServiceTypes,
        attendedAt,
        timeZone: studio.timezone,
        anyMonthlyGoalMet,
        currentMonthProgress: progress,
        currentMonthTarget: goal?.targetSessions ?? null,
      });
      nextBadges.push({
        badgeDefinitionId: def.id,
        key: def.key,
        name: def.name,
        description: def.description,
        kind: def.kind as BadgeKind,
        progressRatio: progressInfo.ratio,
        progressLabel: progressInfo.label,
      });
    }
    nextBadges.sort((a, b) => b.progressRatio - a.progressRatio);

    const memberProfile = await this.prisma.memberProfile.findUniqueOrThrow({ where: { id: memberId }, select: { leaderboardOptIn: true } });

    return {
      totalAttendedSessions,
      currentStreakWeeks: overallStreak.currentStreakWeeks,
      bestStreakWeeks: overallStreak.bestStreakWeeks,
      currentMonth: {
        month: currentMonth,
        targetSessions: goal?.targetSessions ?? null,
        progress,
        metGoal: goal ? progress >= goal.targetSessions : false,
      },
      leaderboardOptedIn: memberProfile.leaderboardOptIn,
      earnedBadges,
      nextBadges: nextBadges.slice(0, NEXT_BADGES_LIMIT),
    };
  }

  private progressFor(
    threshold: BadgeThresholdParams,
    ctx: {
      totalAttendedSessions: number;
      distinctServiceTypes: number;
      attendedAt: Date[];
      timeZone: string;
      anyMonthlyGoalMet: boolean;
      currentMonthProgress: number;
      currentMonthTarget: number | null;
    },
  ): { ratio: number; label: string } {
    const clamp = (v: number) => Math.max(0, Math.min(1, v));
    switch (threshold.kind) {
      case BadgeKind.MILESTONE_SESSIONS:
        return { ratio: clamp(ctx.totalAttendedSessions / threshold.sessions), label: `${ctx.totalAttendedSessions}/${threshold.sessions} seans` };
      case BadgeKind.STREAK_WEEKS: {
        const { currentStreakWeeks, bestStreakWeeks } = computeStreakWeeks(ctx.attendedAt, ctx.timeZone, threshold.minSessionsPerWeek);
        const streak = Math.max(currentStreakWeeks, bestStreakWeeks);
        return { ratio: clamp(streak / threshold.weeks), label: `${streak}/${threshold.weeks} hafta` };
      }
      case BadgeKind.VARIETY:
        return {
          ratio: clamp(ctx.distinctServiceTypes / threshold.distinctServiceTypes),
          label: `${ctx.distinctServiceTypes}/${threshold.distinctServiceTypes} hizmet türü`,
        };
      case BadgeKind.FIRST_SESSION:
        return { ratio: clamp(ctx.totalAttendedSessions >= 1 ? 1 : 0), label: ctx.totalAttendedSessions >= 1 ? 'Hazır' : '0/1 seans' };
      case BadgeKind.EARLY_BIRD:
        return { ratio: 0, label: 'Saat 08:00den önce başlayan bir seansa katıl' };
      case BadgeKind.MONTHLY_GOAL_MET:
        if (ctx.currentMonthTarget) {
          return {
            ratio: clamp(ctx.currentMonthProgress / ctx.currentMonthTarget),
            label: `${ctx.currentMonthProgress}/${ctx.currentMonthTarget} (bu ay)`,
          };
        }
        return { ratio: ctx.anyMonthlyGoalMet ? 1 : 0, label: 'Aylık hedef belirleyin' };
      default:
        return { ratio: 0, label: '' };
    }
  }

  async setMonthlyGoal(tenant: TenantContext, input: SetMonthlyGoalInput) {
    const memberId = this.requireMemberId(tenant);
    await this.prisma.memberGoal.upsert({
      where: { memberId_month: { memberId, month: input.month } },
      create: { studioId: tenant.studioId, memberId, month: input.month, targetSessions: input.targetSessions },
      update: { targetSessions: input.targetSessions },
    });
    return this.myStats(tenant);
  }

  async setLeaderboardOptIn(tenant: TenantContext, optedIn: boolean) {
    const memberId = this.requireMemberId(tenant);
    await this.prisma.memberProfile.update({ where: { id: memberId }, data: { leaderboardOptIn: optedIn } });
    return { optedIn };
  }

  async leaderboard(tenant: TenantContext, month: string): Promise<LeaderboardDTO> {
    this.requireMemberId(tenant);
    const studio = await this.prisma.studio.findUniqueOrThrow({ where: { id: tenant.studioId }, select: { timezone: true } });
    const [yearStr, monthStr] = month.split('-');
    const year = Number(yearStr);
    const monthNum = Number(monthStr);
    const rangeStart = new Date(Date.UTC(year, monthNum - 1, 1) - DAY_MS);
    const rangeEnd = new Date(Date.UTC(year, monthNum, 1) + DAY_MS);

    const optedIn = await this.prisma.memberProfile.findMany({
      where: { studioId: tenant.studioId, leaderboardOptIn: true, membership: { status: 'ACTIVE', isPartnerGuest: false } },
      select: { id: true, membership: { select: { user: { select: { firstName: true, lastName: true } } } } },
    });
    if (optedIn.length === 0) return { month, entries: [] };

    const bookings = await this.prisma.booking.findMany({
      where: {
        studioId: tenant.studioId,
        memberId: { in: optedIn.map((m) => m.id) },
        status: 'ATTENDED',
        schedule: { startTime: { gte: rangeStart, lt: rangeEnd } },
      },
      select: { memberId: true, schedule: { select: { startTime: true } } },
    });

    const byMember = new Map<string, Date[]>();
    for (const b of bookings) {
      const arr = byMember.get(b.memberId) ?? [];
      arr.push(b.schedule.startTime);
      byMember.set(b.memberId, arr);
    }

    const ranked = optedIn
      .map((m) => ({
        memberId: m.id,
        displayName: maskLeaderboardName(m.membership.user.firstName, m.membership.user.lastName),
        sessions: countSessionsInLocalMonth(byMember.get(m.id) ?? [], studio.timezone, month),
      }))
      .filter((e) => e.sessions > 0)
      .sort((a, b) => b.sessions - a.sessions)
      .slice(0, LEADERBOARD_LIMIT);

    const entries: LeaderboardEntryDTO[] = ranked.map((e, i) => ({
      rank: i + 1,
      displayName: e.displayName,
      sessions: e.sessions,
      isSelf: e.memberId === tenant.memberProfileId,
    }));
    return { month, entries };
  }

  private requireMemberId(tenant: TenantContext): string {
    if (!tenant.memberProfileId) {
      throw new ForbiddenException('Bu özellik yalnızca üyeler içindir');
    }
    return tenant.memberProfileId;
  }

  // ---------------------------------------------------------------------------
  // Staff: member achievements overview
  // ---------------------------------------------------------------------------

  async memberAchievements(tenant: TenantContext): Promise<MemberAchievementSummaryDTO[]> {
    const studio = await this.prisma.studio.findUniqueOrThrow({ where: { id: tenant.studioId }, select: { timezone: true } });
    // Branch-restricted staff see members of their branches plus members
    // without a home branch, same rule as branch-access.ts / churn.
    const branchWhere =
      tenant.branchIds === null ? {} : { OR: [{ homeBranchId: { in: [...tenant.branchIds] } }, { homeBranchId: null }] };
    const members = await this.prisma.memberProfile.findMany({
      where: { studioId: tenant.studioId, ...branchWhere },
      select: {
        id: true,
        membership: { select: { user: { select: { firstName: true, lastName: true } } } },
        _count: { select: { badges: true } },
      },
    });
    if (members.length === 0) return [];

    // One query for all members instead of one per member.
    const attended = await this.prisma.booking.findMany({
      where: { studioId: tenant.studioId, memberId: { in: members.map((m) => m.id) }, status: 'ATTENDED' },
      select: { memberId: true, schedule: { select: { startTime: true } } },
    });
    const byMember = new Map<string, Date[]>();
    for (const b of attended) {
      const arr = byMember.get(b.memberId) ?? [];
      arr.push(b.schedule.startTime);
      byMember.set(b.memberId, arr);
    }

    const results: MemberAchievementSummaryDTO[] = [];
    for (const m of members) {
      const attendedAt = byMember.get(m.id) ?? [];
      const streak = computeStreakWeeks(attendedAt, studio.timezone, 1);
      results.push({
        memberId: m.id,
        memberName: `${m.membership.user.firstName} ${m.membership.user.lastName}`,
        totalAttendedSessions: attendedAt.length,
        currentStreakWeeks: streak.currentStreakWeeks,
        bestStreakWeeks: streak.bestStreakWeeks,
        badgeCount: m._count.badges,
      });
    }
    return results.sort((a, b) => b.totalAttendedSessions - a.totalAttendedSessions);
  }
}
