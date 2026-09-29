import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { ErrorGroup, Prisma } from '@platform/database';
import { ERROR_LIMITS } from '@platform/shared';
import type { ErrorGroupSummaryDTO } from '@platform/shared';
import { PrismaService } from '../prisma/prisma.service';
import { toSummary } from './error-query.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Group merging (H3): a super admin folds one error group into another when
 * the fingerprint split one bug into several groups. Events, alerts,
 * spike buckets and tenant counters move to the target; the source stays as
 * a marker (`mergedIntoId`) and its fingerprint becomes an alias of the
 * target, so future events with that fingerprint land in the target. Aliases
 * always point at a live group: the source's own aliases move along.
 */
@Injectable()
export class ErrorMergeService {
  constructor(private readonly prisma: PrismaService) {}

  async merge(sourceId: string, targetId: string, userId: string): Promise<ErrorGroupSummaryDTO> {
    if (!UUID.test(sourceId) || !UUID.test(targetId)) throw new NotFoundException('Hata grubu bulunamadı');
    if (sourceId === targetId) throw new ConflictException('Bir grup kendisiyle birleştirilemez');

    const target = await this.prisma.$transaction(
      async (tx) => {
        const source = await tx.errorGroup.findUnique({ where: { id: sourceId } });
        const dest = await tx.errorGroup.findUnique({ where: { id: targetId } });
        if (!source || !dest) throw new NotFoundException('Hata grubu bulunamadı');
        if (source.mergedIntoId) throw new ConflictException('Bu grup zaten başka bir gruba birleştirilmiş');
        if (dest.mergedIntoId) throw new ConflictException('Hedef grup zaten başka bir gruba birleştirilmiş');

        await tx.errorGroup.update({ where: { id: source.id }, data: { mergedIntoId: dest.id } });

        // Aliases: the source's own move to the target, and the source fingerprint becomes one.
        await tx.errorGroupAlias.updateMany({ where: { groupId: source.id }, data: { groupId: dest.id } });
        await tx.errorGroupAlias.upsert({
          where: { fingerprintHash: source.fingerprintHash },
          create: { fingerprintHash: source.fingerprintHash, groupId: dest.id },
          update: { groupId: dest.id },
        });

        const moved = await tx.errorEvent.updateMany({ where: { groupId: source.id }, data: { groupId: dest.id } });
        // Alerts are unique per group, kind and window: a duplicate on the target side is dropped.
        const alerts = await tx.errorAlert.findMany({ where: { groupId: source.id }, select: { id: true, kind: true, windowStart: true } });
        for (const alert of alerts) {
          const duplicate = await tx.errorAlert.findFirst({ where: { groupId: dest.id, kind: alert.kind, windowStart: alert.windowStart }, select: { id: true } });
          if (duplicate) await tx.errorAlert.delete({ where: { id: alert.id } });
          else await tx.errorAlert.update({ where: { id: alert.id }, data: { groupId: dest.id } });
        }

        // Spike buckets add up per 15-minute slot.
        const buckets = await tx.errorGroupBucket.findMany({ where: { groupId: source.id } });
        for (const bucket of buckets) {
          await tx.errorGroupBucket.upsert({
            where: { groupId_bucketStart: { groupId: dest.id, bucketStart: bucket.bucketStart } },
            create: { groupId: dest.id, bucketStart: bucket.bucketStart, count: bucket.count },
            update: { count: { increment: bucket.count } },
          });
        }
        await tx.errorGroupBucket.deleteMany({ where: { groupId: source.id } });

        // Per-tenant counters.
        const studios = await tx.errorGroupStudio.findMany({ where: { groupId: source.id } });
        for (const row of studios) {
          const existing = await tx.errorGroupStudio.findUnique({ where: { groupId_studioId: { groupId: dest.id, studioId: row.studioId } } });
          if (existing) {
            await tx.errorGroupStudio.update({
              where: { groupId_studioId: { groupId: dest.id, studioId: row.studioId } },
              data: {
                count: existing.count + row.count,
                firstSeenAt: row.firstSeenAt < existing.firstSeenAt ? row.firstSeenAt : existing.firstSeenAt,
                ...(row.lastSeenAt > existing.lastSeenAt ? { lastSeenAt: row.lastSeenAt, lastCode: row.lastCode } : {}),
                ...(row.ownerNotifiedAt && (!existing.ownerNotifiedAt || row.ownerNotifiedAt > existing.ownerNotifiedAt) ? { ownerNotifiedAt: row.ownerNotifiedAt } : {}),
              },
            });
          } else {
            await tx.errorGroupStudio.create({
              data: {
                groupId: dest.id,
                studioId: row.studioId,
                count: row.count,
                firstSeenAt: row.firstSeenAt,
                lastSeenAt: row.lastSeenAt,
                lastCode: row.lastCode,
                ownerNotifiedAt: row.ownerNotifiedAt,
              },
            });
          }
        }
        await tx.errorGroupStudio.deleteMany({ where: { groupId: source.id } });
        const studioCount = await tx.errorGroupStudio.count({ where: { groupId: dest.id } });

        const sourceIsNewer = source.lastSeenAt > dest.lastSeenAt;
        const data: Prisma.ErrorGroupUpdateInput = {
          count: { increment: source.count },
          affectedStudioCount: studioCount,
          // Approximate, like the counter itself: the same user may be on both sides.
          affectedUserCount: { increment: source.affectedUserCount },
          ...(source.firstSeenAt < dest.firstSeenAt ? { firstSeenAt: source.firstSeenAt } : {}),
          ...(sourceIsNewer ? { lastSeenAt: source.lastSeenAt, lastRelease: source.lastRelease, lastCode: source.lastCode } : {}),
          ...(source.critical && !dest.critical ? { critical: true } : {}),
          // Open errors folded into a resolved group must not hide behind its resolved state.
          ...(source.status === 'OPEN' && dest.status === 'RESOLVED' ? { status: 'OPEN', resolvedInRelease: null, resolvedAt: null } : {}),
        };
        const updated = await tx.errorGroup.update({ where: { id: dest.id }, data });

        await tx.auditLog.create({
          data: {
            studioId: null,
            userId,
            action: 'error_group.merge',
            entityType: 'ErrorGroup',
            entityId: source.id,
            metadata: { targetId: dest.id, events: moved.count, fingerprintAliased: true },
          },
        });
        return updated;
      },
      { timeout: 30_000 },
    );

    await this.trim(target);
    return toSummary(target);
  }

  /** The target may now hold more than the per-group event cap. */
  private async trim(group: ErrorGroup): Promise<void> {
    const stale = await this.prisma.errorEvent.findMany({
      where: { groupId: group.id },
      orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
      skip: ERROR_LIMITS.eventsPerGroup,
      take: 1000,
      select: { id: true },
    });
    if (stale.length > 0) await this.prisma.errorEvent.deleteMany({ where: { id: { in: stale.map((s) => s.id) } } });
  }
}
