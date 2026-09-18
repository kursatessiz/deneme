import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateScheduleInput,
  BookSessionInput,
  CancelBookingInput,
} from '@pilates/shared';

@Injectable()
export class SchedulesService {
  constructor(private prisma: PrismaService) {}

  async getSchedules(
    studioId: string,
    startDate: Date,
    endDate: Date,
    trainerId?: string,
    roomId?: string,
  ) {
    return this.prisma.sessionSchedule.findMany({
      where: {
        studioId,
        startTime: { gte: startDate },
        endTime: { lte: endDate },
        ...(trainerId ? { trainerId } : {}),
        ...(roomId ? { roomId } : {}),
      },
      include: {
        room: true,
        trainer: {
          include: {
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                avatarUrl: true,
              },
            },
          },
        },
        bookings: {
          include: {
            member: {
              include: {
                user: {
                  select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    phone: true,
                  },
                },
              },
            },
          },
        },
      },
      orderBy: { startTime: 'asc' },
    });
  }

  async createSchedule(dto: CreateScheduleInput) {
    const start = new Date(dto.startTime);
    const end = new Date(dto.endTime);

    if (start >= end) {
      throw new BadRequestException('Bitiş saati başlangıç saatinden sonra olmalıdır');
    }

    // 1. Trainer conflict check
    const trainerConflict = await this.prisma.sessionSchedule.findFirst({
      where: {
        trainerId: dto.trainerId,
        isCancelled: false,
        OR: [
          { startTime: { lte: start }, endTime: { gt: start } },
          { startTime: { lt: end }, endTime: { gte: end } },
          { startTime: { gte: start }, endTime: { lte: end } },
        ],
      },
    });

    if (trainerConflict) {
      throw new ConflictException('Seçilen eğitmenin bu saat aralığında başka bir dersi bulunmaktadır');
    }

    // 2. Room conflict check (if room is assigned and capacity exceeded)
    if (dto.roomId) {
      const room = await this.prisma.room.findUnique({ where: { id: dto.roomId } });
      if (room && dto.capacity > room.capacity) {
        throw new BadRequestException(`Seçilen oda en fazla ${room.capacity} kişi alabilir`);
      }
    }

    // Recurring support
    const schedulesToCreate: any[] = [];
    const recurCount = dto.isRecurring ? (dto.recurringWeeks || 1) : 1;

    for (let i = 0; i < recurCount; i++) {
      const slotStart = new Date(start.getTime() + i * 7 * 24 * 60 * 60 * 1000);
      const slotEnd = new Date(end.getTime() + i * 7 * 24 * 60 * 60 * 1000);

      schedulesToCreate.push({
        studioId: dto.studioId,
        branchId: dto.branchId,
        roomId: dto.roomId,
        trainerId: dto.trainerId,
        sessionType: dto.sessionType,
        title: dto.title,
        startTime: slotStart,
        endTime: slotEnd,
        capacity: dto.capacity,
      });
    }

    if (schedulesToCreate.length === 1) {
      return this.prisma.sessionSchedule.create({
        data: schedulesToCreate[0],
        include: { room: true, trainer: { include: { user: true } } },
      });
    }

    return this.prisma.sessionSchedule.createMany({
      data: schedulesToCreate,
    });
  }

  async bookSession(dto: BookSessionInput) {
    const schedule = await this.prisma.sessionSchedule.findFirst({
      where: { id: dto.scheduleId, studioId: dto.studioId },
      include: { bookings: true },
    });

    if (!schedule) {
      throw new NotFoundException('Ders seansı bulunamadı');
    }

    if (schedule.isCancelled) {
      throw new BadRequestException('Bu seans iptal edilmiştir');
    }

    const activeBookingsCount = schedule.bookings.filter(
      (b) => b.status === 'CONFIRMED' || b.status === 'ATTENDED',
    ).length;

    if (activeBookingsCount >= schedule.capacity) {
      throw new BadRequestException('Bu seansın kontenjanı doludur');
    }

    // Check member's package
    const memberPackage = await this.prisma.memberPackage.findFirst({
      where: {
        id: dto.memberPackageId,
        memberId: dto.memberId,
        studioId: dto.studioId,
      },
    });

    if (!memberPackage) {
      throw new NotFoundException('Üyenin geçerli bir paketi bulunamadı');
    }

    if (memberPackage.status !== 'ACTIVE') {
      throw new BadRequestException(`Paket durumu aktif değil (${memberPackage.status})`);
    }

    if (memberPackage.remainingSessions <= 0) {
      throw new BadRequestException('Pakette kalan seans kredisi kalmamıştır');
    }

    if (new Date() > memberPackage.endDate) {
      throw new BadRequestException('Paketin son kullanım tarihi dolmuştur');
    }

    return this.prisma.$transaction(async (tx) => {
      // 1. Create booking
      const booking = await tx.booking.create({
        data: {
          studioId: dto.studioId,
          scheduleId: dto.scheduleId,
          memberId: dto.memberId,
          memberPackageId: dto.memberPackageId,
          status: 'CONFIRMED',
        },
      });

      // 2. Decrement package credit
      const remaining = memberPackage.remainingSessions - 1;
      await tx.memberPackage.update({
        where: { id: memberPackage.id },
        data: {
          usedSessions: memberPackage.usedSessions + 1,
          remainingSessions: remaining,
          status: remaining === 0 ? 'DEPLETED' : 'ACTIVE',
        },
      });

      // 3. Update schedule bookedCount
      await tx.sessionSchedule.update({
        where: { id: dto.scheduleId },
        data: { bookedCount: { increment: 1 } },
      });

      return booking;
    });
  }

  async cancelBooking(dto: CancelBookingInput) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: dto.bookingId },
      include: {
        schedule: true,
        memberPackage: true,
        studio: true,
      },
    });

    if (!booking) {
      throw new NotFoundException('Rezervasyon bulunamadı');
    }

    if (booking.status !== 'CONFIRMED') {
      throw new BadRequestException('Yalnızca onaylı rezervasyonlar iptal edilebilir');
    }

    const now = new Date();
    const sessionStart = new Date(booking.schedule.startTime);
    const deadlineHours = booking.studio.cancellationDeadlineHours || 4;
    const deadlineTime = new Date(sessionStart.getTime() - deadlineHours * 60 * 60 * 1000);

    const isLateCancellation = now > deadlineTime;

    return this.prisma.$transaction(async (tx) => {
      // If early cancellation, refund 1 credit back to package
      if (!isLateCancellation) {
        await tx.memberPackage.update({
          where: { id: booking.memberPackageId },
          data: {
            usedSessions: { decrement: 1 },
            remainingSessions: { increment: 1 },
            status: 'ACTIVE',
          },
        });
      }

      // Update booking status
      const updatedBooking = await tx.booking.update({
        where: { id: dto.bookingId },
        data: {
          status: isLateCancellation ? 'CANCELLED_LATE' : 'CANCELLED_EARLY',
          cancelledAt: now,
          cancellationReason: dto.reason,
          isLateCancellation,
        },
      });

      // Decrement schedule bookedCount
      await tx.sessionSchedule.update({
        where: { id: booking.scheduleId },
        data: { bookedCount: { decrement: 1 } },
      });

      return {
        booking: updatedBooking,
        isLateCancellation,
        creditRefunded: !isLateCancellation,
        message: !isLateCancellation
          ? 'Rezervasyon başarıyla iptal edildi, seans kredisi paketinize iade edildi.'
          : `Ders saatine ${deadlineHours} saatten az kaldığı için seans kredisi düşülerek iptal edildi.`,
      };
    });
  }

  async checkIn(bookingId: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
    });

    if (!booking) {
      throw new NotFoundException('Rezervasyon bulunamadı');
    }

    return this.prisma.booking.update({
      where: { id: bookingId },
      data: {
        status: 'ATTENDED',
        checkInAt: new Date(),
      },
    });
  }
}
