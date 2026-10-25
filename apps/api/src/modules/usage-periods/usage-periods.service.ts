import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import {
  endsInside,
  firstBlockingTier,
  netEventUnitsConsumed,
  netUnitsConsumed,
  parseUsageRule,
  periodAt,
  sortTiersFinerFirst,
} from '@platform/shared';
import type { UsagePeriod, UsagePeriodStatusDTO, UsageRule, UsageTier, FreezeInterval } from '@platform/shared';
import { Prisma } from '@platform/database';
import { PrismaService } from '../prisma/prisma.service';
import { apiError } from '../../common/api-error';
import { requestLocale, requestT } from '../../common/server-i18n';
import type { TenantContext } from '../auth/tenant-context';

type Db = PrismaService | Prisma.TransactionClient;

/** The fields of a member package the period logic reads. */
export interface UsagePackageRef {
  id: string;
  studioId: string;
  entitlementKind: string;
  startDate: Date;
  endDate: Date;
  usageRule: Prisma.JsonValue | null;
}

export interface UsageStudioContext {
  enabled: boolean;
  timeZone: string;
}

export interface TierCheck {
  tier: UsageTier;
  period: UsagePeriod;
  /** Net units consumed in the period plus the units burned by finer tiers inside it. */
  consumed: number;
}

/**
 * Usage periods (docs/KULLANIM_DONEMLERI.md): the studio switch, the quota check used by every
 * package-charging path, the consumption accounting shared by enforcement, burn and reminders, and
 * the DTO of the current period. Time zone of every calendar computation: the studio's zone.
 */
@Injectable()
export class UsagePeriodsService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------------
  // Studio switch
  // ---------------------------------------------------------------------------

  async context(db: Db, studioId: string): Promise<UsageStudioContext> {
    const studio = await db.studio.findUnique({ where: { id: studioId }, select: { usagePeriodsEnabled: true, timezone: true } });
    return { enabled: studio?.usagePeriodsEnabled ?? false, timeZone: studio?.timezone ?? 'UTC' };
  }

  async getSetting(studioId: string): Promise<{ enabled: boolean }> {
    return { enabled: (await this.context(this.prisma, studioId)).enabled };
  }

  /** Owner only: even staff with studio.settings.manage get 403. Audited as studio.usagePeriods.enable|disable. */
  async setEnabled(tenant: TenantContext, userId: string, enabled: boolean): Promise<{ enabled: boolean }> {
    if (!tenant.isOwner) throw new ForbiddenException(apiError('apiErrors.studios.onlyOwnerCanChangeUsagePeriods'));
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.studio.findUniqueOrThrow({ where: { id: tenant.studioId }, select: { usagePeriodsEnabled: true } });
      await tx.studio.update({ where: { id: tenant.studioId }, data: { usagePeriodsEnabled: enabled } });
      await tx.auditLog.create({
        data: {
          studioId: tenant.studioId,
          userId,
          action: enabled ? 'studio.usagePeriods.enable' : 'studio.usagePeriods.disable',
          entityType: 'Studio',
          entityId: tenant.studioId,
          metadata: { previous: before.usagePeriodsEnabled, enabled },
        },
      });
      return { enabled };
    });
  }

  // ---------------------------------------------------------------------------
  // Rule access
  // ---------------------------------------------------------------------------

  /** The rule that applies at runtime: only with the studio switch on and a valid snapshot on the package. */
  activeRule(ctx: UsageStudioContext, pkg: Pick<UsagePackageRef, 'usageRule'>): UsageRule | null {
    return ctx.enabled ? parseUsageRule(pkg.usageRule) : null;
  }

  /**
   * The rule to snapshot on a package sold or renewed now: the definition's rule, only while the
   * switch is on. `undefined` leaves the column null (Prisma skips undefined fields).
   */
  async snapshotFor(db: Db, studioId: string, definition: { usageRule?: Prisma.JsonValue | null }): Promise<Prisma.InputJsonValue | undefined> {
    if (definition.usageRule === null || definition.usageRule === undefined) return undefined;
    const rule = parseUsageRule(definition.usageRule);
    if (!rule) return undefined;
    const ctx = await this.context(db, studioId);
    return ctx.enabled ? (rule as unknown as Prisma.InputJsonValue) : undefined;
  }

  // ---------------------------------------------------------------------------
  // Accounting
  // ---------------------------------------------------------------------------

  async freezesOf(db: Db, memberPackageId: string): Promise<FreezeInterval[]> {
    const rows = await db.packageFreezeHistory.findMany({
      where: { memberPackageId },
      select: { freezeStartDate: true, freezeEndDate: true },
    });
    return rows.map((r) => ({ start: r.freezeStartDate, end: r.freezeEndDate }));
  }

  /**
   * Net units a package has consumed by sessions and events that start in [from, to). `excludeScheduleId`
   * leaves out the booking about to be created or re-opened for that schedule.
   */
  async consumedBetween(db: Db, pkg: UsagePackageRef, from: Date, to: Date, excludeScheduleId?: string): Promise<number> {
    const [bookings, registrations] = await Promise.all([
      db.booking.findMany({
        where: {
          studioId: pkg.studioId,
          memberPackageId: pkg.id,
          ...(excludeScheduleId ? { scheduleId: { not: excludeScheduleId } } : {}),
          schedule: { startTime: { gte: from, lt: to } },
        },
        select: { status: true, unitsCharged: true, penaltyUnits: true },
      }),
      pkg.entitlementKind === 'TIME_UNLIMITED'
        ? Promise.resolve([] as { unitsCharged: number; refundedUnits: number }[])
        : db.eventRegistration.findMany({
            where: { studioId: pkg.studioId, memberPackageId: pkg.id, unitsCharged: { gt: 0 }, event: { startsAt: { gte: from, lt: to } } },
            select: { unitsCharged: true, refundedUnits: true },
          }),
    ]);
    let total = 0;
    for (const b of bookings) total += netUnitsConsumed(b, pkg.entitlementKind);
    for (const r of registrations) total += netEventUnitsConsumed(r);
    return total;
  }

  /** Units burned by tiers finer than `coarser` whose period ended inside `period`. */
  async finerBurnedInside(db: Db, pkg: UsagePackageRef, rule: UsageRule, coarser: UsageTier, period: UsagePeriod): Promise<number> {
    const finerUnits = sortTiersFinerFirst(rule.tiers)
      .filter((t) => t.expireUnused && t.unit !== coarser.unit && sortTiersFinerFirst([t, coarser])[0] === t)
      .map((t) => t.unit);
    if (finerUnits.length === 0) return 0;
    const rows = await db.packageUnitExpiry.findMany({
      where: { memberPackageId: pkg.id, studioId: pkg.studioId, tierUnit: { in: finerUnits }, periodEnd: { gt: period.start, lte: period.end } },
      select: { units: true, periodEnd: true },
    });
    return rows.filter((r) => endsInside(r.periodEnd, period)).reduce((sum, r) => sum + r.units, 0);
  }

  /** Per tier (finer first): the period containing `at` and what is already consumed in it. */
  async tierChecks(
    db: Db,
    ctx: UsageStudioContext,
    pkg: UsagePackageRef,
    rule: UsageRule,
    at: Date,
    excludeScheduleId?: string,
  ): Promise<TierCheck[]> {
    const freezes = await this.freezesOf(db, pkg.id);
    const checks: TierCheck[] = [];
    for (const tier of sortTiersFinerFirst(rule.tiers)) {
      const period = periodAt(pkg.startDate, tier, freezes, at, ctx.timeZone);
      if (!period) continue; // the session starts before the package does: no period applies
      const [used, burned] = await Promise.all([
        this.consumedBetween(db, pkg, period.start, period.end, excludeScheduleId),
        this.finerBurnedInside(db, pkg, rule, tier, period),
      ]);
      checks.push({ tier, period, consumed: used + burned });
    }
    return checks;
  }

  /** What one booking or registration counts in the quota: units, or one visit for an unlimited package. */
  quotaCost(entitlementKind: string, unitCost: number): number {
    return entitlementKind === 'TIME_UNLIMITED' ? 1 : unitCost;
  }

  /** The first tier whose quota the charge would exceed, or null when the package may take it. */
  async findBlocking(
    db: Db,
    ctx: UsageStudioContext,
    pkg: UsagePackageRef,
    at: Date,
    unitCost: number,
    excludeScheduleId?: string,
  ): Promise<TierCheck | null> {
    const rule = this.activeRule(ctx, pkg);
    if (!rule) return null;
    const checks = await this.tierChecks(db, ctx, pkg, rule, at, excludeScheduleId);
    return firstBlockingTier(checks, this.quotaCost(pkg.entitlementKind, unitCost));
  }

  /** Candidate flag for selectUsablePackage: true when a tier quota blocks the booking. */
  async isQuotaReached(db: Db, ctx: UsageStudioContext, pkg: UsagePackageRef, at: Date, unitCost: number, excludeScheduleId?: string): Promise<boolean> {
    return (await this.findBlocking(db, ctx, pkg, at, unitCost, excludeScheduleId)) !== null;
  }

  /** Row lock on the member package: the quota check and the unit decrement then cannot interleave. */
  async lockPackage(tx: Prisma.TransactionClient, studioId: string, memberPackageId: string): Promise<void> {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM member_packages WHERE id = ${memberPackageId}::uuid AND studio_id = ${studioId}::uuid FOR UPDATE`);
  }

  /**
   * Inside the charging transaction: when the package has an active rule, locks its row and throws the
   * periodQuotaReached error if a tier would be exceeded. Does nothing (and takes no lock) otherwise.
   */
  async assertWithinQuota(
    tx: Prisma.TransactionClient,
    studioId: string,
    memberPackageId: string,
    at: Date,
    unitCost: number,
    excludeScheduleId?: string,
  ): Promise<void> {
    const select = { id: true, studioId: true, entitlementKind: true, startDate: true, endDate: true, usageRule: true } as const;
    // The snapshot never changes after the sale, so the cheap unlocked read decides whether a lock is needed at all.
    const first = await tx.memberPackage.findFirst({ where: { id: memberPackageId, studioId }, select });
    if (!first) return;
    const ctx = await this.context(tx, studioId);
    if (!this.activeRule(ctx, first)) return;
    await this.lockPackage(tx, studioId, memberPackageId);
    const blocking = await this.findBlocking(tx, ctx, first, at, unitCost, excludeScheduleId);
    if (blocking) throw this.quotaError(blocking, ctx.timeZone);
  }

  /** The member-facing error: "The {period} allowance of this package is used up; it renews on {date}." */
  quotaError(blocking: TierCheck, timeZone: string): BadRequestException {
    const t = requestT();
    let date: string;
    try {
      date = new Intl.DateTimeFormat(requestLocale(), { dateStyle: 'medium', timeZone }).format(blocking.period.end);
    } catch {
      date = blocking.period.end.toISOString().slice(0, 10);
    }
    return new BadRequestException(
      apiError('apiErrors.schedules.periodQuotaReached', {
        period: t(`apiTexts.usagePeriod.unit.${blocking.tier.unit}`),
        date,
      }),
    );
  }

  // ---------------------------------------------------------------------------
  // DTOs
  // ---------------------------------------------------------------------------

  /** Current period of each tier for the screens; null when the rule is not active for this package. */
  async statusFor(db: Db, ctx: UsageStudioContext, pkg: UsagePackageRef, now: Date): Promise<UsagePeriodStatusDTO[] | null> {
    const rule = this.activeRule(ctx, pkg);
    if (!rule) return null;
    const checks = await this.tierChecks(db, ctx, pkg, rule, now);
    return checks.map(({ tier, period, consumed }) => ({
      unit: tier.unit,
      length: tier.length,
      periodStart: period.start.toISOString(),
      periodEnd: new Date(Math.min(period.end.getTime(), pkg.endDate.getTime())).toISOString(),
      quota: tier.quota,
      used: consumed,
      remaining: Math.max(0, tier.quota - consumed),
      expireUnused: tier.expireUnused,
    }));
  }

  /** Sum of the burn history per member package. */
  async expiredUnitsByPackage(db: Db, studioId: string, memberPackageIds: string[]): Promise<Map<string, number>> {
    if (memberPackageIds.length === 0) return new Map();
    const rows = await db.packageUnitExpiry.groupBy({
      by: ['memberPackageId'],
      where: { studioId, memberPackageId: { in: memberPackageIds } },
      _sum: { units: true },
    });
    return new Map(rows.map((r) => [r.memberPackageId, r._sum.units ?? 0]));
  }

  /** Adds `usagePeriods` and `expiredUnits` to package rows (staff card, member self list). */
  async decorate<T extends UsagePackageRef>(
    db: Db,
    studioId: string,
    packages: readonly T[],
    now: Date = new Date(),
  ): Promise<(T & { usagePeriods: UsagePeriodStatusDTO[] | null; expiredUnits: number })[]> {
    if (packages.length === 0) return [];
    const ctx = await this.context(db, studioId);
    const expired = await this.expiredUnitsByPackage(db, studioId, packages.map((p) => p.id));
    const out: (T & { usagePeriods: UsagePeriodStatusDTO[] | null; expiredUnits: number })[] = [];
    for (const pkg of packages) {
      out.push({ ...pkg, usagePeriods: await this.statusFor(db, ctx, pkg, now), expiredUnits: expired.get(pkg.id) ?? 0 });
    }
    return out;
  }
}
