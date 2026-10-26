import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@platform/database';
import {
  USAGE_PERIOD_REMINDER_TEMPLATE_KEY,
  burnUnits,
  periodAt,
  periodsEnded,
  sortTiersFinerFirst,
} from '@platform/shared';
import type { UsageRule } from '@platform/shared';
import { PrismaService } from '../prisma/prisma.service';
import { MessagingService } from '../messaging/engine/messaging.service';
import { UsagePeriodsService } from './usage-periods.service';
import type { UsagePackageRef, UsageStudioContext } from './usage-periods.service';

const DAY_MS = 24 * 60 * 60 * 1000;
/** After a run that drained the backlog, the step waits this long (the heartbeat itself runs every 15 minutes). */
export const USAGE_JOB_INTERVAL_MS = 23 * 60 * 60 * 1000;
/** Packages loaded per page, and pages per heartbeat; a bigger backlog continues on the next heartbeat. */
export const USAGE_JOB_PAGE_SIZE = 100;
export const USAGE_JOB_MAX_PAGES = 10;

export interface UsagePeriodsJobResult {
  /** False when the step was skipped because it already completed within the last day. */
  ran: boolean;
  packagesChecked: number;
  /** Period rows written (including zero-unit periods). */
  periodsRecorded: number;
  unitsBurned: number;
  packagesDepleted: number;
  remindersSent: number;
}

const EMPTY: UsagePeriodsJobResult = { ran: false, packagesChecked: 0, periodsRecorded: 0, unitsBurned: 0, packagesDepleted: 0, remindersSent: 0 };

/**
 * Daily heartbeat step of the usage periods feature (docs/KULLANIM_DONEMLERI.md): burns the unused quota
 * of every burning tier period that ended, then reminds members before a burning period ends. Only
 * studios with the switch on and ACTIVE packages carrying a rule are touched. Both parts are idempotent:
 * burn rows have a unique key (package, tier, period start) and reminders a messaging idempotency key.
 */
@Injectable()
export class UsagePeriodsJobsService {
  private readonly logger = new Logger(UsagePeriodsJobsService.name);
  private lastCompletedAt: number | null = null;
  private cursor: string | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly usage: UsagePeriodsService,
    private readonly messaging: MessagingService,
  ) {}

  async run(now: Date): Promise<UsagePeriodsJobResult> {
    if (this.lastCompletedAt !== null && now.getTime() - this.lastCompletedAt < USAGE_JOB_INTERVAL_MS) return { ...EMPTY };
    const result: UsagePeriodsJobResult = { ...EMPTY, ran: true };
    const studios = await this.prisma.studio.findMany({ where: { usagePeriodsEnabled: true }, select: { id: true, timezone: true, usagePeriodsEnabledAt: true } });
    const studioById = new Map(studios.map((s) => [s.id, s]));
    if (studios.length === 0) {
      this.lastCompletedAt = now.getTime();
      this.cursor = null;
      return result;
    }

    let drained = false;
    for (let page = 0; page < USAGE_JOB_MAX_PAGES; page += 1) {
      const rows = await this.prisma.memberPackage.findMany({
        where: {
          studioId: { in: [...studioById.keys()] },
          status: 'ACTIVE',
          usageRule: { not: Prisma.DbNull },
          ...(this.cursor ? { id: { gt: this.cursor } } : {}),
        },
        orderBy: { id: 'asc' },
        take: USAGE_JOB_PAGE_SIZE,
        select: {
          id: true,
          studioId: true,
          memberId: true,
          entitlementKind: true,
          startDate: true,
          endDate: true,
          usageRule: true,
          remainingUnits: true,
          status: true,
          packageDefinition: { select: { name: true } },
        },
      });
      for (const row of rows) {
        const studio = studioById.get(row.studioId);
        if (!studio) continue;
        const ctx: UsageStudioContext = { enabled: true, timeZone: studio.timezone, enabledSince: studio.usagePeriodsEnabledAt };
        result.packagesChecked += 1;
        try {
          const burned = await this.burnPackage(row.id, row.studioId, ctx, now);
          result.periodsRecorded += burned.periodsRecorded;
          result.unitsBurned += burned.unitsBurned;
          if (burned.depleted) result.packagesDepleted += 1;
          if (!burned.depleted) result.remindersSent += await this.remindPackage(row.id, row.studioId, ctx, now);
        } catch (err) {
          this.logger.warn(`Usage periods for package ${row.id} failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      if (rows.length < USAGE_JOB_PAGE_SIZE) {
        drained = true;
        break;
      }
      this.cursor = rows[rows.length - 1].id;
    }
    if (drained) {
      this.cursor = null;
      this.lastCompletedAt = now.getTime();
    }
    if (result.periodsRecorded + result.remindersSent > 0) {
      this.logger.log(
        `Usage periods: ${result.packagesChecked} package(s) checked, ${result.periodsRecorded} period(s) recorded, ` +
          `${result.unitsBurned} unit(s) burned, ${result.packagesDepleted} depleted, ${result.remindersSent} reminder(s)`,
      );
    }
    return result;
  }

  /**
   * Records and burns every ended period of the package's burning tiers, finer tiers first, in one
   * transaction under a row lock (so a booking cannot slip in between the count and the decrement).
   */
  async burnPackage(
    memberPackageId: string,
    studioId: string,
    ctx: UsageStudioContext,
    now: Date,
  ): Promise<{ periodsRecorded: number; unitsBurned: number; depleted: boolean }> {
    return this.prisma.$transaction(async (tx) => {
      await this.usage.lockPackage(tx, studioId, memberPackageId);
      const pkg = await tx.memberPackage.findFirst({
        where: { id: memberPackageId, studioId },
        select: { id: true, studioId: true, entitlementKind: true, startDate: true, endDate: true, usageRule: true, remainingUnits: true, status: true },
      });
      const none = { periodsRecorded: 0, unitsBurned: 0, depleted: false };
      if (!pkg || pkg.status !== 'ACTIVE' || pkg.remainingUnits === null) return none;
      const rule = this.usage.activeRule(ctx, pkg);
      if (!rule) return none;

      const freezes = await this.usage.freezesOf(tx, pkg.id);
      let remaining = pkg.remainingUnits;
      let periodsRecorded = 0;
      let unitsBurned = 0;

      for (const tier of sortTiersFinerFirst(rule.tiers).filter((t) => t.expireUnused)) {
        // Periods that ended while the switch was off are not burned retroactively.
        const since = ctx.enabledSince?.getTime() ?? Number.NEGATIVE_INFINITY;
        const ended = periodsEnded(pkg.startDate, tier, freezes, now, { timeZone: ctx.timeZone, notAfter: pkg.endDate }).filter((p) => p.end.getTime() > since);
        if (ended.length === 0) continue;
        const known = await tx.packageUnitExpiry.findMany({
          where: { memberPackageId: pkg.id, studioId, tierUnit: tier.unit },
          select: { periodStart: true },
        });
        const knownStarts = new Set(known.map((k) => k.periodStart.getTime()));
        for (const period of ended) {
          if (knownStarts.has(period.start.getTime())) continue;
          const [consumed, finerBurned] = await Promise.all([
            this.usage.consumedBetween(tx, pkg, period.start, period.end),
            this.usage.finerBurnedInside(tx, pkg, rule, tier, period),
          ]);
          const units = burnUnits({ quota: tier.quota, consumed, finerBurned, remainingUnits: remaining });
          const created = await tx.packageUnitExpiry.createMany({
            data: [{ studioId, memberPackageId: pkg.id, tierUnit: tier.unit, periodStart: period.start, periodEnd: period.end, units }],
            skipDuplicates: true,
          });
          if (created.count === 0) continue;
          periodsRecorded += 1;
          if (units > 0) {
            remaining -= units;
            unitsBurned += units;
          }
        }
      }

      let depleted = false;
      if (unitsBurned > 0) {
        await tx.memberPackage.updateMany({ where: { id: pkg.id, studioId }, data: { remainingUnits: remaining } });
        if (remaining === 0) {
          await tx.memberPackage.updateMany({ where: { id: pkg.id, studioId, remainingUnits: 0 }, data: { status: 'DEPLETED' } });
          depleted = true;
        }
      }
      return { periodsRecorded, unitsBurned, depleted };
    });
  }

  /**
   * Sends the reminder for each burning tier whose current period ends within `reminderDaysBefore` days
   * while unused quota would burn. IN_APP and PUSH are two sends with their own idempotency key (the engine
   * stops at the first channel that delivers, so one key per channel keeps both); no SMS, transactional.
   */
  async remindPackage(memberPackageId: string, studioId: string, ctx: UsageStudioContext, now: Date): Promise<number> {
    const pkg = await this.prisma.memberPackage.findFirst({
      where: { id: memberPackageId, studioId, status: 'ACTIVE' },
      select: {
        id: true,
        studioId: true,
        memberId: true,
        entitlementKind: true,
        startDate: true,
        endDate: true,
        usageRule: true,
        remainingUnits: true,
        packageDefinition: { select: { name: true } },
        member: { select: { membershipId: true } },
      },
    });
    if (!pkg || pkg.remainingUnits === null) return 0;
    const rule: UsageRule | null = this.usage.activeRule(ctx, pkg);
    if (!rule || rule.reminderDaysBefore <= 0) return 0;

    const freezes = await this.usage.freezesOf(this.prisma, pkg.id);
    const studio = await this.prisma.studio.findUnique({ where: { id: studioId }, select: { defaultLocale: true } });
    let sent = 0;
    for (const tier of sortTiersFinerFirst(rule.tiers).filter((t) => t.expireUnused)) {
      const period = periodAt(pkg.startDate, tier, freezes, now, ctx.timeZone);
      if (!period) continue;
      const msLeft = period.end.getTime() - now.getTime();
      // A period that runs past the package end never burns (the package expires first).
      if (msLeft <= 0 || msLeft > rule.reminderDaysBefore * DAY_MS || period.end.getTime() > pkg.endDate.getTime()) continue;
      const [consumed, finerBurned] = await Promise.all([
        this.usage.consumedBetween(this.prisma, pkg, period.start, period.end),
        this.usage.finerBurnedInside(this.prisma, pkg, rule, tier, period),
      ]);
      const units = burnUnits({ quota: tier.quota, consumed, finerBurned, remainingUnits: pkg.remainingUnits });
      if (units <= 0) continue;

      const baseKey = `usage-reminder:${pkg.id}:${tier.unit}:${period.start.toISOString()}`;
      const periodEnd = formatDate(period.end, studio?.defaultLocale ?? 'tr', ctx.timeZone);
      let delivered = false;
      for (const channel of ['IN_APP', 'PUSH'] as const) {
        try {
          const outcome = await this.messaging.send({
            studioId,
            recipient: { membershipId: pkg.member.membershipId },
            channel,
            purpose: 'TRANSACTIONAL',
            category: 'PACKAGE',
            templateKey: USAGE_PERIOD_REMINDER_TEMPLATE_KEY,
            variables: { packageName: pkg.packageDefinition.name, units, periodEnd },
            pushData: { type: 'USAGE_PERIOD_EXPIRY', memberPackageId: pkg.id },
            idempotencyKey: `${baseKey}:${channel}`,
          });
          if (outcome.success && !outcome.duplicate) delivered = true;
        } catch (err) {
          this.logger.warn(`Usage reminder ${baseKey} (${channel}) failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      if (delivered) sent += 1;
    }
    return sent;
  }
}

function formatDate(date: Date, locale: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}
