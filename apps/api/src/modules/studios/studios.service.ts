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
          include: { resources: true },
        },
      },
    });
  }

  async findBySlug(slug: string) {
    const studio = await this.prisma.studio.findFirst({
      where: { slug, isActive: true },
      select: {
        id: true,
        name: true,
        slug: true,
        logoUrl: true,
        themeFamily: true,
        themePrimary: true,
        gradientPresetKey: true,
        address: true,
        phone: true,
        timezone: true,
        embedAllowedOrigins: true,
      },
    });

    if (!studio) {
      throw new NotFoundException(`'${slug}' stüdyosu bulunamadı`);
    }

    return studio;
  }

  async updateEmbedSettings(studioId: string, userId: string, embedAllowedOrigins: string[]) {
    const studio = await this.prisma.studio.update({
      where: { id: studioId },
      data: { embedAllowedOrigins },
      select: { id: true, embedAllowedOrigins: true },
    });
    await this.prisma.auditLog.create({
      data: {
        studioId,
        userId,
        action: 'studio.embed_settings.update',
        entityType: 'Studio',
        entityId: studioId,
        metadata: { embedAllowedOrigins },
      },
    });
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
        membership: { status: 'ACTIVE' },
      },
    });

    // 3. Expiring packages (within next 7 days or <= 2 units left)
    const sevenDaysLater = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const expiringPackagesCount = await this.prisma.memberPackage.count({
      where: {
        studioId,
        status: 'ACTIVE',
        OR: [{ remainingUnits: { lte: 2 } }, { endDate: { lte: sevenDaysLater } }],
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

    // 5. Occupancy rate (today's booked seats vs capacity)
    const totalCapacity = todaySchedules.reduce((acc, s) => acc + s.capacity, 0);
    const occupancyRate = totalCapacity > 0 ? (todayAttendeesCount / totalCapacity) * 100 : 0;

    return {
      todaySessionsCount,
      todayAttendeesCount,
      activeMembersCount,
      expiringPackagesCount,
      monthlyRevenue,
      occupancyRate: Math.round(occupancyRate * 10) / 10,
    };
  }
}
