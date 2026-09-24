import { Injectable } from '@nestjs/common';
import { BENCHMARK_MIN_GROUP_SIZE } from '@platform/shared';
import type { BenchmarkBucket } from '@platform/shared';
import { PrismaService } from '../prisma/prisma.service';

const WINDOW_DAYS = 30;

/**
 * Anonymized, aggregated cross-tenant benchmarks grouped by business type
 * (CLAUDE.md: "benchmark dashboard'u (anonimlestirilmis dolu-luk, iptal
 * orani, uye basina gelir, yenileme orani)"). No studio name or id, no
 * member-level data ever leaves this service; every number is an average
 * over a bucket. A bucket with fewer than BENCHMARK_MIN_GROUP_SIZE studios
 * is suppressed entirely (k-anonymity) so a single tenant's figures can
 * never be inferred.
 */
@Injectable()
export class AdminBenchmarkService {
  constructor(private readonly prisma: PrismaService) {}

  async compute(businessTypeTemplateKey?: string): Promise<BenchmarkBucket[]> {
    const templates = await this.prisma.businessTypeTemplate.findMany({
      where: businessTypeTemplateKey ? { key: businessTypeTemplateKey } : {},
      include: { studios: { where: { isActive: true }, select: { id: true } } },
    });

    const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const buckets: BenchmarkBucket[] = [];

    for (const template of templates) {
      const studioIds = template.studios.map((s) => s.id);
      const studioCount = studioIds.length;

      if (studioCount < BENCHMARK_MIN_GROUP_SIZE) {
        buckets.push({
          businessTypeTemplateKey: template.key,
          businessTypeTemplateName: template.name,
          studioCount,
          suppressed: true,
          avgOccupancyRate: null,
          avgCancellationRate: null,
          avgRevenuePerMember: null,
          avgRenewalRate: null,
        });
        continue;
      }

      const perStudio = await Promise.all(studioIds.map((studioId) => this.studioMetrics(studioId, since)));
      buckets.push({
        businessTypeTemplateKey: template.key,
        businessTypeTemplateName: template.name,
        studioCount,
        suppressed: false,
        avgOccupancyRate: average(perStudio.map((m) => m.occupancyRate)),
        avgCancellationRate: average(perStudio.map((m) => m.cancellationRate)),
        avgRevenuePerMember: average(perStudio.map((m) => m.revenuePerMember)),
        avgRenewalRate: average(perStudio.map((m) => m.renewalRate)),
      });
    }

    return buckets;
  }

  private async studioMetrics(studioId: string, since: Date) {
    const [scheduleAgg, bookingTotal, bookingCancelled, revenue, activeMemberCount, subsActive, subsCancelled] =
      await Promise.all([
        this.prisma.sessionSchedule.aggregate({
          where: { studioId, isCancelled: false, startTime: { gte: since } },
          _sum: { capacity: true, bookedCount: true },
        }),
        this.prisma.booking.count({ where: { studioId, createdAt: { gte: since } } }),
        this.prisma.booking.count({
          where: { studioId, createdAt: { gte: since }, status: { in: ['CANCELLED_EARLY', 'CANCELLED_LATE'] } },
        }),
        this.prisma.payment.aggregate({
          where: { studioId, paymentStatus: 'COMPLETED', paidAt: { gte: since } },
          _sum: { amount: true },
        }),
        this.prisma.membership.count({ where: { studioId, status: 'ACTIVE', memberProfile: { isNot: null } } }),
        this.prisma.memberSubscription.count({ where: { studioId, status: 'ACTIVE' } }),
        this.prisma.memberSubscription.count({ where: { studioId, status: 'CANCELLED' } }),
      ]);

    const capacity = scheduleAgg._sum.capacity ?? 0;
    const booked = scheduleAgg._sum.bookedCount ?? 0;
    const occupancyRate = capacity > 0 ? Math.min(1, booked / capacity) : 0;
    const cancellationRate = bookingTotal > 0 ? bookingCancelled / bookingTotal : 0;
    const revenuePerMember = activeMemberCount > 0 ? Number(revenue._sum?.amount ?? 0) / activeMemberCount : 0;
    const renewalDenominator = subsActive + subsCancelled;
    const renewalRate = renewalDenominator > 0 ? subsActive / renewalDenominator : 0;

    return { occupancyRate, cancellationRate, revenuePerMember, renewalRate };
  }
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10000) / 10000;
}
