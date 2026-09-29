import { Controller, Get } from '@nestjs/common';
import { Prisma } from '@platform/database';
import { AuditLogQuerySchema, contactDisplayName, summarizeAuditMetadata } from '@platform/shared';
import type { AuditLogListDTO, AuditLogQuery } from '@platform/shared';
import { SuperAdminOnly } from '../auth/decorators/super-admin-only.decorator';
import { ZodQuery } from '../../common/zod-body.pipe';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Super admin audit view (M3d, docs/PAZARLAMA_MODULU.md 6.3): AuditLog rows
 * across every tenant with filters (user, action, period) and pages, newest
 * first. The metadata is reduced to a short redacted summary; the raw JSON
 * never leaves the API.
 */
@Controller('admin/audit')
@SuperAdminOnly()
export class AdminAuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(@ZodQuery(AuditLogQuerySchema) query: AuditLogQuery): Promise<AuditLogListDTO> {
    const createdAt: Prisma.DateTimeFilter = {
      ...(query.from ? { gte: new Date(query.from) } : {}),
      ...(query.to ? { lte: new Date(query.to) } : {}),
    };
    const where: Prisma.AuditLogWhereInput = {
      ...(query.userId ? { userId: query.userId } : {}),
      ...(query.action ? { OR: [{ action: query.action }, { action: { startsWith: `${query.action}.` } }] } : {}),
      ...(Object.keys(createdAt).length > 0 ? { createdAt } : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        include: { user: { select: { firstName: true, lastName: true } } },
      }),
    ]);
    return {
      total,
      page: query.page,
      limit: query.limit,
      items: rows.map((row) => ({
        id: row.id,
        userId: row.userId,
        userName: row.user ? contactDisplayName(row.user) : null,
        studioId: row.studioId,
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId,
        metadataSummary: summarizeAuditMetadata(row.metadata),
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }
}
