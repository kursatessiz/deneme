import { Injectable, BadRequestException, NotFoundException, ConflictException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { TenantContext } from '../auth/tenant-context';
import { CreateScheduleInput, BookSessionInput, CancelBookingInput } from '@platform/shared';
import { Prisma } from '@platform/database';
import type { MemberPackage } from '@platform/database';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

@Injectable()
export class SchedulesService {
  constructor(private prisma: PrismaService) {}

  async getSchedules(
    tenant: TenantContext,
    startDate: Date,
    endDate: Date,
    trainerId?: string,
    resourceId?: string,
  ) {
    const studioId = tenant.studioId;
    const canViewContact = tenant.permissions.has('members.contact.view');

    const schedules = await this.prisma.sessionSchedule.findMany({
      where: {
        studioId,
        startTime: { gte: startDate },
        endTime: { lte: endDate },
        ...(trainerId ? { trainerId } : {}),
        ...(resourceId ? { resourceId } : {}),
      },
      include: {
        resource: true,
        serviceType: true,
        trainer: { include: { membership: { include: { user: true } } } },
        bookings: {
          include: {
            member: { include: { membership: { include: { user: true } } } },
          },
        },
      },
      orderBy: { startTime: 'asc' },
    });

    return schedules.map((schedule) => ({
      ...schedule,
      bookings: schedule.bookings.map((booking) => this.maskBookingContact(booking, canViewContact)),
    }));
  }

  async createSchedule(tenant: TenantContext, dto: CreateScheduleInput) {
    const studioId = tenant.studioId;

    const serviceType = await this.prisma.serviceType.findFirst({
      where: { id: dto.serviceTypeId, studioId, isActive: true },
    });
    if (!serviceType) {
      throw new NotFoundException('Hizmet türü bulunamadı');
    }

    const start = new Date(dto.startTime);
    const end = new Date(dto.endTime);
    if (start >= end) {
      throw new BadRequestException('Bitiş saati başlangıç saatinden sonra olmalıdır');
    }

    if (dto.resourceId) {
      const resource = await this.prisma.resource.findFirst({
        where: { id: dto.resourceId, studioId, isMaintenance: false },
      });
      if (!resource) {
        throw new BadRequestException('Seçilen kaynak bu işletmede bulunamadı veya bakımdadır');
      }
    }

    if (dto.trainerId) {
      const trainer = await this.prisma.trainerProfile.findFirst({
        where: { id: dto.trainerId, studioId },
        include: { qualifications: true },
      });
      if (!trainer) {
        throw new NotFoundException('Eğitmen bulunamadı');
      }
      if (serviceType.requiresQualification) {
        const qualified = trainer.qualifications.some((q) => q.serviceTypeId === serviceType.id);
        if (!qualified) {
          throw new BadRequestException('Eğitmen bu hizmet için yetkin değil');
        }
      }
    }

    const capacity = dto.capacity ?? serviceType.capacity;
    const recurCount = dto.isRecurring ? (dto.recurringWeeks ?? 1) : 1;

    const slots: { start: Date; end: Date }[] = [];
    for (let i = 0; i < recurCount; i++) {
      slots.push({
        start: new Date(start.getTime() + i * WEEK_MS),
        end: new Date(end.getTime() + i * WEEK_MS),
      });
    }

    for (const slot of slots) {
      await this.assertNoConflict(studioId, slot.start, slot.end, dto.trainerId, dto.resourceId);
    }

    const created = await this.prisma.$transaction((tx) =>
      Promise.all(
        slots.map((slot) =>
          tx.sessionSchedule.create({
            data: {
              studioId,
              branchId: dto.branchId,
              serviceTypeId: serviceType.id,
              resourceId: dto.resourceId,
              trainerId: dto.trainerId,
              title: dto.title,
              startTime: slot.start,
              endTime: slot.end,
              capacity,
            },
            include: { resource: true, trainer: { include: { membership: { include: { user: true } } } } },
          }),
        ),
      ),
    );

    return created.length === 1 ? created[0] : created;
  }

  async bookSession(tenant: TenantContext, dto: BookSessionInput) {
    return this.book(tenant, dto);
  }

  /** Members booking for themselves; enforces dto.memberId matches the caller's own profile. */
  async bookSessionSelf(tenant: TenantContext, dto: BookSessionInput) {
    if (!tenant.memberProfileId || dto.memberId !== tenant.memberProfileId) {
      throw new ForbiddenException('Yalnızca kendi adınıza rezervasyon yapabilirsiniz');
    }
    return this.book(tenant, dto);
  }

  private async book(tenant: TenantContext, dto: BookSessionInput) {
    const studioId = tenant.studioId;

    const schedule = await this.prisma.sessionSchedule.findFirst({
      where: { id: dto.scheduleId, studioId },
      include: { serviceType: true },
    });
    if (!schedule) {
      throw new NotFoundException('Ders seansı bulunamadı');
    }
    if (schedule.isCancelled) {
      throw new BadRequestException('Bu seans iptal edilmiştir');
    }

    const member = await this.prisma.memberProfile.findFirst({ where: { id: dto.memberId, studioId } });
    if (!member) {
      throw new NotFoundException('Üye bulunamadı');
    }

    let memberPackage: MemberPackage | null = null;
    let unitCost = 0;

    if (dto.memberPackageId) {
      memberPackage = await this.prisma.memberPackage.findFirst({
        where: { id: dto.memberPackageId, studioId },
      });
      if (!memberPackage || memberPackage.memberId !== dto.memberId) {
        throw new BadRequestException('Seçilen paket bu üyeye ait değil');
      }
      if (memberPackage.status !== 'ACTIVE') {
        throw new BadRequestException(`Paket durumu aktif değil (${memberPackage.status})`);
      }
      if (new Date() > memberPackage.endDate) {
        throw new BadRequestException('Paketin son kullanım tarihi dolmuştur');
      }

      const coverage = await this.prisma.packageDefinitionService.findUnique({
        where: {
          packageDefinitionId_serviceTypeId: {
            packageDefinitionId: memberPackage.packageDefinitionId,
            serviceTypeId: schedule.serviceTypeId,
          },
        },
      });
      if (!coverage) {
        throw new BadRequestException('Seçilen paket bu hizmeti kapsamıyor');
      }
      unitCost = coverage.unitCost;

      if (memberPackage.entitlementKind !== 'TIME_UNLIMITED' && (memberPackage.remainingUnits ?? 0) < unitCost) {
        throw new BadRequestException('Pakette yeterli seans/kredi kalmamıştır');
      }
    }

    return this.prisma.$transaction(async (tx) => {
      if (memberPackage && memberPackage.entitlementKind !== 'TIME_UNLIMITED' && unitCost > 0) {
        // Atomic conditional decrement: concurrent bookings on the same package
        // cannot spend the same units twice.
        const charged = await tx.memberPackage.updateMany({
          where: { id: memberPackage.id, studioId, status: 'ACTIVE', remainingUnits: { gte: unitCost } },
          data: { usedUnits: { increment: unitCost }, remainingUnits: { decrement: unitCost } },
        });
        if (charged.count === 0) {
          throw new BadRequestException('Pakette yeterli seans/kredi kalmamıştır');
        }
        await tx.memberPackage.updateMany({
          where: { id: memberPackage.id, studioId, remainingUnits: 0 },
          data: { status: 'DEPLETED' },
        });
      }

      const updateResult = await tx.sessionSchedule.updateMany({
        where: { id: dto.scheduleId, studioId, bookedCount: { lt: schedule.capacity } },
        data: { bookedCount: { increment: 1 } },
      });
      if (updateResult.count === 0) {
        throw new BadRequestException('Bu seansın kontenjanı doludur');
      }

      let booking;
      try {
        booking = await tx.booking.create({
          data: {
            studioId,
            scheduleId: dto.scheduleId,
            memberId: dto.memberId,
            memberPackageId: dto.memberPackageId,
            status: 'CONFIRMED',
            unitsCharged: unitCost,
          },
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw new ConflictException('Üye bu seansa zaten kayıtlı');
        }
        throw err;
      }

      for (const resourceId of dto.resourceIds ?? []) {
        const resource = await tx.resource.findFirst({ where: { id: resourceId, studioId } });
        if (!resource) {
          throw new BadRequestException('Seçilen kaynak bu işletmede bulunamadı');
        }
        try {
          await tx.bookingResource.create({
            data: {
              studioId,
              bookingId: booking.id,
              resourceId,
              startTime: schedule.startTime,
              endTime: schedule.endTime,
              exclusive: resource.capacity === 1,
            },
          });
        } catch (err) {
          if (this.isExclusionViolation(err)) {
            throw new ConflictException('Seçilen ekipman bu saat için dolu');
          }
          throw err;
        }
      }

      return booking;
    });
  }

  async cancelBooking(tenant: TenantContext, dto: CancelBookingInput) {
    return this.cancel(tenant, dto);
  }

  async cancelBookingSelf(tenant: TenantContext, dto: CancelBookingInput) {
    const booking = await this.prisma.booking.findFirst({
      where: { id: dto.bookingId, studioId: tenant.studioId },
    });
    if (!booking) {
      throw new NotFoundException('Rezervasyon bulunamadı');
    }
    if (!tenant.memberProfileId || booking.memberId !== tenant.memberProfileId) {
      throw new ForbiddenException('Yalnızca kendi rezervasyonunuzu iptal edebilirsiniz');
    }
    return this.cancel(tenant, dto);
  }

  private async cancel(tenant: TenantContext, dto: CancelBookingInput) {
    const studioId = tenant.studioId;

    const booking = await this.prisma.booking.findFirst({
      where: { id: dto.bookingId, studioId },
      include: {
        schedule: { include: { serviceType: { include: { cancellationPolicy: true } } } },
        memberPackage: true,
      },
    });
    if (!booking) {
      throw new NotFoundException('Rezervasyon bulunamadı');
    }
    if (booking.status !== 'CONFIRMED') {
      throw new BadRequestException('Yalnızca onaylı rezervasyonlar iptal edilebilir');
    }

    let freeCancelHours = booking.schedule.serviceType.cancellationPolicy?.freeCancelHours;
    if (freeCancelHours === undefined || freeCancelHours === null) {
      const defaultPolicy = await this.prisma.cancellationPolicy.findFirst({
        where: { studioId, isDefault: true },
      });
      freeCancelHours = defaultPolicy?.freeCancelHours ?? 0;
    }

    const now = new Date();
    const deadline = new Date(booking.schedule.startTime.getTime() - freeCancelHours * HOUR_MS);
    const isLateCancellation = now > deadline;

    return this.prisma.$transaction(async (tx) => {
      if (
        !isLateCancellation &&
        booking.memberPackageId &&
        booking.memberPackage &&
        booking.memberPackage.entitlementKind !== 'TIME_UNLIMITED'
      ) {
        await tx.memberPackage.update({
          where: { id: booking.memberPackageId },
          data: {
            usedUnits: { decrement: booking.unitsCharged },
            remainingUnits: { increment: booking.unitsCharged },
            status: 'ACTIVE',
          },
        });
      }

      const updatedBooking = await tx.booking.update({
        where: { id: dto.bookingId },
        data: {
          status: isLateCancellation ? 'CANCELLED_LATE' : 'CANCELLED_EARLY',
          cancelledAt: now,
          cancellationReason: dto.reason,
          isLateCancellation,
        },
      });

      await tx.sessionSchedule.update({
        where: { id: booking.scheduleId },
        data: { bookedCount: { decrement: 1 } },
      });

      await tx.bookingResource.updateMany({
        where: { bookingId: dto.bookingId, studioId },
        data: { isActive: false },
      });

      return {
        booking: updatedBooking,
        isLateCancellation,
        creditRefunded: !isLateCancellation,
        message: !isLateCancellation
          ? 'Rezervasyon başarıyla iptal edildi, seans kredisi paketinize iade edildi.'
          : `Ders saatine ${freeCancelHours} saatten az kaldığı için seans kredisi düşülerek iptal edildi.`,
      };
    });
  }

  async checkIn(tenant: TenantContext, bookingId: string) {
    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, studioId: tenant.studioId },
    });
    if (!booking) {
      throw new NotFoundException('Rezervasyon bulunamadı');
    }

    return this.prisma.booking.update({
      where: { id: bookingId },
      data: { status: 'ATTENDED', checkInAt: new Date() },
    });
  }

  private async assertNoConflict(
    studioId: string,
    start: Date,
    end: Date,
    trainerId?: string,
    resourceId?: string,
  ) {
    const overlap = { startTime: { lt: end }, endTime: { gt: start } };

    if (trainerId) {
      const trainerConflict = await this.prisma.sessionSchedule.findFirst({
        where: { studioId, trainerId, isCancelled: false, ...overlap },
      });
      if (trainerConflict) {
        throw new ConflictException('Seçilen eğitmenin bu saat aralığında başka bir dersi bulunmaktadır');
      }
    }

    if (resourceId) {
      const resourceConflict = await this.prisma.sessionSchedule.findFirst({
        where: { studioId, resourceId, isCancelled: false, ...overlap },
      });
      if (resourceConflict) {
        throw new ConflictException('Seçilen kaynak bu saat aralığında doludur');
      }
    }
  }

  private maskBookingContact(booking: any, canViewContact: boolean) {
    if (canViewContact) return booking;
    const user = booking.member?.membership?.user;
    if (!user) return booking;
    const { phone, email, ...rest } = user;
    return {
      ...booking,
      member: {
        ...booking.member,
        membership: { ...booking.member.membership, user: rest },
      },
    };
  }

  private isExclusionViolation(err: unknown): boolean {
    if (!err || typeof err !== 'object') return false;
    const anyErr = err as { code?: string; message?: string };
    if (anyErr.code === 'P2004') return true;
    if (typeof anyErr.code === 'string' && anyErr.code.includes('23P01')) return true;
    if (typeof anyErr.message === 'string') {
      const msg = anyErr.message.toLowerCase();
      if (msg.includes('23p01') || msg.includes('exclusion') || msg.includes('unique constraint')) return true;
    }
    return false;
  }
}
