import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { TenantContext } from '../auth/tenant-context';
import type {
  CreateScheduleInput,
  BookSessionInput,
  CancelBookingInput,
  MarkNoShowInput,
  JoinWaitlistInput,
  LeaveWaitlistInput,
  SubstituteTrainerInput,
  CancelSessionInput,
  NotificationCategory,
} from '@platform/shared';
import { Prisma } from '@platform/database';
import type { CancellationPolicy, MemberPackage } from '@platform/database';
import { evaluateCancellation, evaluateNoShow, FALLBACK_POLICY, PolicyTerms } from './cancellation-policy';
import { assertBranchAccess, branchScope } from '../branches/branch-access';
import { deriveSpotStatus, SpotOccupant } from './spots';
import type { ScheduleSpotsDTO, SpotGroupDTO } from '@platform/shared';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const CAPACITY_FULL = 'Bu seansın kontenjanı doludur';
/** Upper bound on entries tried per freed seat, so a long list of unusable entries cannot stall a request. */
const MAX_PROMOTION_ATTEMPTS = 20;

type Tx = Prisma.TransactionClient;

@Injectable()
export class SchedulesService {
  private readonly logger = new Logger(SchedulesService.name);

  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
  ) {}

  async getSchedules(
    tenant: TenantContext,
    startDate: Date,
    endDate: Date,
    trainerId?: string,
    resourceId?: string,
    branchId?: string,
  ) {
    const studioId = tenant.studioId;
    const canViewContact = tenant.permissions.has('members.contact.view');
    const scope = branchScope(tenant, branchId);

    const schedules = await this.prisma.sessionSchedule.findMany({
      where: {
        studioId,
        startTime: { gte: startDate },
        endTime: { lte: endDate },
        ...(trainerId ? { trainerId } : {}),
        ...(resourceId ? { resourceId } : {}),
        ...scope,
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

  /**
   * A lightweight session list for members browsing what to book: no
   * per-booking detail (who else is enrolled stays private), just enough to
   * pick a session and open its spot map.
   */
  async getSchedulesSelf(tenant: TenantContext, startDate: Date, endDate: Date) {
    const schedules = await this.prisma.sessionSchedule.findMany({
      where: { studioId: tenant.studioId, startTime: { gte: startDate }, endTime: { lte: endDate }, isCancelled: false },
      include: {
        resource: true,
        serviceType: true,
        trainer: { include: { membership: { include: { user: true } } } },
      },
      orderBy: { startTime: 'asc' },
    });

    return schedules.map((s) => ({
      id: s.id,
      studioId: s.studioId,
      branchId: s.branchId,
      serviceTypeId: s.serviceTypeId,
      serviceTypeName: s.serviceType.name,
      resourceId: s.resourceId,
      resourceName: s.resource?.name ?? null,
      trainerId: s.trainerId,
      trainerName: s.trainer ? `${s.trainer.membership.user.firstName} ${s.trainer.membership.user.lastName}`.trim() : null,
      title: s.title,
      startTime: s.startTime,
      endTime: s.endTime,
      capacity: s.capacity,
      bookedCount: s.bookedCount,
      isCancelled: s.isCancelled,
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

    let branchId = dto.branchId ?? null;
    if (branchId) {
      const branch = await this.prisma.branch.findFirst({ where: { id: branchId, studioId, isActive: true } });
      if (!branch) {
        throw new BadRequestException('Seçilen şube bu işletmede bulunamadı veya pasif');
      }
    }

    if (dto.resourceId) {
      const resource = await this.prisma.resource.findFirst({
        where: { id: dto.resourceId, studioId, isMaintenance: false },
      });
      if (!resource) {
        throw new BadRequestException('Seçilen kaynak bu işletmede bulunamadı veya bakımdadır');
      }
      if (resource.branchId && branchId && resource.branchId !== branchId) {
        throw new BadRequestException('Seçilen kaynak başka bir şubeye ait');
      }
      // A room of a branch places the session in that branch.
      branchId = branchId ?? resource.branchId;
    }

    if (tenant.branchIds !== null && !branchId) {
      throw new BadRequestException('Şube seçiniz');
    }
    assertBranchAccess(tenant, branchId);

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
              branchId,
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
    await this.assertScheduleBranch(tenant, dto.scheduleId);
    return this.book(tenant.studioId, dto);
  }

  /** Members booking for themselves; enforces dto.memberId matches the caller's own profile. */
  async bookSessionSelf(tenant: TenantContext, dto: BookSessionInput) {
    this.assertSelf(tenant, dto.memberId, 'Yalnızca kendi adınıza rezervasyon yapabilirsiniz');
    return this.book(tenant.studioId, dto);
  }

  // ---------------------------------------------------------------------------
  // Spot map
  // ---------------------------------------------------------------------------

  /**
   * Member-selectable resources for a session: the room's equipment when the
   * session has a room, otherwise the branch's standalone selectable
   * resources. Available to members and staff alike; who took a spot is
   * hidden from members and revealed to staff only with bookings.view.
   */
  async getSpots(tenant: TenantContext, scheduleId: string): Promise<ScheduleSpotsDTO> {
    const studioId = tenant.studioId;
    const schedule = await this.prisma.sessionSchedule.findFirst({ where: { id: scheduleId, studioId } });
    if (!schedule) {
      throw new NotFoundException('Ders seansı bulunamadı');
    }
    assertBranchAccess(tenant, schedule.branchId);

    const candidates = schedule.resourceId
      ? await this.prisma.resource.findMany({
          where: { studioId, isActive: true, parentResourceId: schedule.resourceId, resourceType: { selectableByMember: true } },
          include: { resourceType: true },
          orderBy: [{ label: 'asc' }, { name: 'asc' }],
        })
      : await this.prisma.resource.findMany({
          where: {
            studioId,
            isActive: true,
            parentResourceId: null,
            resourceType: { selectableByMember: true },
            ...(schedule.branchId ? { OR: [{ branchId: schedule.branchId }, { branchId: null }] } : {}),
          },
          include: { resourceType: true },
          orderBy: [{ label: 'asc' }, { name: 'asc' }],
        });

    if (candidates.length === 0) {
      return { scheduleId, roomResourceId: schedule.resourceId, groups: [] };
    }

    const activeHolds = await this.prisma.bookingResource.findMany({
      where: {
        studioId,
        resourceId: { in: candidates.map((c) => c.id) },
        isActive: true,
        startTime: { lt: schedule.endTime },
        endTime: { gt: schedule.startTime },
        booking: { status: { in: ['CONFIRMED', 'ATTENDED'] } },
      },
      include: { booking: { include: { member: { include: { membership: { include: { user: true } } } } } } },
    });

    const occupantsByResource = new Map<string, SpotOccupant[]>();
    for (const hold of activeHolds) {
      const list = occupantsByResource.get(hold.resourceId) ?? [];
      const user = hold.booking.member.membership.user;
      list.push({ memberId: hold.booking.memberId, memberName: `${user.firstName} ${user.lastName}`.trim() });
      occupantsByResource.set(hold.resourceId, list);
    }

    const canViewNames = tenant.permissions.has('bookings.view');
    const groups = new Map<string, SpotGroupDTO>();
    for (const resource of candidates) {
      const occupants = occupantsByResource.get(resource.id) ?? [];
      const derived = deriveSpotStatus({
        isMaintenance: resource.isMaintenance,
        capacity: resource.capacity,
        occupants,
        callerMemberId: tenant.memberProfileId,
      });
      const group = groups.get(resource.resourceTypeId) ?? {
        resourceTypeId: resource.resourceTypeId,
        resourceTypeName: resource.resourceType.name,
        spots: [],
      };
      group.spots.push({
        id: resource.id,
        name: resource.name,
        label: resource.label,
        layoutX: resource.layoutX,
        layoutY: resource.layoutY,
        capacity: resource.capacity,
        status: derived.status,
        takenByMemberName: derived.status === 'TAKEN' && canViewNames ? (derived.takenBy?.memberName ?? null) : null,
      });
      groups.set(resource.resourceTypeId, group);
    }

    return { scheduleId, roomResourceId: schedule.resourceId, groups: [...groups.values()] };
  }

  /** Staff changing the spot of any booking in a branch they can act on. */
  async changeSpot(tenant: TenantContext, bookingId: string, resourceIds: string[]) {
    await this.assertBookingBranch(tenant, bookingId);
    return this.doChangeSpot(tenant.studioId, bookingId, resourceIds);
  }

  /** Members changing the spot of their own booking. */
  async changeSpotSelf(tenant: TenantContext, bookingId: string, resourceIds: string[]) {
    const booking = await this.prisma.booking.findFirst({ where: { id: bookingId, studioId: tenant.studioId } });
    if (!booking) {
      throw new NotFoundException('Rezervasyon bulunamadı');
    }
    this.assertSelf(tenant, booking.memberId, 'Yalnızca kendi rezervasyonunuzun yerini değiştirebilirsiniz');
    return this.doChangeSpot(tenant.studioId, bookingId, resourceIds);
  }

  /**
   * Replaces a booking's held resources atomically: the old rows are
   * deleted and the new ones created in the same transaction, so a
   * concurrent booking of the same spot is caught by the exclusion
   * constraint and turned into a 409, never a partial swap.
   */
  private async doChangeSpot(studioId: string, bookingId: string, resourceIds: string[]) {
    return this.prisma.$transaction(async (tx) => {
      const booking = await tx.booking.findFirst({
        where: { id: bookingId, studioId },
        include: { schedule: true },
      });
      if (!booking) {
        throw new NotFoundException('Rezervasyon bulunamadı');
      }
      if (booking.status !== 'CONFIRMED') {
        throw new BadRequestException('Yalnızca onaylı rezervasyonların yeri değiştirilebilir');
      }

      await tx.bookingResource.deleteMany({ where: { studioId, bookingId: booking.id } });

      for (const resourceId of resourceIds) {
        const resource = await tx.resource.findFirst({ where: { id: resourceId, studioId } });
        if (!resource) {
          throw new BadRequestException('Seçilen kaynak bu işletmede bulunamadı');
        }
        if (resource.isMaintenance) {
          throw new BadRequestException('Seçilen yer bakımdadır');
        }
        try {
          await tx.bookingResource.create({
            data: {
              studioId,
              bookingId: booking.id,
              resourceId,
              startTime: booking.schedule.startTime,
              endTime: booking.schedule.endTime,
              exclusive: resource.capacity === 1,
            },
          });
        } catch (err) {
          if (this.isExclusionViolation(err)) {
            throw new ConflictException('Seçilen yer bu saat için dolu');
          }
          throw err;
        }
      }

      return tx.bookingResource.findMany({ where: { studioId, bookingId: booking.id } });
    });
  }

  private async book(studioId: string, dto: BookSessionInput) {
    const schedule = await this.prisma.sessionSchedule.findFirst({
      where: { id: dto.scheduleId, studioId },
      include: { serviceType: { include: { requiredResourceTypes: { include: { resourceType: true } } } } },
    });
    if (!schedule) {
      throw new NotFoundException('Ders seansı bulunamadı');
    }
    if (schedule.isCancelled) {
      throw new BadRequestException('Bu seans iptal edilmiştir');
    }

    const requiresSelectableSpot = (schedule.serviceType.requiredResourceTypes ?? []).some(
      (r) => r.resourceType.selectableByMember,
    );
    if (requiresSelectableSpot && (!dto.resourceIds || dto.resourceIds.length === 0)) {
      throw new BadRequestException('Bu hizmet için bir yer seçmelisiniz');
    }

    const member = await this.prisma.memberProfile.findFirst({ where: { id: dto.memberId, studioId } });
    if (!member) {
      throw new NotFoundException('Üye bulunamadı');
    }

    const { memberPackage, unitCost } = await this.resolvePackage(
      studioId,
      dto.memberId,
      dto.memberPackageId,
      schedule.serviceTypeId,
    );

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
        where: { id: dto.scheduleId, studioId, isCancelled: false, bookedCount: { lt: schedule.capacity } },
        data: { bookedCount: { increment: 1 } },
      });
      if (updateResult.count === 0) {
        throw new BadRequestException(CAPACITY_FULL);
      }

      let booking;
      try {
        booking = await this.upsertBooking(tx, studioId, dto.scheduleId, dto.memberId, dto.memberPackageId, unitCost);
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

      // A member who got a seat no longer waits for one.
      await tx.waitlist.updateMany({
        where: { studioId, scheduleId: dto.scheduleId, memberId: dto.memberId, status: { in: ['WAITING', 'OFFERED'] } },
        data: { status: 'PROMOTED', resolvedAt: new Date() },
      });

      return booking;
    });
  }

  /**
   * A cancelled booking row blocks a new one through the (scheduleId, memberId)
   * unique key, so rebooking after a cancellation reuses that row. A live
   * booking still raises P2002.
   */
  private async upsertBooking(
    tx: Tx,
    studioId: string,
    scheduleId: string,
    memberId: string,
    memberPackageId: string | undefined,
    unitsCharged: number,
  ) {
    const fresh = {
      memberPackageId: memberPackageId ?? null,
      status: 'CONFIRMED' as const,
      unitsCharged,
      penaltyUnits: 0,
      checkInAt: null,
      cancelledAt: null,
      cancellationReason: null,
      isLateCancellation: false,
    };
    const reopened = await tx.booking.updateMany({
      where: { studioId, scheduleId, memberId, status: { in: ['CANCELLED_EARLY', 'CANCELLED_LATE'] } },
      data: fresh,
    });
    if (reopened.count === 1) {
      await tx.bookingResource.deleteMany({ where: { studioId, booking: { scheduleId, memberId } } });
      return tx.booking.findFirstOrThrow({ where: { studioId, scheduleId, memberId } });
    }
    return tx.booking.create({ data: { studioId, scheduleId, memberId, ...fresh } });
  }

  private async resolvePackage(
    studioId: string,
    memberId: string,
    memberPackageId: string | undefined,
    serviceTypeId: string,
  ): Promise<{ memberPackage: MemberPackage | null; unitCost: number }> {
    if (!memberPackageId) {
      return { memberPackage: null, unitCost: 0 };
    }
    const memberPackage = await this.prisma.memberPackage.findFirst({
      where: { id: memberPackageId, studioId },
    });
    if (!memberPackage || memberPackage.memberId !== memberId) {
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
          serviceTypeId,
        },
      },
    });
    if (!coverage) {
      throw new BadRequestException('Seçilen paket bu hizmeti kapsamıyor');
    }
    const unitCost = coverage.unitCost;

    if (memberPackage.entitlementKind !== 'TIME_UNLIMITED' && (memberPackage.remainingUnits ?? 0) < unitCost) {
      throw new BadRequestException('Pakette yeterli seans/kredi kalmamıştır');
    }
    return { memberPackage, unitCost };
  }

  async cancelBooking(tenant: TenantContext, dto: CancelBookingInput) {
    await this.assertBookingBranch(tenant, dto.bookingId);
    return this.cancel(tenant, dto, dto.waivePenalty);
  }

  async cancelBookingSelf(tenant: TenantContext, dto: CancelBookingInput) {
    const booking = await this.prisma.booking.findFirst({
      where: { id: dto.bookingId, studioId: tenant.studioId },
    });
    if (!booking) {
      throw new NotFoundException('Rezervasyon bulunamadı');
    }
    this.assertSelf(tenant, booking.memberId, 'Yalnızca kendi rezervasyonunuzu iptal edebilirsiniz');
    // Members cannot waive their own penalty.
    return this.cancel(tenant, { ...dto, cancelledBy: 'MEMBER' }, false);
  }

  private async cancel(tenant: TenantContext, dto: CancelBookingInput, waivePenalty: boolean) {
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

    const policy = await this.resolvePolicy(studioId, booking.schedule.serviceType.cancellationPolicy);
    const now = new Date();
    const outcome = evaluateCancellation({
      policy,
      sessionStart: booking.schedule.startTime,
      now,
      unitsCharged: booking.unitsCharged,
      entitlementKind: booking.memberPackage?.entitlementKind ?? null,
      waivePenalty,
    });

    const updatedBooking = await this.prisma.$transaction(async (tx) => {
      // Conditional transition: two concurrent cancels cannot both refund.
      const transitioned = await tx.booking.updateMany({
        where: { id: booking.id, studioId, status: 'CONFIRMED' },
        data: {
          status: outcome.isLate ? 'CANCELLED_LATE' : 'CANCELLED_EARLY',
          cancelledAt: now,
          cancellationReason: dto.reason,
          isLateCancellation: outcome.isLate,
          penaltyUnits: outcome.penaltyUnits,
        },
      });
      if (transitioned.count === 0) {
        throw new ConflictException('Rezervasyon zaten güncellenmiş');
      }

      await this.refund(tx, studioId, booking.memberPackageId, outcome.refundUnits);

      await tx.sessionSchedule.updateMany({
        where: { id: booking.scheduleId, studioId, bookedCount: { gt: 0 } },
        data: { bookedCount: { decrement: 1 } },
      });

      await tx.bookingResource.updateMany({
        where: { bookingId: booking.id, studioId },
        data: { isActive: false },
      });

      return tx.booking.findUniqueOrThrow({ where: { id: booking.id } });
    });

    const promoted = booking.schedule.startTime > now ? await this.promoteFromWaitlistSafe(studioId, booking.scheduleId) : 0;

    return {
      booking: updatedBooking,
      isLateCancellation: outcome.isLate,
      refundedUnits: outcome.refundUnits,
      penaltyUnits: outcome.penaltyUnits,
      creditRefunded: outcome.refundUnits > 0,
      promotedFromWaitlist: promoted,
      message: this.cancellationMessage(outcome.isLate, outcome.refundUnits, outcome.penaltyUnits, policy),
    };
  }

  private cancellationMessage(isLate: boolean, refund: number, penalty: number, policy: PolicyTerms): string {
    if (!isLate) {
      return refund > 0
        ? 'Rezervasyon iptal edildi, seans hakkı paketinize iade edildi.'
        : 'Rezervasyon iptal edildi.';
    }
    if (penalty === 0) {
      return refund > 0 ? 'Geç iptal cezası uygulanmadı, seans hakkı paketinize iade edildi.' : 'Rezervasyon iptal edildi.';
    }
    const window = policy.freeCancelHours > 0 ? `Seansa ${policy.freeCancelHours} saatten az kaldığı için ` : 'Seans başladığı için ';
    return `${window}${penalty} birim geç iptal olarak düşüldü${refund > 0 ? `, ${refund} birim iade edildi` : ''}.`;
  }

  async markNoShow(tenant: TenantContext, bookingId: string, dto: MarkNoShowInput) {
    const studioId = tenant.studioId;
    await this.assertBookingBranch(tenant, bookingId);
    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, studioId },
      include: {
        schedule: { include: { serviceType: { include: { cancellationPolicy: true } } } },
        memberPackage: true,
      },
    });
    if (!booking) {
      throw new NotFoundException('Rezervasyon bulunamadı');
    }
    if (booking.status !== 'CONFIRMED') {
      throw new BadRequestException('Yalnızca onaylı rezervasyonlar gelmedi olarak işaretlenebilir');
    }
    if (booking.schedule.startTime > new Date()) {
      throw new BadRequestException('Seans başlamadan gelmedi işaretlenemez');
    }

    const policy = await this.resolvePolicy(studioId, booking.schedule.serviceType.cancellationPolicy);
    const outcome = evaluateNoShow({
      policy,
      unitsCharged: booking.unitsCharged,
      entitlementKind: booking.memberPackage?.entitlementKind ?? null,
      waivePenalty: dto.waivePenalty,
    });

    return this.prisma.$transaction(async (tx) => {
      const transitioned = await tx.booking.updateMany({
        where: { id: booking.id, studioId, status: 'CONFIRMED' },
        data: { status: 'NO_SHOW', penaltyUnits: outcome.penaltyUnits },
      });
      if (transitioned.count === 0) {
        throw new ConflictException('Rezervasyon zaten güncellenmiş');
      }
      await this.refund(tx, studioId, booking.memberPackageId, outcome.refundUnits);
      const updated = await tx.booking.findUniqueOrThrow({ where: { id: booking.id } });
      return { booking: updated, refundedUnits: outcome.refundUnits, penaltyUnits: outcome.penaltyUnits };
    });
  }

  private async refund(tx: Tx, studioId: string, memberPackageId: string | null, units: number) {
    if (!memberPackageId || units <= 0) return;
    await tx.memberPackage.updateMany({
      where: { id: memberPackageId, studioId },
      data: { usedUnits: { decrement: units }, remainingUnits: { increment: units } },
    });
    // Only a package emptied by bookings comes back; frozen or expired ones keep their status.
    await tx.memberPackage.updateMany({
      where: { id: memberPackageId, studioId, status: 'DEPLETED', remainingUnits: { gt: 0 } },
      data: { status: 'ACTIVE' },
    });
  }

  private async resolvePolicy(studioId: string, attached: CancellationPolicy | null): Promise<PolicyTerms> {
    if (attached) return attached;
    const fallback = await this.prisma.cancellationPolicy.findFirst({ where: { studioId, isDefault: true } });
    return fallback ?? FALLBACK_POLICY;
  }

  async checkIn(tenant: TenantContext, bookingId: string) {
    await this.assertBookingBranch(tenant, bookingId);
    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, studioId: tenant.studioId },
    });
    if (!booking) {
      throw new NotFoundException('Rezervasyon bulunamadı');
    }

    const updated = await this.prisma.booking.updateMany({
      where: { id: bookingId, studioId: tenant.studioId, status: 'CONFIRMED' },
      data: { status: 'ATTENDED', checkInAt: new Date() },
    });
    if (updated.count === 0) {
      throw new BadRequestException('Yalnızca onaylı rezervasyonlar için giriş yapılabilir');
    }
    return this.prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
  }

  // ---------------------------------------------------------------------------
  // Waitlist
  // ---------------------------------------------------------------------------

  async getWaitlist(tenant: TenantContext, scheduleId: string) {
    const schedule = await this.prisma.sessionSchedule.findFirst({ where: { id: scheduleId, studioId: tenant.studioId } });
    if (!schedule) {
      throw new NotFoundException('Ders seansı bulunamadı');
    }
    assertBranchAccess(tenant, schedule.branchId);
    const canViewContact = tenant.permissions.has('members.contact.view');
    const entries = await this.prisma.waitlist.findMany({
      where: { studioId: tenant.studioId, scheduleId },
      include: { member: { include: { membership: { include: { user: true } } } } },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    });
    return entries.map((entry) => this.maskBookingContact(entry, canViewContact));
  }

  async joinWaitlist(tenant: TenantContext, dto: JoinWaitlistInput) {
    await this.assertScheduleBranch(tenant, dto.scheduleId);
    return this.join(tenant.studioId, dto);
  }

  async joinWaitlistSelf(tenant: TenantContext, dto: JoinWaitlistInput) {
    this.assertSelf(tenant, dto.memberId, 'Yalnızca kendi adınıza bekleme listesine girebilirsiniz');
    return this.join(tenant.studioId, dto);
  }

  private async join(studioId: string, dto: JoinWaitlistInput) {
    const schedule = await this.prisma.sessionSchedule.findFirst({ where: { id: dto.scheduleId, studioId } });
    if (!schedule) {
      throw new NotFoundException('Ders seansı bulunamadı');
    }
    if (schedule.isCancelled) {
      throw new BadRequestException('Bu seans iptal edilmiştir');
    }
    if (schedule.startTime <= new Date()) {
      throw new BadRequestException('Başlamış bir seansın bekleme listesine girilemez');
    }
    if (schedule.bookedCount < schedule.capacity) {
      throw new BadRequestException('Seansta boş yer var, doğrudan rezervasyon yapabilirsiniz');
    }

    const member = await this.prisma.memberProfile.findFirst({ where: { id: dto.memberId, studioId } });
    if (!member) {
      throw new NotFoundException('Üye bulunamadı');
    }
    const live = await this.prisma.booking.findFirst({
      where: { studioId, scheduleId: dto.scheduleId, memberId: dto.memberId, status: { in: ['CONFIRMED', 'ATTENDED'] } },
    });
    if (live) {
      throw new ConflictException('Üye bu seansa zaten kayıtlı');
    }
    // Validates ownership, status and coverage now so the member learns about
    // a problem at join time, not when a seat opens.
    await this.resolvePackage(studioId, dto.memberId, dto.memberPackageId, schedule.serviceTypeId);

    return this.prisma.$transaction(async (tx) => {
      const last = await tx.waitlist.aggregate({
        where: { studioId, scheduleId: dto.scheduleId },
        _max: { position: true },
      });
      const position = (last._max.position ?? 0) + 1;

      const existing = await tx.waitlist.findUnique({
        where: { scheduleId_memberId: { scheduleId: dto.scheduleId, memberId: dto.memberId } },
      });
      if (existing && (existing.status === 'WAITING' || existing.status === 'OFFERED')) {
        throw new ConflictException('Üye zaten bekleme listesinde');
      }
      const data = {
        memberPackageId: dto.memberPackageId ?? null,
        position,
        status: 'WAITING' as const,
        offeredAt: null,
        resolvedAt: null,
        failureReason: null,
      };
      try {
        const entry = existing
          ? await tx.waitlist.update({ where: { id: existing.id }, data })
          : await tx.waitlist.create({
              data: { studioId, scheduleId: dto.scheduleId, memberId: dto.memberId, ...data },
            });
        const ahead = await tx.waitlist.count({
          where: { studioId, scheduleId: dto.scheduleId, status: 'WAITING', position: { lt: entry.position } },
        });
        return { ...entry, placeInLine: ahead + 1 };
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw new ConflictException('Üye zaten bekleme listesinde');
        }
        throw err;
      }
    });
  }

  async leaveWaitlist(tenant: TenantContext, dto: LeaveWaitlistInput) {
    return this.leave(tenant, dto, false);
  }

  async leaveWaitlistSelf(tenant: TenantContext, dto: LeaveWaitlistInput) {
    return this.leave(tenant, dto, true);
  }

  private async leave(tenant: TenantContext, dto: LeaveWaitlistInput, selfOnly: boolean) {
    const entry = await this.prisma.waitlist.findFirst({ where: { id: dto.waitlistId, studioId: tenant.studioId } });
    if (!entry) {
      throw new NotFoundException('Bekleme listesi kaydı bulunamadı');
    }
    if (selfOnly) {
      this.assertSelf(tenant, entry.memberId, 'Yalnızca kendi bekleme listesi kaydınızı silebilirsiniz');
    } else {
      await this.assertScheduleBranch(tenant, entry.scheduleId);
    }
    const updated = await this.prisma.waitlist.updateMany({
      where: { id: entry.id, studioId: tenant.studioId, status: 'WAITING' },
      data: { status: 'CANCELLED', resolvedAt: new Date() },
    });
    if (updated.count === 0) {
      throw new BadRequestException('Bu kayıt artık beklemede değil');
    }
    return { id: entry.id, status: 'CANCELLED' as const };
  }

  /** Never lets a promotion problem fail the cancellation that freed the seat. */
  private async promoteFromWaitlistSafe(studioId: string, scheduleId: string): Promise<number> {
    try {
      return await this.promoteFromWaitlist(studioId, scheduleId);
    } catch (err) {
      this.logger.error(`Waitlist promotion failed for schedule ${scheduleId}: ${(err as Error).message}`);
      return 0;
    }
  }

  /**
   * Fills free seats from the head of the waitlist. Each entry is claimed
   * with a conditional WAITING -> OFFERED update so two concurrent
   * cancellations never promote the same member twice. An entry whose
   * package can no longer pay is marked EXPIRED with the reason and the next
   * one is tried.
   */
  async promoteFromWaitlist(studioId: string, scheduleId: string): Promise<number> {
    let promoted = 0;
    for (let attempt = 0; attempt < MAX_PROMOTION_ATTEMPTS; attempt++) {
      const schedule = await this.prisma.sessionSchedule.findFirst({ where: { id: scheduleId, studioId } });
      if (!schedule || schedule.isCancelled || schedule.startTime <= new Date()) break;
      if (schedule.bookedCount >= schedule.capacity) break;

      const next = await this.prisma.waitlist.findFirst({
        where: { studioId, scheduleId, status: 'WAITING' },
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      });
      if (!next) break;

      const claimed = await this.prisma.waitlist.updateMany({
        where: { id: next.id, status: 'WAITING' },
        data: { status: 'OFFERED', offeredAt: new Date() },
      });
      if (claimed.count === 0) continue;

      try {
        await this.book(studioId, {
          studioId,
          scheduleId,
          memberId: next.memberId,
          memberPackageId: next.memberPackageId ?? undefined,
          resourceIds: [],
        });
        // book() already marked the entry PROMOTED inside its transaction.
        promoted++;
        await this.notifyMember(studioId, next.memberId, 'WAITLIST', {
          title: 'Bekleme listesinden yer açıldı',
          body: `${schedule.title} seansına rezervasyonunuz onaylandı.`,
          data: { scheduleId, type: 'WAITLIST_PROMOTED' },
        });
      } catch (err) {
        if (err instanceof HttpException && err.message === CAPACITY_FULL) {
          // Someone took the seat first: put the entry back in line.
          await this.prisma.waitlist.updateMany({
            where: { id: next.id, status: 'OFFERED' },
            data: { status: 'WAITING', offeredAt: null },
          });
          break;
        }
        const reason = err instanceof HttpException ? err.message : 'Beklenmeyen hata';
        await this.prisma.waitlist.updateMany({
          where: { id: next.id, status: 'OFFERED' },
          data: { status: 'EXPIRED', resolvedAt: new Date(), failureReason: reason.slice(0, 200) },
        });
        if (!(err instanceof HttpException)) {
          this.logger.error(`Waitlist entry ${next.id} could not be promoted: ${(err as Error).message}`);
        }
        await this.notifyMember(studioId, next.memberId, 'WAITLIST', {
          title: 'Bekleme listesi',
          body: `${schedule.title} seansında yer açıldı ancak rezervasyon yapılamadı: ${reason}`,
          data: { scheduleId, type: 'WAITLIST_FAILED' },
        });
      }
    }
    return promoted;
  }

  // ---------------------------------------------------------------------------
  // Whole-session cancellation
  // ---------------------------------------------------------------------------

  /**
   * The business cancels the whole session: every confirmed booking becomes
   * a studio cancellation with a full refund, resources are released and the
   * waitlist is closed. The schedule row is flipped first inside the
   * transaction, which serializes against concurrent bookings (they update
   * the same row with isCancelled = false), so no booking slips through.
   */
  async cancelSession(tenant: TenantContext, actorUserId: string, scheduleId: string, dto: CancelSessionInput) {
    const studioId = tenant.studioId;
    await this.assertScheduleBranch(tenant, scheduleId);
    const reason = dto.reason ?? 'Seans işletme tarafından iptal edildi';
    const now = new Date();

    const result = await this.prisma.$transaction(async (tx) => {
      const flipped = await tx.sessionSchedule.updateMany({
        where: { id: scheduleId, studioId, isCancelled: false },
        data: { isCancelled: true, cancellationReason: dto.reason ?? null, bookedCount: 0 },
      });
      if (flipped.count === 0) {
        const exists = await tx.sessionSchedule.findFirst({ where: { id: scheduleId, studioId }, select: { id: true } });
        if (!exists) throw new NotFoundException('Ders seansı bulunamadı');
        throw new BadRequestException('Bu seans zaten iptal edilmiştir');
      }

      const schedule = await tx.sessionSchedule.findUniqueOrThrow({ where: { id: scheduleId } });
      const bookings = await tx.booking.findMany({
        where: { studioId, scheduleId, status: 'CONFIRMED' },
        include: { memberPackage: { select: { entitlementKind: true } } },
      });

      const cancelledMemberIds: string[] = [];
      for (const booking of bookings) {
        const transitioned = await tx.booking.updateMany({
          where: { id: booking.id, studioId, status: 'CONFIRMED' },
          data: {
            status: 'CANCELLED_EARLY',
            cancelledAt: now,
            cancellationReason: reason,
            isLateCancellation: false,
            penaltyUnits: 0,
          },
        });
        if (transitioned.count === 0) continue;
        if (booking.memberPackage && booking.memberPackage.entitlementKind !== 'TIME_UNLIMITED') {
          await this.refund(tx, studioId, booking.memberPackageId, booking.unitsCharged);
        }
        cancelledMemberIds.push(booking.memberId);
      }

      await tx.bookingResource.updateMany({
        where: { studioId, booking: { scheduleId } },
        data: { isActive: false },
      });
      const waitlist = await tx.waitlist.updateMany({
        where: { studioId, scheduleId, status: { in: ['WAITING', 'OFFERED'] } },
        data: { status: 'CANCELLED', resolvedAt: now, failureReason: 'Seans iptal edildi' },
      });

      await tx.auditLog.create({
        data: {
          studioId,
          userId: actorUserId,
          action: 'schedule.session.cancel',
          entityType: 'SessionSchedule',
          entityId: scheduleId,
          metadata: {
            reason: dto.reason ?? null,
            cancelledBookingCount: cancelledMemberIds.length,
            cancelledWaitlistCount: waitlist.count,
          },
        },
      });

      return { schedule, cancelledMemberIds, cancelledWaitlistCount: waitlist.count };
    });

    let membersNotified = 0;
    if (dto.notifyMembers) {
      const body = `${result.schedule.title} seansı işletme tarafından iptal edildi.${dto.reason ? ` Neden: ${dto.reason}` : ''} Kullandığınız hak paketinize iade edildi.`;
      for (const memberId of result.cancelledMemberIds) {
        const sent = await this.notifyMember(studioId, memberId, 'BOOKING_CHANGE', {
          title: 'Seans iptal edildi',
          body,
          data: { scheduleId, type: 'SESSION_CANCELLED' },
        });
        if (sent) membersNotified++;
      }
    }

    return {
      scheduleId,
      cancelledBookingCount: result.cancelledMemberIds.length,
      cancelledWaitlistCount: result.cancelledWaitlistCount,
      membersNotified,
    };
  }

  // ---------------------------------------------------------------------------
  // Trainer substitution
  // ---------------------------------------------------------------------------

  async substituteTrainer(tenant: TenantContext, actorUserId: string, scheduleId: string, dto: SubstituteTrainerInput) {
    const studioId = tenant.studioId;
    const schedule = await this.prisma.sessionSchedule.findFirst({ where: { id: scheduleId, studioId } });
    if (!schedule) {
      throw new NotFoundException('Ders seansı bulunamadı');
    }
    assertBranchAccess(tenant, schedule.branchId);
    if (schedule.isCancelled) {
      throw new BadRequestException('Bu seans iptal edilmiştir');
    }
    if (schedule.endTime <= new Date()) {
      throw new BadRequestException('Tamamlanmış bir seansın eğitmeni değiştirilemez');
    }
    if (schedule.trainerId === dto.trainerId) {
      throw new BadRequestException('Seçilen eğitmen zaten bu seansın eğitmeni');
    }

    const trainer = await this.prisma.trainerProfile.findFirst({
      where: { id: dto.trainerId, studioId, membership: { status: 'ACTIVE' } },
      include: { qualifications: true },
    });
    if (!trainer) {
      throw new NotFoundException('Eğitmen bulunamadı');
    }
    const serviceType = await this.prisma.serviceType.findFirst({ where: { id: schedule.serviceTypeId, studioId } });
    if (serviceType?.requiresQualification && !trainer.qualifications.some((q) => q.serviceTypeId === serviceType.id)) {
      throw new BadRequestException('Eğitmen bu hizmet için yetkin değil');
    }
    await this.assertNoConflict(studioId, schedule.startTime, schedule.endTime, dto.trainerId, undefined, schedule.id);

    // The first substitution remembers who was planned; switching back clears it.
    const plannedTrainerId = schedule.originalTrainerId ?? schedule.trainerId;
    const updated = await this.prisma.sessionSchedule.update({
      where: { id: schedule.id },
      data: {
        trainerId: dto.trainerId,
        originalTrainerId: plannedTrainerId === dto.trainerId ? null : plannedTrainerId,
      },
      include: { trainer: { include: { membership: { include: { user: true } } } } },
    });

    const trainerUser = updated.trainer?.membership.user;
    const trainerName = trainerUser ? `${trainerUser.firstName} ${trainerUser.lastName}`.trim() : 'yeni eğitmen';
    let membersNotified = 0;
    if (dto.notifyMembers) {
      const bookings = await this.prisma.booking.findMany({
        where: { studioId, scheduleId: schedule.id, status: 'CONFIRMED' },
        select: { memberId: true },
      });
      for (const b of bookings) {
        const sent = await this.notifyMember(studioId, b.memberId, 'BOOKING_CHANGE', {
          title: 'Eğitmen değişikliği',
          body: `${schedule.title} seansını ${trainerName} yürütecek.`,
          data: { scheduleId: schedule.id, type: 'TRAINER_SUBSTITUTED' },
        });
        if (sent) membersNotified++;
      }
    }
    if (trainerUser) {
      await this.notifyUserSafe(trainerUser.id, studioId, 'TRAINER_SCHEDULE', {
        title: 'Yeni seans atandı',
        body: `${schedule.title} seansı size atandı.`,
        data: { scheduleId: schedule.id, type: 'TRAINER_ASSIGNED' },
      });
    }

    await this.prisma.auditLog.create({
      data: {
        studioId,
        userId: actorUserId,
        action: 'schedule.trainer.substitute',
        entityType: 'SessionSchedule',
        entityId: schedule.id,
        metadata: { fromTrainerId: schedule.trainerId, toTrainerId: dto.trainerId, reason: dto.reason ?? null },
      },
    });

    return { schedule: updated, membersNotified };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /** Branch-restricted staff may only act on sessions of their branches. Missing rows are left to the caller's 404. */
  private async assertScheduleBranch(tenant: TenantContext, scheduleId: string) {
    if (tenant.branchIds === null) return;
    const schedule = await this.prisma.sessionSchedule.findFirst({
      where: { id: scheduleId, studioId: tenant.studioId },
      select: { branchId: true },
    });
    if (schedule) assertBranchAccess(tenant, schedule.branchId);
  }

  private async assertBookingBranch(tenant: TenantContext, bookingId: string) {
    if (tenant.branchIds === null) return;
    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, studioId: tenant.studioId },
      select: { schedule: { select: { branchId: true } } },
    });
    if (booking) assertBranchAccess(tenant, booking.schedule.branchId);
  }

  private assertSelf(tenant: TenantContext, memberId: string, message: string) {
    if (!tenant.memberProfileId || memberId !== tenant.memberProfileId) {
      throw new ForbiddenException(message);
    }
  }

  private async notifyMember(
    studioId: string,
    memberProfileId: string,
    category: NotificationCategory,
    message: { title: string; body: string; data?: Record<string, string> },
  ): Promise<boolean> {
    const profile = await this.prisma.memberProfile.findFirst({
      where: { id: memberProfileId, studioId },
      select: { membership: { select: { userId: true } } },
    });
    if (!profile) return false;
    return this.notifyUserSafe(profile.membership.userId, studioId, category, message);
  }

  /** Notifications are best effort: a provider outage must not undo a booking change. */
  private async notifyUserSafe(
    userId: string,
    studioId: string,
    category: NotificationCategory,
    message: { title: string; body: string; data?: Record<string, string> },
  ): Promise<boolean> {
    try {
      await this.notifications.notifyUser({ userId, studioId, category, message });
      return true;
    } catch (err) {
      this.logger.warn(`Notification ${category} to user ${userId} failed: ${(err as Error).message}`);
      return false;
    }
  }

  private async assertNoConflict(
    studioId: string,
    start: Date,
    end: Date,
    trainerId?: string,
    resourceId?: string,
    excludeScheduleId?: string,
  ) {
    const overlap = {
      startTime: { lt: end },
      endTime: { gt: start },
      ...(excludeScheduleId ? { id: { not: excludeScheduleId } } : {}),
    };

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
