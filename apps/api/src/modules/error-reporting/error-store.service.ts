import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { Prisma } from '@platform/database';
import type { ErrorGroup } from '@platform/database';
import {
  ERROR_LIMITS,
  errorCodeFromId,
  errorFingerprint,
  errorGroupTitle,
  isCriticalRoute,
  topInAppFrame,
  truncate,
} from '@platform/shared';
import type { ErrorEventRecord } from '@platform/shared';
import { PrismaService } from '../prisma/prisma.service';

export interface RecordedError {
  group: ErrorGroup;
  eventId: string;
  code: string;
  isNew: boolean;
  /** A RESOLVED group seen again in another release (it is OPEN again now). */
  regression: boolean;
  /** This occurrence is on a critical flow (login, auth, payments, billing). */
  critical: boolean;
  route: string | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}
function isForeignKeyViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003';
}

export function fingerprintHash(fingerprint: string): string {
  return createHash('sha256').update(fingerprint).digest('hex');
}

/**
 * Storage of scrubbed events (the storage sink's backend): grouping by
 * fingerprint, per-tenant counters, approximate affected users, automatic
 * regression reopen, the per-group event cap and the retention purge.
 */
@Injectable()
export class ErrorStoreService {
  constructor(private readonly prisma: PrismaService) {}

  /** Stores one event. Null when the event id was already stored (a retried batch). */
  async record(event: ErrorEventRecord): Promise<RecordedError | null> {
    const fingerprint = truncate(errorFingerprint(event), 1000);
    const hash = fingerprintHash(fingerprint);
    const code = errorCodeFromId(event.eventId);
    const critical = isCriticalRoute(event.route);

    let isNew = false;
    let group = await this.prisma.errorGroup.findUnique({ where: { fingerprintHash: hash } });
    if (!group) {
      try {
        group = await this.prisma.errorGroup.create({
          data: {
            fingerprintHash: hash,
            fingerprint,
            source: event.source,
            type: truncate(event.type, ERROR_LIMITS.typeLength),
            title: errorGroupTitle(event.type, event.message),
            topFrame: topInAppFrame(event.stack),
            firstSeenAt: event.occurredAt,
            lastSeenAt: event.occurredAt,
            lastRelease: event.release,
            critical,
          },
        });
        isNew = true;
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        group = await this.prisma.errorGroup.findUniqueOrThrow({ where: { fingerprintHash: hash } });
      }
    }

    try {
      await this.prisma.errorEvent.create({
        data: {
          id: event.eventId,
          groupId: group.id,
          code,
          source: event.source,
          severity: event.severity,
          release: event.release,
          environment: event.environment,
          route: event.route,
          requestId: event.requestId,
          studioId: event.studioId,
          userIdHash: event.userIdHash,
          type: truncate(event.type, ERROR_LIMITS.typeLength),
          message: event.message,
          stack: event.stack,
          breadcrumbs: event.breadcrumbs.length > 0 ? (event.breadcrumbs as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
          statusCode: event.statusCode,
          occurredAt: event.occurredAt,
        },
      });
    } catch (err) {
      if (isUniqueViolation(err)) return null;
      throw err;
    }

    const newUser = event.userIdHash
      ? (await this.prisma.errorEvent.count({ where: { groupId: group.id, userIdHash: event.userIdHash, id: { not: event.eventId } } })) === 0
      : false;
    const newStudio = event.studioId ? await this.bumpStudio(group.id, event.studioId, event.occurredAt, code) : false;

    const updated = await this.prisma.errorGroup.update({
      where: { id: group.id },
      data: {
        count: { increment: 1 },
        lastRelease: event.release,
        lastCode: code,
        ...(event.occurredAt > group.lastSeenAt ? { lastSeenAt: event.occurredAt } : {}),
        ...(critical && !group.critical ? { critical: true } : {}),
        ...(newStudio ? { affectedStudioCount: { increment: 1 } } : {}),
        ...(newUser ? { affectedUserCount: { increment: 1 } } : {}),
      },
    });

    let regression = false;
    if (!isNew && updated.status === 'RESOLVED') {
      const reopened = await this.prisma.errorGroup.updateMany({
        where: {
          id: group.id,
          status: 'RESOLVED',
          OR: [{ resolvedInRelease: null }, { resolvedInRelease: { not: event.release } }],
        },
        data: { status: 'OPEN' },
      });
      regression = reopened.count === 1;
      if (regression) {
        await this.prisma.auditLog.create({
          data: {
            studioId: null,
            userId: null,
            action: 'error_group.regressed',
            entityType: 'ErrorGroup',
            entityId: group.id,
            metadata: { release: event.release, resolvedInRelease: updated.resolvedInRelease },
          },
        });
      }
    }

    if (updated.count > ERROR_LIMITS.eventsPerGroup) await this.trim(group.id);

    const fresh = regression ? await this.prisma.errorGroup.findUniqueOrThrow({ where: { id: group.id } }) : updated;
    return { group: fresh, eventId: event.eventId, code, isNew, regression, critical, route: event.route };
  }

  /** Deletes events older than the retention window. Groups and their counters stay. */
  async purgeExpired(now: Date): Promise<number> {
    const cutoff = new Date(now.getTime() - ERROR_LIMITS.retentionDays * DAY_MS);
    const result = await this.prisma.errorEvent.deleteMany({ where: { occurredAt: { lt: cutoff } } });
    return result.count;
  }

  /** True when this is the studio's first occurrence of the group. */
  private async bumpStudio(groupId: string, studioId: string, at: Date, code: string): Promise<boolean> {
    try {
      await this.prisma.errorGroupStudio.create({ data: { groupId, studioId, count: 1, firstSeenAt: at, lastSeenAt: at, lastCode: code } });
      return true;
    } catch (err) {
      // A deleted studio: the event is stored, there is no tenant row to keep.
      if (isForeignKeyViolation(err)) return false;
      if (!isUniqueViolation(err)) throw err;
    }
    await this.prisma.errorGroupStudio.update({
      where: { groupId_studioId: { groupId, studioId } },
      data: { count: { increment: 1 }, lastSeenAt: at, lastCode: code },
    });
    return false;
  }

  /** Keeps the newest events of a group (ERROR_LIMITS.eventsPerGroup). */
  private async trim(groupId: string): Promise<void> {
    const stale = await this.prisma.errorEvent.findMany({
      where: { groupId },
      orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
      skip: ERROR_LIMITS.eventsPerGroup,
      take: 200,
      select: { id: true },
    });
    if (stale.length > 0) await this.prisma.errorEvent.deleteMany({ where: { id: { in: stale.map((s) => s.id) } } });
  }
}
