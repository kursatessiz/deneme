import { Injectable } from '@nestjs/common';
import { BookingStatus } from '@platform/database';
import { parsePartnerConnectionConfig, type PartnerVisitsReportRow } from '@platform/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { TenantContext } from '../auth/tenant-context';
import { computeExpectedPayout } from './partner-quota';

/** month key formatted YYYY-MM in the studio's own timezone-naive UTC date parts (matches other reports' convention). */
function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

@Injectable()
export class PartnerReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async visits(tenant: TenantContext, from?: Date, to?: Date): Promise<PartnerVisitsReportRow[]> {
    const connections = await this.prisma.partnerConnection.findMany({ where: { studioId: tenant.studioId } });
    if (connections.length === 0) return [];

    const bookings = await this.prisma.booking.findMany({
      where: {
        studioId: tenant.studioId,
        partnerConnectionId: { in: connections.map((c) => c.id) },
        status: { in: [BookingStatus.ATTENDED, BookingStatus.NO_SHOW, BookingStatus.CONFIRMED] },
        ...(from || to
          ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
          : {}),
      },
      select: { partnerConnectionId: true, status: true, createdAt: true },
    });

    type Bucket = { visits: number; noShows: number; payoutRate: string };
    const buckets = new Map<string, Bucket>();
    const connectionById = new Map(connections.map((c) => [c.id, c]));

    for (const booking of bookings) {
      const connectionId = booking.partnerConnectionId;
      if (!connectionId) continue;
      const connection = connectionById.get(connectionId);
      if (!connection) continue;
      const key = `${connectionId}|${monthKey(booking.createdAt)}`;
      const config = parsePartnerConnectionConfig(connection.config);
      const bucket = buckets.get(key) ?? {
        visits: 0,
        noShows: 0,
        payoutRate: config.payoutRatePerVisit,
      };
      if (booking.status === BookingStatus.ATTENDED) bucket.visits += 1;
      if (booking.status === BookingStatus.NO_SHOW) bucket.noShows += 1;
      buckets.set(key, bucket);
    }

    const rows: PartnerVisitsReportRow[] = [];
    for (const [key, bucket] of buckets) {
      const [connectionId, month] = key.split('|');
      const connection = connectionById.get(connectionId);
      if (!connection) continue;
      const expectedPayout = computeExpectedPayout(bucket.payoutRate, bucket.visits);
      rows.push({
        provider: connection.provider,
        connectionLabel: connection.label,
        month,
        visits: bucket.visits,
        noShows: bucket.noShows,
        expectedPayout,
      });
    }
    return rows.sort((a, b) => (a.month === b.month ? a.connectionLabel.localeCompare(b.connectionLabel) : a.month.localeCompare(b.month)));
  }
}
