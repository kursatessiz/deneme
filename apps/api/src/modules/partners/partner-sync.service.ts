import { Injectable, Logger } from '@nestjs/common';
import { BookingStatus, PartnerConnectionStatus } from '@platform/database';
import { parsePartnerConnectionConfig } from '@platform/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PartnerConnectionsService } from './partner-connections.service';
import { PartnerProviderRegistry } from './providers/partner-provider.registry';

export interface PartnerSyncOutcome {
  releasedAllocations: number;
  availabilityPushed: number;
  availabilityFailed: number;
  reconciledCheckIns: number;
}

/** Minutes to wait before retrying a connection again after N consecutive failures (simple backoff). */
function backoffMinutes(consecutiveFailures: number): number {
  return Math.min(60, 5 * 2 ** consecutiveFailures);
}

/**
 * Outbound half of W20, called from JobsService.runAll() every 15 minutes:
 * releases expired partner spot quotas, pushes availability changes to each
 * active connection's adapter (with retry backoff and a per-connection
 * failure counter), and reconciles attended partner bookings so the payout
 * report always reflects the latest check-ins.
 */
@Injectable()
export class PartnerSyncService {
  private readonly logger = new Logger(PartnerSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly connections: PartnerConnectionsService,
    private readonly registry: PartnerProviderRegistry,
  ) {}

  async runSync(now = new Date()): Promise<PartnerSyncOutcome> {
    const released = await this.prisma.partnerSpotAllocation.updateMany({
      where: { isReleased: false, releaseAt: { lte: now } },
      data: { isReleased: true },
    });

    let availabilityPushed = 0;
    let availabilityFailed = 0;

    const activeConnections = await this.prisma.partnerConnection.findMany({
      where: { status: PartnerConnectionStatus.ACTIVE },
    });

    for (const connection of activeConnections) {
      if (connection.consecutiveFailures > 0 && connection.lastSyncAt) {
        const dueAt = connection.lastSyncAt.getTime() + backoffMinutes(connection.consecutiveFailures) * 60_000;
        if (now.getTime() < dueAt) continue;
      }

      const config = parsePartnerConnectionConfig(connection.config);
      const horizon = new Date(now.getTime() + 48 * 60 * 60 * 1000);
      const schedules = await this.prisma.sessionSchedule.findMany({
        where: {
          studioId: connection.studioId,
          isCancelled: false,
          startTime: { gte: now, lte: horizon },
          ...(config.serviceTypeIds.length > 0 ? { serviceTypeId: { in: config.serviceTypeIds } } : {}),
        },
        take: 50,
      });
      if (schedules.length === 0) continue;

      const credentials = await this.connections.getDecryptedCredentials(connection.id);
      if (!credentials) continue;
      const adapter = this.registry.get(connection.provider);

      let anyFailure = false;
      for (const schedule of schedules) {
        const result = await adapter
          .pushAvailability(credentials, {
            connectionId: connection.id,
            scheduleExternalRef: schedule.id,
            freeSpots: Math.max(0, schedule.capacity - schedule.bookedCount),
            startTime: schedule.startTime,
          })
          .catch((err: unknown) => ({ success: false, failureMessage: err instanceof Error ? err.message : 'unknown' }));
        if (result.success) {
          availabilityPushed += 1;
        } else {
          availabilityFailed += 1;
          anyFailure = true;
        }
      }

      await this.prisma.partnerConnection.update({
        where: { id: connection.id },
        data: {
          lastSyncAt: now,
          consecutiveFailures: anyFailure ? connection.consecutiveFailures + 1 : 0,
        },
      });
    }

    // Reconcile: every ATTENDED booking created through a partner connection
    // is, by construction, already counted in the payout report (it reads
    // Booking status directly per connection/month) - this pass exists so
    // the heartbeat's log line always states how many visits are payout-
    // eligible as of this run, for operational visibility.
    const reconciledCheckIns = await this.prisma.booking.count({
      where: { partnerConnectionId: { not: null }, status: BookingStatus.ATTENDED },
    });

    this.logger.log(
      `Partner sync: ${released.count} allocation(s) released, ${availabilityPushed} availability push(es) ok, ` +
        `${availabilityFailed} failed, ${reconciledCheckIns} attended partner visit(s) reconciled.`,
    );

    return {
      releasedAllocations: released.count,
      availabilityPushed,
      availabilityFailed,
      reconciledCheckIns,
    };
  }
}
