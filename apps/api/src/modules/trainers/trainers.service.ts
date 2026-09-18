import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TrainersService {
  constructor(private prisma: PrismaService) {}

  async findAll(studioId: string) {
    return this.prisma.trainerProfile.findMany({
      where: { studioId },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
            avatarUrl: true,
            isActive: true,
          },
        },
      },
    });
  }

  async calculateCommissionReport(studioId: string, trainerId: string, month: number, year: number) {
    const trainer = await this.prisma.trainerProfile.findFirst({
      where: { id: trainerId, studioId },
      include: { user: true },
    });

    if (!trainer) {
      throw new NotFoundException('Eğitmen bulunamadı');
    }

    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59, 999);

    // Get completed schedules with attended members
    const schedules = await this.prisma.sessionSchedule.findMany({
      where: {
        studioId,
        trainerId,
        startTime: { gte: startDate, lte: endDate },
        isCancelled: false,
        bookings: {
          some: { status: 'ATTENDED' },
        },
      },
      include: {
        bookings: {
          where: { status: 'ATTENDED' },
        },
      },
    });

    const totalSessionsTaught = schedules.length;
    let totalEarned = 0;

    if (trainer.commissionType === 'PER_SESSION_FIXED') {
      totalEarned = totalSessionsTaught * Number(trainer.commissionValue);
    } else if (trainer.commissionType === 'PERCENTAGE') {
      // Approximate 1200 TL per standard private session if not individually priced
      totalEarned = totalSessionsTaught * 1200 * (Number(trainer.commissionValue) / 100);
    } else {
      totalEarned = Number(trainer.commissionValue);
    }

    return {
      trainer: {
        id: trainer.id,
        fullName: `${trainer.user.firstName} ${trainer.user.lastName}`,
        commissionType: trainer.commissionType,
        commissionValue: Number(trainer.commissionValue),
      },
      period: `${month}/${year}`,
      totalSessionsTaught,
      totalEarned,
      sessions: schedules.map((s) => ({
        id: s.id,
        title: s.title,
        sessionType: s.sessionType,
        startTime: s.startTime,
        attendedMembersCount: s.bookings.length,
      })),
    };
  }
}
