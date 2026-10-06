import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@platform/database';
import type { ErrorAlert, ErrorAlertDelivery, ErrorGroup } from '@platform/database';
import type {
  ErrorAlertDTO,
  ErrorAlertDeliveryStatus,
  ErrorAlertListDTO,
  ErrorAlertListQuery,
  ErrorAlertRecordKind,
  ErrorAlertSink,
} from '@platform/shared';
import { PrismaService } from '../prisma/prisma.service';
import { apiError } from '../../common/api-error';

const PAGE_SIZE = 25;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface NewAlert {
  groupId: string;
  kind: ErrorAlertRecordKind;
  windowStart: Date;
  windowEnd: Date;
  windowCount: number;
  baselineTotal?: number;
  baselineMean?: number;
  threshold?: number;
}

type AlertWithRelations = ErrorAlert & { group: Pick<ErrorGroup, 'title'>; deliveries: ErrorAlertDelivery[] };

function toDto(a: AlertWithRelations): ErrorAlertDTO {
  return {
    id: a.id,
    groupId: a.groupId,
    groupTitle: a.group.title,
    kind: a.kind as ErrorAlertRecordKind,
    windowStart: a.windowStart.toISOString(),
    windowEnd: a.windowEnd.toISOString(),
    windowCount: a.windowCount,
    baselineMean: a.baselineMean,
    threshold: a.threshold,
    notifiedAt: a.notifiedAt ? a.notifiedAt.toISOString() : null,
    acknowledgedAt: a.acknowledgedAt ? a.acknowledgedAt.toISOString() : null,
    createdAt: a.createdAt.toISOString(),
    deliveries: a.deliveries.map((d) => ({ sink: d.sink as ErrorAlertSink, status: d.status as ErrorAlertDeliveryStatus, attempt: d.attempt })),
  };
}

/** Stored alerts (error_alerts): creation, the super admin list and acknowledgement. */
@Injectable()
export class ErrorAlertRecordsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Creates the alert; null when the same group, kind and window already has one (a parallel writer won). */
  async create(input: NewAlert): Promise<ErrorAlert | null> {
    try {
      return await this.prisma.errorAlert.create({
        data: {
          groupId: input.groupId,
          kind: input.kind,
          windowStart: input.windowStart,
          windowEnd: input.windowEnd,
          windowCount: input.windowCount,
          baselineTotal: input.baselineTotal ?? 0,
          baselineMean: input.baselineMean ?? 0,
          threshold: input.threshold ?? 0,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return null;
      throw err;
    }
  }

  /** Window start of the group's latest alert of this kind: the cooldown is measured on the event timeline, not the wall clock. */
  async lastWindowStart(groupId: string, kind: ErrorAlertRecordKind): Promise<Date | null> {
    const last = await this.prisma.errorAlert.findFirst({ where: { groupId, kind }, orderBy: { windowStart: 'desc' }, select: { windowStart: true } });
    return last ? last.windowStart : null;
  }

  async markNotified(id: string, at: Date): Promise<void> {
    await this.prisma.errorAlert.update({ where: { id }, data: { notifiedAt: at } });
  }

  async list(query: ErrorAlertListQuery): Promise<ErrorAlertListDTO> {
    const where: Prisma.ErrorAlertWhereInput = {
      ...(query.kind ? { kind: query.kind } : {}),
      ...(query.groupId ? { groupId: query.groupId } : {}),
      ...(query.acknowledged === 'true' ? { acknowledgedAt: { not: null } } : query.acknowledged === 'false' ? { acknowledgedAt: null } : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.errorAlert.count({ where }),
      this.prisma.errorAlert.findMany({
        where,
        include: { group: { select: { title: true } }, deliveries: { orderBy: { createdAt: 'asc' } } },
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
    ]);
    return { items: rows.map(toDto), total, page: query.page, pageSize: PAGE_SIZE };
  }

  /** Marks the alert as seen by a super admin. Acknowledging twice keeps the first acknowledgement. */
  async acknowledge(id: string, userId: string, now = new Date()): Promise<ErrorAlertDTO> {
    if (!UUID.test(id)) throw new NotFoundException(apiError('apiErrors.errorReporting.alertNotFound'));
    const existing = await this.prisma.errorAlert.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw new NotFoundException(apiError('apiErrors.errorReporting.alertNotFound'));
    await this.prisma.errorAlert.updateMany({ where: { id, acknowledgedAt: null }, data: { acknowledgedAt: now, acknowledgedByUserId: userId } });
    await this.prisma.auditLog.create({
      data: { studioId: null, userId, action: 'error_alert.acknowledge', entityType: 'ErrorAlert', entityId: id },
    });
    const row = await this.prisma.errorAlert.findUniqueOrThrow({
      where: { id },
      include: { group: { select: { title: true } }, deliveries: { orderBy: { createdAt: 'asc' } } },
    });
    return toDto(row);
  }
}
