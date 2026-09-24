import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DashboardMetricsDTO } from '@platform/shared';

@Injectable()
export class StudiosService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    return this.prisma.studio.findMany({
      where: { isActive: true },
      include: {
        branches: {
          include: {
            rooms: true,
          },
        },
      },
    });
  }

  async findBySlug(slug: string) {
    const studio = await this.prisma.studio.findUnique({
      where: { slug },
      include: {
        branches: {
          include: {
            rooms: true,
          },
        },
        packageDefinitions: {
          where: { isActive: true },
        },
      },
    });

    if (!studio) {
      throw new NotFoundException(`'${slug}' stüdyosu bulunamadı`);
    }

    return studio;
  }

  async getDashboardMetrics(studioId: string): Promise<DashboardMetricsDTO> {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    const startOfMonth = new Date(startOfToday.getFullYear(), startOfToday.getMonth(), 1);

    // 1. Today's sessions & bookings
    const todaySchedules = await this.prisma.sessionSchedule.findMany({
      where: {
        studioId,
        startTime: { gte: startOfToday, lte: endOfToday },
        isCancelled: false,
      },
      include: {
        bookings: {
          where: { status: { in: ['CONFIRMED', 'ATTENDED'] } },
        },
      },
    });

    const todaySessionsCount = todaySchedules.length;
    const todayAttendeesCount = todaySchedules.reduce((acc, s) => acc + s.bookings.length, 0);

    // 2. Active members
    const activeMembersCount = await this.prisma.memberProfile.count({
      where: {
        studioId,
        user: { isActive: true },
      },
    });

    // 3. Expiring packages (within next 7 days or <= 2 sessions left)
    const sevenDaysLater = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const expiringPackagesCount = await this.prisma.memberPackage.count({
      where: {
        studioId,
        status: 'ACTIVE',
        OR: [
          { remainingSessions: { lte: 2 } },
          { endDate: { lte: sevenDaysLater } },
        ],
      },
    });

    // 4. Monthly revenue from payments
    const payments = await this.prisma.payment.findMany({
      where: {
        studioId,
        paymentStatus: 'COMPLETED',
        paidAt: { gte: startOfMonth },
      },
      select: { amount: true },
    });

    const monthlyRevenue = payments.reduce((sum, p) => sum + Number(p.amount), 0);

    // 5. Reformer occupancy rate (today's capacity vs booked)
    const totalCapacity = todaySchedules.reduce((acc, s) => acc + s.capacity, 0);
    const reformerOccupancyRate = totalCapacity > 0 ? (todayAttendeesCount / totalCapacity) * 100 : 0;

    return {
      todaySessionsCount,
      todayAttendeesCount,
      activeMembersCount,
      expiringPackagesCount,
      monthlyRevenue,
      reformerOccupancyRate: Math.round(reformerOccupancyRate * 10) / 10,
    };
  }
}
