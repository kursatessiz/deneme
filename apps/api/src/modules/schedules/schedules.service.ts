import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Logger,
  Optional,
} from '@nestjs/common';
import { CrmHooksService } from '../crm/hooks/crm-hooks.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { LocalizedNotice } from '../notifications/notifications.service';
import type { PushMessage } from '../notifications/push.service';
import { GamificationService } from '../gamification/gamification.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { VideoMeetingService } from '../video/providers/video-meeting.service';
import type { TenantContext } from '../auth/tenant-context';
import type {
  CreateScheduleInput,
  UpdateScheduleInput,
  BookSessionInput,
  CancelBookingInput,
  MarkNoShowInput,
  JoinWaitlistInput,
  LeaveWaitlistInput,
  SubstituteTrainerInput,
  CancelSessionInput,
  NotificationCategory,
  UpdateSessionMeetingInput,
  JoinSessionResultDTO,
} from '@platform/shared';
import { addZonedDays, isWithinJoinWindow, selectUsablePackage } from '@platform/shared';
import { Prisma, SessionDeliveryMode } from '@platform/database';
import type { Booking, BookingStatus, CancellationPolicy, MemberPackage } from '@platform/database';
import { evaluateCancellation, evaluateNoShow, FALLBACK_POLICY, PolicyTerms } from './cancellation-policy';
import { assertBranchAccess, branchScope } from '../branches/branch-access';
import { deriveSpotStatus, SpotOccupant } from './spots';
import { sortByClosestStart } from '../checkin/checkin-window';
import type { ApiErrorKey, ApiTextKey, BookingChargedPackageDTO, BookingNoticeDTO, ScheduleSpotsDTO, SpotGroupDTO } from '@platform/shared';
import { apiError, hasApiErrorCode } from '../../common/api-error';
import { errorMessageIn, requestLocale, requestT, serverT, studioLocale } from '../../common/server-i18n';
import type { ServerT } from '../../common/server-i18n';

const DAY_MS = 24 * 60 * 60 * 1000;
const CAPACITY_FULL = apiError('apiErrors.schedules.sessionFull');
/** Upper bound on entries tried per freed seat, so a long list of unusable entries cannot stall a request. */
const MAX_PROMOTION_ATTEMPTS = 20;

type Tx = Prisma.TransactionClient;

@Injectable()
export class SchedulesService {
  private readonly logger = new Logger(SchedulesService.name);

  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
    private gamification: GamificationService,
    private webhooks: WebhooksService,
    private videoMeeting: VideoMeetingService,
    @Optional() private crm?: CrmHooksService,
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
            // W20: lets staff label a partner-booked attendee with the
            // provider name (e.g. "ClassPass") instead of showing it as an
            // ordinary member.
            partnerConnection: { select: { provider: true, label: true } },
          },
        },
      },
      orderBy: { startTime: 'asc' },
    });

    return schedules.map((schedule) => {
      // The meeting link is never listed; it is only ever returned by
      // joinSession, within the join window, to a booked member.
      const { meetingProvider: _mp, meetingUrl: _mu, ...rest } = schedule;
      return {
        ...rest,
        bookings: schedule.bookings.map((booking) => this.maskBookingContact(booking, canViewContact)),
      };
    });
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
      deliveryMode: s.deliveryMode,
      onlineCapacity: s.onlineCapacity,
    }));
  }

  async createSchedule(tenant: TenantContext, dto: CreateScheduleInput) {
    const studioId = tenant.studioId;

    const serviceType = await this.prisma.serviceType.findFirst({
      where: { id: dto.serviceTypeId, studioId, isActive: true },
    });
    if (!serviceType) {
      throw new NotFoundException(apiError('apiErrors.common.serviceTypeNotFound'));
    }

    const start = new Date(dto.startTime);
    const end = new Date(dto.endTime);
    if (start >= end) {
      throw new BadRequestException(apiError('apiErrors.schedules.endTimeMustAfterStartTime'));
    }

    let branchId = dto.branchId ?? null;
    if (branchId) {
      const branch = await this.prisma.branch.findFirst({ where: { id: branchId, studioId, isActive: true } });
      if (!branch) {
        throw new BadRequestException(apiError('apiErrors.common.selectedBranchNotFoundBusinessInactive'));
      }
    }

    if (dto.resourceId) {
      const resource = await this.prisma.resource.findFirst({
        where: { id: dto.resourceId, studioId, isMaintenance: false },
      });
      if (!resource) {
        throw new BadRequestException(apiError('apiErrors.common.selectedResourceNotFoundBusinessUnder'));
      }
      if (resource.branchId && branchId && resource.branchId !== branchId) {
        throw new BadRequestException(apiError('apiErrors.schedules.selectedResourceBelongsAnotherBranch'));
      }
      // A room of a branch places the session in that branch.
      branchId = branchId ?? resource.branchId;
    }

    if (tenant.branchIds !== null && !branchId) {
      throw new BadRequestException(apiError('apiErrors.common.selectBranch'));
    }
    assertBranchAccess(tenant, branchId);

    if (dto.trainerId) {
      const trainer = await this.prisma.trainerProfile.findFirst({
        where: { id: dto.trainerId, studioId },
        include: { qualifications: true },
      });
      if (!trainer) {
        throw new NotFoundException(apiError('apiErrors.common.trainerNotFound'));
      }
      if (serviceType.requiresQualification) {
        const qualified = trainer.qualifications.some((q) => q.serviceTypeId === serviceType.id);
        if (!qualified) {
          throw new BadRequestException(apiError('apiErrors.schedules.trainerNotQualifiedService'));
        }
      }
    }

    const capacity = dto.capacity ?? serviceType.capacity;
    const recurCount = dto.isRecurring ? (dto.recurringWeeks ?? 1) : 1;

    // Weekly occurrences keep the same local wall time in the branch/studio zone,
    // so a daylight saving change does not shift a class by an hour.
    const timeZone = recurCount > 1 ? await this.scheduleTimeZone(studioId, branchId) : 'UTC';
    const slots: { start: Date; end: Date }[] = [];
    for (let i = 0; i < recurCount; i++) {
      slots.push({
        start: addZonedDays(start, i * 7, timeZone),
        end: addZonedDays(end, i * 7, timeZone),
      });
    }

    // ONLINE/HYBRID sessions get a meeting link up front. Recurring
    // occurrences share the same link, same as a recurring in-person room.
    const meeting =
      dto.deliveryMode === SessionDeliveryMode.IN_PERSON
        ? null
        : this.videoMeeting.createLink(dto.meetingProvider!, { scheduleId: '', studioId, manualUrl: dto.manualMeetingUrl });

    const created = await this.prisma.$transaction(async (tx) => {
      // Serialises schedule writes of the studio so the conflict check below
      // cannot interleave with a concurrent create (double-booked trainer or room).
      await this.lockScheduling(tx, studioId);
      for (const slot of slots) {
        await this.assertNoConflict(studioId, slot.start, slot.end, dto.trainerId, dto.resourceId, undefined, tx);
      }
      return Promise.all(
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
              deliveryMode: dto.deliveryMode,
              onlineCapacity: dto.onlineCapacity ?? null,
              meetingProvider: meeting?.provider ?? null,
              meetingUrl: meeting?.url ?? null,
            },
            include: { resource: true, trainer: { include: { membership: { include: { user: true } } } } },
          }),
        ),
      );
    });

    return created.length === 1 ? created[0] : created;
  }

  /**
   * Moves or edits a not-yet-cancelled session: calendar drag-drop sends
   * only the new startTime/endTime, the edit form may also change resource,
   * trainer, branch, title or capacity. Runs the same conflict and
   * branch-access checks as creation.
   */
  async updateSchedule(tenant: TenantContext, scheduleId: string, dto: UpdateScheduleInput) {
    const studioId = tenant.studioId;
    const schedule = await this.prisma.sessionSchedule.findFirst({ where: { id: scheduleId, studioId } });
    if (!schedule) {
      throw new NotFoundException(apiError('apiErrors.schedules.sessionNotFound'));
    }
    if (schedule.isCancelled) {
      throw new BadRequestException(apiError('apiErrors.schedules.cancelledSessionCannotUpdated'));
    }
    assertBranchAccess(tenant, schedule.branchId);

    const start = dto.startTime ? new Date(dto.startTime) : schedule.startTime;
    const end = dto.endTime ? new Date(dto.endTime) : schedule.endTime;
    if (start >= end) {
      throw new BadRequestException(apiError('apiErrors.schedules.endTimeMustAfterStartTime'));
    }

    let branchId = dto.branchId !== undefined ? dto.branchId : schedule.branchId;
    const resourceId = dto.resourceId !== undefined ? dto.resourceId : schedule.resourceId;
    const trainerId = dto.trainerId !== undefined ? dto.trainerId : schedule.trainerId;

    if (branchId) {
      const branch = await this.prisma.branch.findFirst({ where: { id: branchId, studioId, isActive: true } });
      if (!branch) throw new BadRequestException(apiError('apiErrors.common.selectedBranchNotFoundBusinessInactive'));
    }

    if (resourceId) {
      const resource = await this.prisma.resource.findFirst({ where: { id: resourceId, studioId, isMaintenance: false } });
      if (!resource) throw new BadRequestException(apiError('apiErrors.common.selectedResourceNotFoundBusinessUnder'));
      if (resource.branchId && branchId && resource.branchId !== branchId) {
        throw new BadRequestException(apiError('apiErrors.schedules.selectedResourceBelongsAnotherBranch'));
      }
      branchId = branchId ?? resource.branchId;
    }
    assertBranchAccess(tenant, branchId);

    if (trainerId) {
      const trainer = await this.prisma.trainerProfile.findFirst({ where: { id: trainerId, studioId } });
      if (!trainer) throw new NotFoundException(apiError('apiErrors.common.trainerNotFound'));
    }

    const timeChanged = start.getTime() !== schedule.startTime.getTime() || end.getTime() !== schedule.endTime.getTime();

    const { updated, activeBookings } = await this.prisma.$transaction(async (tx) => {
      await this.lockScheduling(tx, studioId);
      await this.assertNoConflict(studioId, start, end, trainerId ?? undefined, resourceId ?? undefined, scheduleId, tx);

      const active = await tx.booking.findMany({
        where: { scheduleId, studioId, status: { in: ['CONFIRMED', 'ATTENDED'] } },
        select: { memberId: true },
      });
      // A session people already booked cannot move into the past.
      if (timeChanged && active.length > 0 && start <= new Date()) {
        throw new BadRequestException(apiError('apiErrors.schedules.sessionBookingsCannotMovedPastTime'));
      }
      // Capacity never drops below the seats already taken.
      if (dto.capacity !== undefined && dto.capacity < active.length) {
        throw new BadRequestException(apiError('apiErrors.schedules.capacityBelowBookings', { count: active.length }));
      }

      const row = await tx.sessionSchedule.update({
        where: { id: scheduleId },
        data: {
          branchId,
          resourceId,
          trainerId,
          title: dto.title ?? schedule.title,
          startTime: start,
          endTime: end,
          capacity: dto.capacity ?? schedule.capacity,
        },
        include: { resource: true, trainer: { include: { membership: { include: { user: true } } } } },
      });

      // The spot/equipment holds follow the session, otherwise they would keep
      // blocking (and guarding) the old time slot.
      if (timeChanged) {
        try {
          await tx.bookingResource.updateMany({
            where: { studioId, booking: { scheduleId } },
            data: { startTime: start, endTime: end },
          });
        } catch (err) {
          if (this.isExclusionViolation(err)) {
            throw new ConflictException(apiError('apiErrors.schedules.selectedEquipmentTakenTime'));
          }
          throw err;
        }
      }
      return { updated: row, activeBookings: active };
    });

    // More seats than before: fill them from the waitlist (best effort).
    if (dto.capacity !== undefined && dto.capacity > schedule.capacity) {
      await this.promoteFromWaitlistSafe(studioId, scheduleId);
    }

    // Tell booked members the new time (best effort, never undoes the move).
    if (timeChanged && activeBookings.length > 0) {
      const studio = await this.prisma.studio.findUnique({ where: { id: studioId }, select: { timezone: true } });
      const timeZone = studio?.timezone ?? 'Europe/Istanbul';
      for (const b of activeBookings) {
        await this.notifyMember(studioId, b.memberId, 'BOOKING_CHANGE', {
          titleKey: 'apiTexts.notify.sessionMoved.title',
          bodyKey: 'apiTexts.notify.sessionMoved.body',
          // Date and time follow the recipient's language, like the sentence around them.
          bodyParams: ({ locale }) => ({ when: new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(start) }),
          data: { type: 'SESSION_MOVED', scheduleId },
        });
      }
    }

    return updated;
  }

  /**
   * Staff booking. `actorUserId` is the staff user, recorded when the booking
   * overrides the minimum repeat interval (`dto.overrideRepeatInterval`).
   * The response is the booking plus informational `notices`.
   */
  async bookSession(
    tenant: TenantContext,
    dto: BookSessionInput,
    actorUserId: string | null = null,
    options: { freeOfCharge?: boolean } = {},
  ) {
    await this.assertScheduleBranch(tenant, dto.scheduleId);
    const { booking, notices, chargedPackage } = await this.book(tenant.studioId, dto, 'staff', actorUserId, options.freeOfCharge === true);
    await this.emitBookingCreated(tenant.studioId, booking);
    return { ...booking, notices, chargedPackage };
  }

  /** Members booking for themselves; enforces dto.memberId matches the caller's own profile. */
  async bookSessionSelf(tenant: TenantContext, dto: BookSessionInput) {
    this.assertSelf(tenant, dto.memberId, 'apiErrors.schedules.canOnlyBookYourself');
    const { booking, notices, chargedPackage } = await this.book(tenant.studioId, dto, 'self');
    await this.emitBookingCreated(tenant.studioId, booking);
    return { ...booking, notices, chargedPackage };
  }

  private async emitBookingCreated(studioId: string, booking: { id: string; scheduleId: string; memberId: string }): Promise<void> {
    await this.crm?.onBookingEvent(studioId, booking.id, 'booking_created');
    await this.webhooks.emit(studioId, 'booking.created', {
      bookingId: booking.id,
      scheduleId: booking.scheduleId,
      memberId: booking.memberId,
    });
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
      throw new NotFoundException(apiError('apiErrors.schedules.sessionNotFound'));
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
      include: {
        booking: {
          include: {
            member: { include: { membership: { include: { user: true } } } },
            // W20: labels a partner-booked spot holder with the provider
            // name for staff, instead of showing them as an ordinary member.
            partnerConnection: { select: { provider: true, label: true } },
          },
        },
      },
    });

    const occupantsByResource = new Map<string, SpotOccupant[]>();
    for (const hold of activeHolds) {
      const list = occupantsByResource.get(hold.resourceId) ?? [];
      const user = hold.booking.member.membership.user;
      const baseName = `${user.firstName} ${user.lastName}`.trim();
      const memberName = hold.booking.partnerConnection
        ? `${baseName} (${hold.booking.partnerConnection.label} - ${hold.booking.partnerConnection.provider})`
        : baseName;
      list.push({ memberId: hold.booking.memberId, memberName });
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
      throw new NotFoundException(apiError('apiErrors.common.bookingNotFound'));
    }
    this.assertSelf(tenant, booking.memberId, 'apiErrors.schedules.canOnlyMoveOwnBooking');
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
        throw new NotFoundException(apiError('apiErrors.common.bookingNotFound'));
      }
      if (booking.status !== 'CONFIRMED') {
        throw new BadRequestException(apiError('apiErrors.schedules.onlyConfirmedBookingsCanMoved'));
      }

      await tx.bookingResource.deleteMany({ where: { studioId, bookingId: booking.id } });

      for (const resourceId of resourceIds) {
        const resource = await tx.resource.findFirst({ where: { id: resourceId, studioId } });
        if (!resource) {
          throw new BadRequestException(apiError('apiErrors.schedules.selectedResourceNotFound'));
        }
        if (resource.isMaintenance) {
          throw new BadRequestException(apiError('apiErrors.schedules.selectedSpotUnderMaintenance'));
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
            throw new ConflictException(apiError('apiErrors.schedules.selectedSpotTakenTime'));
          }
          throw err;
        }
      }

      return tx.bookingResource.findMany({ where: { studioId, bookingId: booking.id } });
    });
  }

  /**
   * `actor` decides the time rule: a member (`self`) cannot book a session that
   * has started, staff (`staff`, reception walk-ins) cannot book one that has
   * ended, and the waitlist promotion (`system`) is bounded by its own check.
   *
   * Package rule: the booking is charged to `dto.memberPackageId`, or, when none
   * is given, to the member's soonest-expiring usable package (no usable package
   * is a 400). Only staff may opt out with `dto.chargePackage === false`
   * (audited as booking.no_charge); `freeOfCharge` is the internal opt-out for
   * flows that legitimately book without a package (CRM trial session).
   */
  private async book(
    studioId: string,
    dto: BookSessionInput,
    actor: 'self' | 'staff' | 'system' = 'staff',
    actorUserId: string | null = null,
    freeOfCharge = false,
  ): Promise<{ booking: Booking; notices: BookingNoticeDTO[]; chargedPackage: BookingChargedPackageDTO | null }> {
    // Only staff may waive the repeat interval; a member asking for it is refused outright.
    if (actor === 'self' && dto.overrideRepeatInterval) {
      throw new ForbiddenException(apiError('apiErrors.schedules.repeatOverrideNotAllowed'));
    }
    // Only staff may book without charging a package.
    if (dto.chargePackage === false && actor !== 'staff') {
      throw new ForbiddenException(apiError('apiErrors.schedules.noChargeNotAllowed'));
    }
    const skipCharge = freeOfCharge || dto.chargePackage === false;
    const schedule = await this.prisma.sessionSchedule.findFirst({
      where: { id: dto.scheduleId, studioId },
      include: { serviceType: { include: { requiredResourceTypes: { include: { resourceType: true } } } } },
    });
    if (!schedule) {
      throw new NotFoundException(apiError('apiErrors.schedules.sessionNotFound'));
    }
    if (schedule.isCancelled) {
      throw new BadRequestException(apiError('apiErrors.schedules.sessionCancelled'));
    }

    const nowForBooking = new Date();
    if (actor === 'self' && schedule.startTime <= nowForBooking) {
      throw new BadRequestException(apiError('apiErrors.schedules.sessionAlreadyStarted'));
    }
    if (actor === 'staff' && schedule.endTime <= nowForBooking) {
      throw new BadRequestException(apiError('apiErrors.schedules.sessionAlreadyEnded'));
    }

    const requiresSelectableSpot = (schedule.serviceType.requiredResourceTypes ?? []).some(
      (r) => r.resourceType.selectableByMember,
    );
    if (requiresSelectableSpot && (!dto.resourceIds || dto.resourceIds.length === 0)) {
      throw new BadRequestException(apiError('apiErrors.schedules.mustChooseSpotService'));
    }

    const member = await this.prisma.memberProfile.findFirst({ where: { id: dto.memberId, studioId } });
    if (!member) {
      throw new NotFoundException(apiError('apiErrors.common.memberNotFound'));
    }

    // ServiceType.minRepeatIntervalDays: no second live booking of the same
    // service within that many days of this session (either side). NO_SHOW
    // bookings do not count; they only produce an informational notice.
    // Staff may waive the rule with dto.overrideRepeatInterval (audited below).
    const notices: BookingNoticeDTO[] = [];
    let overriddenBooking: { id: string; startTime: Date } | null = null;
    const minDays = schedule.serviceType.minRepeatIntervalDays;
    if (minDays && minDays > 0) {
      const windowMs = minDays * DAY_MS;
      const inWindow = (status: BookingStatus[]) => ({
        studioId,
        memberId: dto.memberId,
        scheduleId: { not: dto.scheduleId },
        status: { in: status },
        schedule: {
          serviceTypeId: schedule.serviceTypeId,
          isCancelled: false,
          startTime: { gt: new Date(schedule.startTime.getTime() - windowMs), lt: new Date(schedule.startTime.getTime() + windowMs) },
        },
      });
      const tooClose = await this.prisma.booking.findFirst({
        where: inWindow(['CONFIRMED', 'ATTENDED']),
        orderBy: { schedule: { startTime: 'desc' } },
        select: { id: true, schedule: { select: { startTime: true } } },
      });
      if (tooClose) {
        if (actor === 'staff' && dto.overrideRepeatInterval) {
          overriddenBooking = { id: tooClose.id, startTime: tooClose.schedule.startTime };
        } else {
          throw new BadRequestException(
            apiError('apiErrors.schedules.minRepeatIntervalNotElapsed', {
              count: minDays,
              // ISO instant of the conflicting session; clients format it in their own language.
              date: tooClose.schedule.startTime.toISOString(),
            }),
          );
        }
      }
      if (actor !== 'system') {
        const noShow = await this.prisma.booking.findFirst({
          where: inWindow(['NO_SHOW']),
          orderBy: { schedule: { startTime: 'desc' } },
          select: { schedule: { select: { startTime: true } } },
        });
        if (noShow) {
          const studio = await this.prisma.studio.findUnique({ where: { id: studioId }, select: { timezone: true } });
          const date = new Intl.DateTimeFormat(requestLocale(), { dateStyle: 'medium', timeZone: studio?.timezone ?? 'UTC' }).format(noShow.schedule.startTime);
          notices.push({
            code: 'apiTexts.schedules.noShowInWindowNotice',
            message: requestT()('apiTexts.schedules.noShowInWindowNotice', { date }),
            params: { date },
          });
        }
      }
    }

    const { memberPackage, unitCost } = skipCharge
      ? { memberPackage: null, unitCost: 0 }
      : dto.memberPackageId || schedule.serviceType.allowedEntitlementKinds.length === 0
        ? await this.resolvePackage(studioId, dto.memberId, dto.memberPackageId, schedule.serviceTypeId)
        : await this.autoSelectPackage(studioId, dto.memberId, schedule.serviceTypeId, schedule.serviceType.allowedEntitlementKinds);
    const chargedPackageId = memberPackage?.id;

    const booking = await this.prisma.$transaction(async (tx) => {
      if (memberPackage && memberPackage.entitlementKind !== 'TIME_UNLIMITED' && unitCost > 0) {
        // Atomic conditional decrement: concurrent bookings on the same package
        // cannot spend the same units twice.
        const charged = await tx.memberPackage.updateMany({
          where: { id: memberPackage.id, studioId, status: 'ACTIVE', remainingUnits: { gte: unitCost } },
          data: { usedUnits: { increment: unitCost }, remainingUnits: { decrement: unitCost } },
        });
        if (charged.count === 0) {
          throw new BadRequestException(apiError('apiErrors.schedules.packageNoSessionsCreditsLeft'));
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
        booking = await this.upsertBooking(tx, studioId, dto.scheduleId, dto.memberId, chargedPackageId, unitCost);
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw new ConflictException(apiError('apiErrors.schedules.memberAlreadyBookedIntoSession'));
        }
        throw err;
      }

      for (const resourceId of dto.resourceIds ?? []) {
        const resource = await tx.resource.findFirst({ where: { id: resourceId, studioId } });
        if (!resource) {
          throw new BadRequestException(apiError('apiErrors.schedules.selectedResourceNotFound'));
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
            throw new ConflictException(apiError('apiErrors.schedules.selectedEquipmentTakenTime'));
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

    if (overriddenBooking) {
      await this.prisma.auditLog.create({
        data: {
          studioId,
          userId: actorUserId,
          action: 'booking.repeat_interval_override',
          entityType: 'Booking',
          entityId: booking.id,
          metadata: {
            serviceTypeId: schedule.serviceTypeId,
            memberId: dto.memberId,
            scheduleId: dto.scheduleId,
            conflictingBookingId: overriddenBooking.id,
            conflictingSessionStart: overriddenBooking.startTime.toISOString(),
            minRepeatIntervalDays: minDays,
          },
        },
      });
    }

    if (dto.chargePackage === false) {
      await this.prisma.auditLog.create({
        data: {
          studioId,
          userId: actorUserId,
          action: 'booking.no_charge',
          entityType: 'Booking',
          entityId: booking.id,
          metadata: { serviceTypeId: schedule.serviceTypeId, memberId: dto.memberId, scheduleId: dto.scheduleId },
        },
      });
    }

    let chargedPackage: BookingChargedPackageDTO | null = null;
    if (chargedPackageId) {
      const used = await this.prisma.memberPackage.findFirst({
        where: { id: chargedPackageId, studioId },
        include: { packageDefinition: { select: { name: true } } },
      });
      if (used) {
        chargedPackage = {
          memberPackageId: used.id,
          packageName: used.packageDefinition.name,
          entitlementKind: used.entitlementKind,
          unitsCharged: booking.unitsCharged,
          remainingUnits: used.remainingUnits,
        };
      }
    }
    return { booking, notices, chargedPackage };
  }

  /**
   * Picks the package a booking without `memberPackageId` is charged to: the
   * member's usable package that expires soonest (see selectUsablePackage).
   */
  private async autoSelectPackage(
    studioId: string,
    memberId: string,
    serviceTypeId: string,
    allowedKinds: MemberPackage['entitlementKind'][],
  ): Promise<{ memberPackage: MemberPackage; unitCost: number }> {
    const now = new Date();
    const packages = await this.prisma.memberPackage.findMany({
      where: { studioId, memberId, status: 'ACTIVE', endDate: { gt: now } },
      include: { packageDefinition: { include: { services: { where: { serviceTypeId } } } } },
    });
    const candidates = packages.map((p) => ({
      ...p,
      unitCost: p.packageDefinition.services[0]?.unitCost ?? null,
    }));
    const picked = selectUsablePackage(candidates, allowedKinds, now);
    if (!picked || picked.unitCost === null) {
      throw new BadRequestException(apiError('apiErrors.schedules.noUsablePackage'));
    }
    return { memberPackage: picked, unitCost: picked.unitCost };
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
      throw new BadRequestException(apiError('apiErrors.common.selectedPackageNotBelongMember'));
    }
    if (memberPackage.status !== 'ACTIVE') {
      throw new BadRequestException(apiError('apiErrors.schedules.packageNotActive', { status: memberPackage.status }));
    }
    if (new Date() > memberPackage.endDate) {
      throw new BadRequestException(apiError('apiErrors.schedules.packageExpired'));
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
      throw new BadRequestException(apiError('apiErrors.schedules.selectedPackageNotCoverService'));
    }
    const unitCost = coverage.unitCost;

    if (memberPackage.entitlementKind !== 'TIME_UNLIMITED' && (memberPackage.remainingUnits ?? 0) < unitCost) {
      throw new BadRequestException(apiError('apiErrors.schedules.packageNoSessionsCreditsLeft'));
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
      throw new NotFoundException(apiError('apiErrors.common.bookingNotFound'));
    }
    this.assertSelf(tenant, booking.memberId, 'apiErrors.schedules.canOnlyCancelOwnBooking');
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
      throw new NotFoundException(apiError('apiErrors.common.bookingNotFound'));
    }
    if (booking.status !== 'CONFIRMED') {
      throw new BadRequestException(apiError('apiErrors.schedules.onlyConfirmedBookingsCanCancelled'));
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
        throw new ConflictException(apiError('apiErrors.schedules.bookingAlreadyUpdated'));
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

    await this.crm?.onBookingEvent(studioId, updatedBooking.id, 'booking_cancelled');
    await this.webhooks.emit(studioId, 'booking.cancelled', {
      bookingId: updatedBooking.id,
      scheduleId: updatedBooking.scheduleId,
      memberId: updatedBooking.memberId,
      isLateCancellation: outcome.isLate,
    });

    return {
      booking: updatedBooking,
      isLateCancellation: outcome.isLate,
      refundedUnits: outcome.refundUnits,
      penaltyUnits: outcome.penaltyUnits,
      creditRefunded: outcome.refundUnits > 0,
      promotedFromWaitlist: promoted,
      ...this.cancellationMessage(outcome.isLate, outcome.refundUnits, outcome.penaltyUnits, policy),
    };
  }

  /** Result text of a cancellation, in the requester's language; `messageKey` and `messageParams` let a client re-render it. */
  private cancellationMessage(
    isLate: boolean,
    refund: number,
    penalty: number,
    policy: PolicyTerms,
  ): { message: string; messageKey: ApiTextKey; messageParams?: Record<string, number> } {
    const t = requestT();
    const result = (key: ApiTextKey, params?: Record<string, number>) => ({ message: t(key, params), messageKey: key, ...(params ? { messageParams: params } : {}) });
    if (!isLate) return result(refund > 0 ? 'apiTexts.cancel.cancelledRefunded' : 'apiTexts.cancel.cancelled');
    if (penalty === 0) return result(refund > 0 ? 'apiTexts.cancel.lateNoPenaltyRefunded' : 'apiTexts.cancel.cancelled');
    if (policy.freeCancelHours > 0) {
      return refund > 0
        ? result('apiTexts.cancel.lateCharged.hoursRefunded', { hours: policy.freeCancelHours, penalty, refund })
        : result('apiTexts.cancel.lateCharged.hours', { hours: policy.freeCancelHours, penalty });
    }
    return refund > 0
      ? result('apiTexts.cancel.lateCharged.startedRefunded', { penalty, refund })
      : result('apiTexts.cancel.lateCharged.started', { penalty });
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
      throw new NotFoundException(apiError('apiErrors.common.bookingNotFound'));
    }
    if (booking.status !== 'CONFIRMED') {
      throw new BadRequestException(apiError('apiErrors.schedules.onlyConfirmedBookingsCanMarkedAs'));
    }
    if (booking.schedule.startTime > new Date()) {
      throw new BadRequestException(apiError('apiErrors.schedules.noShowCannotMarkedBeforeSession'));
    }

    const policy = await this.resolvePolicy(studioId, booking.schedule.serviceType.cancellationPolicy);
    const outcome = evaluateNoShow({
      policy,
      unitsCharged: booking.unitsCharged,
      entitlementKind: booking.memberPackage?.entitlementKind ?? null,
      waivePenalty: dto.waivePenalty,
    });

    const result = await this.prisma.$transaction(async (tx) => {
      const transitioned = await tx.booking.updateMany({
        where: { id: booking.id, studioId, status: 'CONFIRMED' },
        data: { status: 'NO_SHOW', penaltyUnits: outcome.penaltyUnits },
      });
      if (transitioned.count === 0) {
        throw new ConflictException(apiError('apiErrors.schedules.bookingAlreadyUpdated'));
      }
      await this.refund(tx, studioId, booking.memberPackageId, outcome.refundUnits);
      const updated = await tx.booking.findUniqueOrThrow({ where: { id: booking.id } });
      return { booking: updated, refundedUnits: outcome.refundUnits, penaltyUnits: outcome.penaltyUnits };
    });
    await this.crm?.onBookingEvent(studioId, booking.id, 'no_show');
    return result;
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
      throw new NotFoundException(apiError('apiErrors.common.bookingNotFound'));
    }
    return this.doCheckIn(tenant.studioId, bookingId);
  }

  private async doCheckIn(studioId: string, bookingId: string) {
    const updated = await this.prisma.booking.updateMany({
      where: { id: bookingId, studioId, status: 'CONFIRMED' },
      data: { status: 'ATTENDED', checkInAt: new Date() },
    });
    if (updated.count === 0) {
      throw new BadRequestException(apiError('apiErrors.schedules.onlyConfirmedBookingsCanChecked'));
    }

    // Best-effort: streaks/milestones/badges must never fail a check-in.
    try {
      await this.gamification.onAttendance(bookingId);
    } catch (err) {
      this.logger.warn(`Gamification evaluation failed for booking ${bookingId}: ${(err as Error).message}`);
    }

    return this.emitAttended(studioId, bookingId);
  }

  private async emitAttended(studioId: string, bookingId: string) {
    // Best-effort like gamification: a trial attendance is a CRM conversion.
    await this.crm?.onBookingAttended(studioId, bookingId);
    const attended = await this.prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
    await this.webhooks.emit(studioId, 'booking.attended', {
      bookingId: attended.id,
      scheduleId: attended.scheduleId,
      memberId: attended.memberId,
    });
    return attended;
  }

  /**
   * Check-in entry point shared by the static/dynamic QR flows and the kiosk
   * (W17). Unlike the staff `checkIn` above, a re-scan of an already
   * attended booking is not an error: it is the common case (a member
   * walking back past the poster, or a flaky scan retried by the app).
   * Runs the same gamification hook as the staff check-in.
   */
  async checkInForMember(studioId: string, bookingId: string, expectedMemberId: string) {
    const booking = await this.prisma.booking.findFirst({ where: { id: bookingId, studioId } });
    if (!booking) {
      throw new NotFoundException(apiError('apiErrors.common.bookingNotFound'));
    }
    if (booking.memberId !== expectedMemberId) {
      throw new ForbiddenException(apiError('apiErrors.schedules.bookingNotBelong'));
    }
    if (booking.status === 'ATTENDED') {
      return booking;
    }

    const updated = await this.prisma.booking.updateMany({
      where: { id: bookingId, studioId, status: 'CONFIRMED' },
      data: { status: 'ATTENDED', checkInAt: new Date() },
    });
    if (updated.count === 0) {
      // A concurrent scan may have won the transition; that is still success.
      const current = await this.prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
      if (current.status === 'ATTENDED') return current;
      throw new BadRequestException(apiError('apiErrors.schedules.onlyConfirmedBookingsCanChecked'));
    }

    // Best-effort, same as the staff check-in: never fail a QR/kiosk check-in.
    try {
      await this.gamification.onAttendance(bookingId);
    } catch (err) {
      this.logger.warn(`Gamification evaluation failed for booking ${bookingId}: ${(err as Error).message}`);
    }

    return this.emitAttended(studioId, bookingId);
  }

  /**
   * Candidate CONFIRMED or already-ATTENDED bookings for a member that fall
   * inside the studio's check-in window, in the given branch (or a
   * branch-less schedule), ordered by how close the session start is to
   * now. Used by the QR/kiosk flows to resolve "the booking" for a scan
   * without asking the member to pick one when there is exactly one match;
   * including ATTENDED keeps a re-scan of the same window idempotent.
   */
  async findCheckInCandidates(
    studioId: string,
    memberId: string,
    /** null means every branch (unrestricted staff or a studio-wide kiosk/point). */
    allowedBranchIds: ReadonlySet<string> | null,
    windowStart: Date,
    windowEnd: Date,
  ) {
    const bookings = await this.prisma.booking.findMany({
      where: {
        studioId,
        memberId,
        // ATTENDED is included so a re-scan inside the same window finds the
        // booking it already checked in (idempotent), instead of reporting
        // "no reservation" once the first scan flips its status.
        status: { in: ['CONFIRMED', 'ATTENDED'] },
        schedule: {
          isCancelled: false,
          startTime: { gte: windowStart, lte: windowEnd },
          ...(allowedBranchIds
            ? { OR: [{ branchId: { in: [...allowedBranchIds] } }, { branchId: null }] }
            : {}),
        },
      },
      include: { schedule: true },
      orderBy: { schedule: { startTime: 'asc' } },
    });
    return sortByClosestStart(bookings, (b) => b.schedule.startTime, new Date());
  }

  // ---------------------------------------------------------------------------
  // W19: live online sessions
  // ---------------------------------------------------------------------------

  /** Staff sets or replaces a session's delivery mode and meeting link. */
  async updateSessionMeeting(tenant: TenantContext, scheduleId: string, dto: UpdateSessionMeetingInput) {
    await this.assertScheduleBranch(tenant, scheduleId);
    const schedule = await this.prisma.sessionSchedule.findFirst({ where: { id: scheduleId, studioId: tenant.studioId } });
    if (!schedule) {
      throw new NotFoundException(apiError('apiErrors.schedules.sessionNotFound'));
    }

    const meeting =
      dto.deliveryMode === SessionDeliveryMode.IN_PERSON
        ? null
        : this.videoMeeting.createLink(dto.meetingProvider!, {
            scheduleId,
            studioId: tenant.studioId,
            manualUrl: dto.manualMeetingUrl,
          });

    return this.prisma.sessionSchedule.update({
      where: { id: scheduleId },
      data: {
        deliveryMode: dto.deliveryMode,
        onlineCapacity: dto.onlineCapacity ?? null,
        meetingProvider: meeting?.provider ?? null,
        meetingUrl: meeting?.url ?? null,
      },
    });
  }

  /**
   * The only place a meeting link is ever handed out: to a member with a
   * CONFIRMED/ATTENDED booking on this session, only from
   * JOIN_WINDOW_MINUTES_BEFORE start until the session ends. Joining marks
   * attendance (idempotent - an already-ATTENDED booking just gets the link
   * again) so gamification and reports see the member as having shown up.
   */
  async joinSession(tenant: TenantContext, scheduleId: string): Promise<JoinSessionResultDTO> {
    if (!tenant.memberProfileId) {
      throw new ForbiddenException(apiError('apiErrors.schedules.onlyMembersCanJoin'));
    }
    const schedule = await this.prisma.sessionSchedule.findFirst({
      where: { id: scheduleId, studioId: tenant.studioId },
    });
    if (!schedule) {
      throw new NotFoundException(apiError('apiErrors.schedules.sessionNotFound'));
    }
    if (schedule.deliveryMode === SessionDeliveryMode.IN_PERSON || !schedule.meetingUrl) {
      throw new BadRequestException(apiError('apiErrors.schedules.sessionNotOpenOnlineAttendance'));
    }

    const booking = await this.prisma.booking.findFirst({
      where: {
        studioId: tenant.studioId,
        scheduleId,
        memberId: tenant.memberProfileId,
        status: { in: ['CONFIRMED', 'ATTENDED'] },
      },
    });
    if (!booking) {
      throw new ForbiddenException(apiError('apiErrors.schedules.mustConfirmedBookingJoinSession'));
    }

    const now = new Date();
    if (!isWithinJoinWindow(schedule.startTime, schedule.endTime, now)) {
      throw new BadRequestException(apiError('apiErrors.schedules.joinLinkCanOnlyUsed15'));
    }

    if (booking.status === 'CONFIRMED') {
      // Same idempotent member path as QR/kiosk: concurrent joins both succeed.
      await this.checkInForMember(tenant.studioId, booking.id, tenant.memberProfileId);
    }

    return {
      joinUrl: schedule.meetingUrl,
      scheduleId: schedule.id,
      startTime: schedule.startTime.toISOString(),
      endTime: schedule.endTime.toISOString(),
    };
  }

  // ---------------------------------------------------------------------------
  // Waitlist
  // ---------------------------------------------------------------------------

  async getWaitlist(tenant: TenantContext, scheduleId: string) {
    const schedule = await this.prisma.sessionSchedule.findFirst({ where: { id: scheduleId, studioId: tenant.studioId } });
    if (!schedule) {
      throw new NotFoundException(apiError('apiErrors.schedules.sessionNotFound'));
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
    this.assertSelf(tenant, dto.memberId, 'apiErrors.schedules.canOnlyJoinWaitlistYourself');
    return this.join(tenant.studioId, dto);
  }

  private async join(studioId: string, dto: JoinWaitlistInput) {
    const schedule = await this.prisma.sessionSchedule.findFirst({ where: { id: dto.scheduleId, studioId } });
    if (!schedule) {
      throw new NotFoundException(apiError('apiErrors.schedules.sessionNotFound'));
    }
    if (schedule.isCancelled) {
      throw new BadRequestException(apiError('apiErrors.schedules.sessionCancelled'));
    }
    if (schedule.startTime <= new Date()) {
      throw new BadRequestException(apiError('apiErrors.schedules.cannotJoinWaitlistSessionStarted'));
    }
    if (schedule.bookedCount < schedule.capacity) {
      throw new BadRequestException(apiError('apiErrors.schedules.roomSessionCanBookDirectly'));
    }

    const member = await this.prisma.memberProfile.findFirst({ where: { id: dto.memberId, studioId } });
    if (!member) {
      throw new NotFoundException(apiError('apiErrors.common.memberNotFound'));
    }
    const live = await this.prisma.booking.findFirst({
      where: { studioId, scheduleId: dto.scheduleId, memberId: dto.memberId, status: { in: ['CONFIRMED', 'ATTENDED'] } },
    });
    if (live) {
      throw new ConflictException(apiError('apiErrors.schedules.memberAlreadyBookedIntoSession'));
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
        throw new ConflictException(apiError('apiErrors.schedules.memberAlreadyWaitlist'));
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
          throw new ConflictException(apiError('apiErrors.schedules.memberAlreadyWaitlist'));
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
      throw new NotFoundException(apiError('apiErrors.schedules.waitlistEntryNotFound'));
    }
    if (selfOnly) {
      this.assertSelf(tenant, entry.memberId, 'apiErrors.schedules.canOnlyRemoveOwnWaitlistEntry');
    } else {
      await this.assertScheduleBranch(tenant, entry.scheduleId);
    }
    const updated = await this.prisma.waitlist.updateMany({
      where: { id: entry.id, studioId: tenant.studioId, status: 'WAITING' },
      data: { status: 'CANCELLED', resolvedAt: new Date() },
    });
    if (updated.count === 0) {
      throw new BadRequestException(apiError('apiErrors.schedules.entryNoLongerWaiting'));
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
        }, 'system');
        // book() already marked the entry PROMOTED inside its transaction.
        promoted++;
        await this.notifyMember(studioId, next.memberId, 'WAITLIST', {
          titleKey: 'apiTexts.notify.waitlistPromoted.title',
          bodyKey: 'apiTexts.notify.waitlistPromoted.body',
          bodyParams: { title: schedule.title },
          data: { scheduleId, type: 'WAITLIST_PROMOTED' },
        });
      } catch (err) {
        if (hasApiErrorCode(err, 'apiErrors.schedules.sessionFull')) {
          // Someone took the seat first: put the entry back in line.
          await this.prisma.waitlist.updateMany({
            where: { id: next.id, status: 'OFFERED' },
            data: { status: 'WAITING', offeredAt: null },
          });
          break;
        }
        // Stored for staff in the business language; the member's notification is written in their own.
        const reasonIn = (t: ServerT) => (err instanceof HttpException ? errorMessageIn(err, t) : t('apiTexts.notify.unexpectedError'));
        await this.prisma.waitlist.updateMany({
          where: { id: next.id, status: 'OFFERED' },
          data: { status: 'EXPIRED', resolvedAt: new Date(), failureReason: reasonIn(serverT(await studioLocale(this.prisma, studioId))).slice(0, 200) },
        });
        if (!(err instanceof HttpException)) {
          this.logger.error(`Waitlist entry ${next.id} could not be promoted: ${(err as Error).message}`);
        }
        await this.notifyMember(studioId, next.memberId, 'WAITLIST', {
          titleKey: 'apiTexts.notify.waitlistFailed.title',
          bodyKey: 'apiTexts.notify.waitlistFailed.body',
          bodyParams: ({ t }) => ({ title: schedule.title, reason: reasonIn(t) }),
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
    // Stored on each cancelled booking: written in the business language when the staff gave no reason.
    const reason = dto.reason ?? serverT(await studioLocale(this.prisma, studioId))('apiTexts.notify.sessionCancelled.defaultReason');
    const now = new Date();

    const result = await this.prisma.$transaction(async (tx) => {
      const flipped = await tx.sessionSchedule.updateMany({
        where: { id: scheduleId, studioId, isCancelled: false },
        data: { isCancelled: true, cancellationReason: dto.reason ?? null, bookedCount: 0 },
      });
      if (flipped.count === 0) {
        const exists = await tx.sessionSchedule.findFirst({ where: { id: scheduleId, studioId }, select: { id: true } });
        if (!exists) throw new NotFoundException(apiError('apiErrors.schedules.sessionNotFound'));
        throw new BadRequestException(apiError('apiErrors.schedules.sessionAlreadyCancelled'));
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
      for (const memberId of result.cancelledMemberIds) {
        const sent = await this.notifyMember(studioId, memberId, 'BOOKING_CHANGE', {
          titleKey: 'apiTexts.notify.sessionCancelled.title',
          bodyKey: dto.reason ? 'apiTexts.notify.sessionCancelled.bodyWithReason' : 'apiTexts.notify.sessionCancelled.body',
          bodyParams: { title: result.schedule.title, ...(dto.reason ? { reason: dto.reason } : {}) },
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
      throw new NotFoundException(apiError('apiErrors.schedules.sessionNotFound'));
    }
    assertBranchAccess(tenant, schedule.branchId);
    if (schedule.isCancelled) {
      throw new BadRequestException(apiError('apiErrors.schedules.sessionCancelled'));
    }
    if (schedule.endTime <= new Date()) {
      throw new BadRequestException(apiError('apiErrors.schedules.trainerCompletedSessionCannotChanged'));
    }
    if (schedule.trainerId === dto.trainerId) {
      throw new BadRequestException(apiError('apiErrors.schedules.selectedTrainerAlreadyTrainerSession'));
    }

    const trainer = await this.prisma.trainerProfile.findFirst({
      where: { id: dto.trainerId, studioId, membership: { status: 'ACTIVE' } },
      include: { qualifications: true },
    });
    if (!trainer) {
      throw new NotFoundException(apiError('apiErrors.common.trainerNotFound'));
    }
    const serviceType = await this.prisma.serviceType.findFirst({ where: { id: schedule.serviceTypeId, studioId } });
    if (serviceType?.requiresQualification && !trainer.qualifications.some((q) => q.serviceTypeId === serviceType.id)) {
      throw new BadRequestException(apiError('apiErrors.schedules.trainerNotQualifiedService'));
    }

    // The first substitution remembers who was planned; switching back clears it.
    const plannedTrainerId = schedule.originalTrainerId ?? schedule.trainerId;
    const updated = await this.prisma.$transaction(async (tx) => {
      await this.lockScheduling(tx, studioId);
      await this.assertNoConflict(studioId, schedule.startTime, schedule.endTime, dto.trainerId, undefined, schedule.id, tx);
      return tx.sessionSchedule.update({
        where: { id: schedule.id },
        data: {
          trainerId: dto.trainerId,
          originalTrainerId: plannedTrainerId === dto.trainerId ? null : plannedTrainerId,
        },
        include: { trainer: { include: { membership: { include: { user: true } } } } },
      });
    });

    const trainerUser = updated.trainer?.membership.user;
    const trainerFullName = trainerUser ? `${trainerUser.firstName} ${trainerUser.lastName}`.trim() : '';
    let membersNotified = 0;
    if (dto.notifyMembers) {
      const bookings = await this.prisma.booking.findMany({
        where: { studioId, scheduleId: schedule.id, status: 'CONFIRMED' },
        select: { memberId: true },
      });
      for (const b of bookings) {
        const sent = await this.notifyMember(studioId, b.memberId, 'BOOKING_CHANGE', {
          titleKey: 'apiTexts.notify.trainerChanged.title',
          bodyKey: 'apiTexts.notify.trainerChanged.body',
          bodyParams: ({ t }) => ({ title: schedule.title, trainer: trainerFullName || t('apiTexts.notify.trainerChanged.fallbackName') }),
          data: { scheduleId: schedule.id, type: 'TRAINER_SUBSTITUTED' },
        });
        if (sent) membersNotified++;
      }
    }
    if (trainerUser) {
      await this.notifyUserSafe(trainerUser.id, studioId, 'TRAINER_SCHEDULE', {
        titleKey: 'apiTexts.notify.trainerAssigned.title',
        bodyKey: 'apiTexts.notify.trainerAssigned.body',
        bodyParams: { title: schedule.title },
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

  private assertSelf(tenant: TenantContext, memberId: string, messageKey: ApiErrorKey) {
    if (!tenant.memberProfileId || memberId !== tenant.memberProfileId) {
      throw new ForbiddenException(apiError(messageKey));
    }
  }

  private async notifyMember(
    studioId: string,
    memberProfileId: string,
    category: NotificationCategory,
    message: PushMessage | LocalizedNotice,
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
    message: PushMessage | LocalizedNotice,
  ): Promise<boolean> {
    try {
      await this.notifications.notifyUser({ userId, studioId, category, message });
      return true;
    } catch (err) {
      this.logger.warn(`Notification ${category} to user ${userId} failed: ${(err as Error).message}`);
      return false;
    }
  }

  /**
   * Transaction-scoped advisory lock per studio: creates, moves and trainer
   * substitutions take it before their conflict check, so two of them cannot
   * both pass the check and then both write (no schema change needed).
   */
  private async lockScheduling(tx: Tx, studioId: string): Promise<void> {
    await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${'schedule-conflict:' + studioId}))`);
  }

  /** IANA zone of a session: its branch's zone, else the studio's. */
  private async scheduleTimeZone(studioId: string, branchId: string | null): Promise<string> {
    if (branchId) {
      const branch = await this.prisma.branch.findFirst({ where: { id: branchId, studioId }, select: { timezone: true } });
      if (branch?.timezone) return branch.timezone;
    }
    const studio = await this.prisma.studio.findUnique({ where: { id: studioId }, select: { timezone: true } });
    return studio?.timezone ?? 'UTC';
  }

  private async assertNoConflict(
    studioId: string,
    start: Date,
    end: Date,
    trainerId?: string,
    resourceId?: string,
    excludeScheduleId?: string,
    db: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const overlap = {
      startTime: { lt: end },
      endTime: { gt: start },
      ...(excludeScheduleId ? { id: { not: excludeScheduleId } } : {}),
    };

    if (trainerId) {
      const trainerConflict = await db.sessionSchedule.findFirst({
        where: { studioId, trainerId, isCancelled: false, ...overlap },
      });
      if (trainerConflict) {
        throw new ConflictException(apiError('apiErrors.schedules.selectedTrainerAnotherSessionTimeRange'));
      }
    }

    if (resourceId) {
      const resourceConflict = await db.sessionSchedule.findFirst({
        where: { studioId, resourceId, isCancelled: false, ...overlap },
      });
      if (resourceConflict) {
        throw new ConflictException(apiError('apiErrors.schedules.selectedResourceTakenTimeRange'));
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
