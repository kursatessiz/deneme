import { Test, TestingModule } from '@nestjs/testing';
import { SchedulesService } from './schedules.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { GamificationService } from '../gamification/gamification.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { VideoMeetingService } from '../video/providers/video-meeting.service';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { TenantContext } from '../auth/tenant-context';

describe('SchedulesService', () => {
  let service: SchedulesService;

  const STUDIO_ID = 'studio-1';

  const tenant: TenantContext = {
    studioId: STUDIO_ID,
    membershipId: 'membership-1',
    isOwner: true,
    isSuperAdmin: false,
    permissions: new Set(['schedule.manage', 'schedule.view', 'bookings.manage', 'attendance.manage']),
    memberProfileId: null,
    trainerProfileId: null,
    branchIds: null,
  };

  const mockPrisma = {
    serviceType: {
      findFirst: jest.fn(),
    },
    resource: {
      findFirst: jest.fn(),
    },
    trainerProfile: {
      findFirst: jest.fn(),
    },
    studio: {
      findUnique: jest.fn(),
    },
    branch: {
      findFirst: jest.fn(),
    },
    sessionSchedule: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    memberProfile: {
      findFirst: jest.fn(),
    },
    memberPackage: {
      findFirst: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    packageDefinitionService: {
      findUnique: jest.fn(),
    },
    booking: {
      findFirst: jest.fn(),
      findFirstOrThrow: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    bookingResource: {
      create: jest.fn(),
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    waitlist: {
      findFirst: jest.fn(),
      updateMany: jest.fn(),
    },
    cancellationPolicy: {
      findFirst: jest.fn(),
    },
    $executeRaw: jest.fn(),
    $transaction: jest.fn((callback) => callback(mockPrisma)),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SchedulesService,
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
        {
          provide: NotificationsService,
          useValue: { notifyUser: jest.fn() },
        },
        {
          provide: GamificationService,
          useValue: { onAttendance: jest.fn() },
        },
        {
          provide: WebhooksService,
          useValue: { emit: jest.fn() },
        },
        {
          provide: VideoMeetingService,
          useValue: { createLink: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<SchedulesService>(SchedulesService);
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation((callback) => callback(mockPrisma));
  });

  describe('createSchedule', () => {
    it('should throw ConflictException if trainer has another class at the same time', async () => {
      const now = new Date();
      const oneHourLater = new Date(now.getTime() + 60 * 60 * 1000);

      mockPrisma.serviceType.findFirst.mockResolvedValueOnce({
        id: 'service-1',
        studioId: STUDIO_ID,
        capacity: 1,
        requiresQualification: false,
        isActive: true,
      });
      mockPrisma.trainerProfile.findFirst.mockResolvedValueOnce({
        id: 'trainer-1',
        studioId: STUDIO_ID,
        qualifications: [],
      });
      mockPrisma.sessionSchedule.findFirst.mockResolvedValueOnce({
        id: 'existing-schedule',
        trainerId: 'trainer-1',
      });

      await expect(
        service.createSchedule(tenant, {
          studioId: STUDIO_ID,
          trainerId: 'trainer-1',
          serviceTypeId: 'service-1',
          title: 'Klinik Pilates',
          startTime: now.toISOString(),
          endTime: oneHourLater.toISOString(),
          isRecurring: false,
          resourceIds: [],
        } as any),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw BadRequestException if end time is before start time', async () => {
      const now = new Date();
      const past = new Date(now.getTime() - 60 * 60 * 1000);

      mockPrisma.serviceType.findFirst.mockResolvedValueOnce({
        id: 'service-1',
        studioId: STUDIO_ID,
        capacity: 1,
        requiresQualification: false,
        isActive: true,
      });

      await expect(
        service.createSchedule(tenant, {
          studioId: STUDIO_ID,
          serviceTypeId: 'service-1',
          title: 'Hatalı Saat',
          startTime: now.toISOString(),
          endTime: past.toISOString(),
          isRecurring: false,
        } as any),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('bookSession', () => {
    const schedule = {
      id: 'schedule-1',
      studioId: STUDIO_ID,
      serviceTypeId: 'service-1',
      capacity: 5,
      bookedCount: 0,
      isCancelled: false,
      startTime: new Date(Date.now() + 60 * 60 * 1000),
      endTime: new Date(Date.now() + 2 * 60 * 60 * 1000),
      serviceType: { id: 'service-1', requiredResourceTypes: [], minRepeatIntervalDays: null },
    };

    it('should reject a package that belongs to another member', async () => {
      mockPrisma.sessionSchedule.findFirst.mockResolvedValueOnce(schedule);
      mockPrisma.memberProfile.findFirst.mockResolvedValueOnce({ id: 'member-1', studioId: STUDIO_ID });
      mockPrisma.memberPackage.findFirst.mockResolvedValueOnce({
        id: 'pkg-1',
        memberId: 'other-member',
        studioId: STUDIO_ID,
        status: 'ACTIVE',
        endDate: new Date(Date.now() + 10_000_000),
      });

      await expect(
        service.bookSession(tenant, {
          studioId: STUDIO_ID,
          scheduleId: 'schedule-1',
          memberId: 'member-1',
          memberPackageId: 'pkg-1',
          resourceIds: [],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject when the service is not covered by the package', async () => {
      mockPrisma.sessionSchedule.findFirst.mockResolvedValueOnce(schedule);
      mockPrisma.memberProfile.findFirst.mockResolvedValueOnce({ id: 'member-1', studioId: STUDIO_ID });
      mockPrisma.memberPackage.findFirst.mockResolvedValueOnce({
        id: 'pkg-1',
        memberId: 'member-1',
        packageDefinitionId: 'pkgdef-1',
        studioId: STUDIO_ID,
        status: 'ACTIVE',
        entitlementKind: 'SESSION_COUNT',
        remainingUnits: 5,
        endDate: new Date(Date.now() + 10_000_000),
      });
      mockPrisma.packageDefinitionService.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.bookSession(tenant, {
          studioId: STUDIO_ID,
          scheduleId: 'schedule-1',
          memberId: 'member-1',
          memberPackageId: 'pkg-1',
          resourceIds: [],
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('bookSession time and repeat rules', () => {
    const HOUR = 60 * 60 * 1000;
    const base = {
      id: 'schedule-1',
      studioId: STUDIO_ID,
      serviceTypeId: 'service-1',
      capacity: 5,
      bookedCount: 0,
      isCancelled: false,
      serviceType: { id: 'service-1', requiredResourceTypes: [], minRepeatIntervalDays: null as number | null },
    };
    const dto = { studioId: STUDIO_ID, scheduleId: 'schedule-1', memberId: 'member-1', resourceIds: [] };
    const selfTenant: TenantContext = { ...tenant, memberProfileId: 'member-1', permissions: new Set<never>() };

    it('rejects a member booking a session that has already started', async () => {
      mockPrisma.sessionSchedule.findFirst.mockResolvedValueOnce({
        ...base,
        startTime: new Date(Date.now() - HOUR),
        endTime: new Date(Date.now() + HOUR),
      });
      await expect(service.bookSessionSelf(selfTenant, dto)).rejects.toThrow(BadRequestException);
      expect(mockPrisma.booking.create).not.toHaveBeenCalled();
    });

    it('lets staff book a session in progress but not one that has ended', async () => {
      mockPrisma.sessionSchedule.findFirst.mockResolvedValueOnce({
        ...base,
        startTime: new Date(Date.now() - 3 * HOUR),
        endTime: new Date(Date.now() - HOUR),
      });
      await expect(service.bookSession(tenant, dto)).rejects.toThrow(BadRequestException);
      expect(mockPrisma.memberProfile.findFirst).not.toHaveBeenCalled();
    });

    it('rejects a booking inside the service minimum repeat interval', async () => {
      mockPrisma.sessionSchedule.findFirst.mockResolvedValueOnce({
        ...base,
        startTime: new Date(Date.now() + 48 * HOUR),
        endTime: new Date(Date.now() + 49 * HOUR),
        serviceType: { ...base.serviceType, minRepeatIntervalDays: 2 },
      });
      mockPrisma.memberProfile.findFirst.mockResolvedValueOnce({ id: 'member-1', studioId: STUDIO_ID });
      mockPrisma.booking.findFirst.mockResolvedValueOnce({ id: 'other-booking' });

      await expect(service.bookSession(tenant, dto)).rejects.toThrow(BadRequestException);
      expect(mockPrisma.booking.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            memberId: 'member-1',
            status: { in: ['CONFIRMED', 'ATTENDED'] },
            schedule: expect.objectContaining({ serviceTypeId: 'service-1' }),
          }),
        }),
      );
      expect(mockPrisma.sessionSchedule.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('cancelBooking', () => {
    const bookingRow = (hoursUntilStart: number, policy: Record<string, number> | null) => ({
      id: 'booking-1',
      studioId: STUDIO_ID,
      scheduleId: 'schedule-1',
      memberPackageId: 'pkg-1',
      status: 'CONFIRMED',
      unitsCharged: 2,
      schedule: {
        startTime: new Date(Date.now() + hoursUntilStart * 60 * 60 * 1000),
        serviceType: { cancellationPolicy: policy },
      },
      memberPackage: { entitlementKind: 'CREDIT' },
    });

    beforeEach(() => {
      mockPrisma.booking.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.memberPackage.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.sessionSchedule.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.booking.findUniqueOrThrow.mockResolvedValue({ id: 'booking-1' });
      // No free seat to fill from the waitlist in these cases.
      mockPrisma.sessionSchedule.findFirst.mockResolvedValue(null);
    });

    it('refunds every unit when cancelled before the policy deadline', async () => {
      mockPrisma.booking.findFirst.mockResolvedValueOnce(
        bookingRow(10, { freeCancelHours: 4, lateCancelChargeUnits: 1, noShowChargeUnits: 2 }),
      );

      const result = await service.cancelBooking(tenant, {
        bookingId: 'booking-1',
        cancelledBy: 'MEMBER',
        reason: 'İş seyahati',
        waivePenalty: false,
      });

      expect(result.isLateCancellation).toBe(false);
      expect(result.refundedUnits).toBe(2);
      expect(result.penaltyUnits).toBe(0);
      expect(mockPrisma.memberPackage.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ remainingUnits: { increment: 2 } }) }),
      );
    });

    it('keeps only the late-cancel charge inside the window', async () => {
      mockPrisma.booking.findFirst.mockResolvedValueOnce(
        bookingRow(2, { freeCancelHours: 4, lateCancelChargeUnits: 1, noShowChargeUnits: 2 }),
      );

      const result = await service.cancelBooking(tenant, {
        bookingId: 'booking-1',
        cancelledBy: 'MEMBER',
        waivePenalty: false,
      });

      expect(result.isLateCancellation).toBe(true);
      expect(result.penaltyUnits).toBe(1);
      expect(result.refundedUnits).toBe(1);
      expect(mockPrisma.booking.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'CONFIRMED' }),
          data: expect.objectContaining({ status: 'CANCELLED_LATE', penaltyUnits: 1 }),
        }),
      );
    });

    it('staff can waive a late-cancel penalty', async () => {
      mockPrisma.booking.findFirst.mockResolvedValueOnce(
        bookingRow(2, { freeCancelHours: 4, lateCancelChargeUnits: 1, noShowChargeUnits: 2 }),
      );

      const result = await service.cancelBooking(tenant, {
        bookingId: 'booking-1',
        cancelledBy: 'STUDIO',
        waivePenalty: true,
      });

      expect(result.isLateCancellation).toBe(true);
      expect(result.penaltyUnits).toBe(0);
      expect(result.refundedUnits).toBe(2);
    });

    it('a concurrent cancel that lost the race gets 409 and refunds nothing', async () => {
      mockPrisma.booking.findFirst.mockResolvedValueOnce(
        bookingRow(10, { freeCancelHours: 4, lateCancelChargeUnits: 1, noShowChargeUnits: 2 }),
      );
      mockPrisma.booking.updateMany.mockResolvedValueOnce({ count: 0 });

      await expect(
        service.cancelBooking(tenant, { bookingId: 'booking-1', cancelledBy: 'MEMBER', waivePenalty: false }),
      ).rejects.toThrow(ConflictException);
      expect(mockPrisma.memberPackage.updateMany).not.toHaveBeenCalled();
    });

    it('falls back to the studio default policy, then to keep-all', async () => {
      mockPrisma.booking.findFirst.mockResolvedValueOnce(bookingRow(0.1, null));
      mockPrisma.cancellationPolicy.findFirst.mockResolvedValueOnce(null);

      const result = await service.cancelBooking(tenant, {
        bookingId: 'booking-1',
        cancelledBy: 'MEMBER',
        waivePenalty: false,
      });

      // Without any policy a cancel before start is free.
      expect(result.isLateCancellation).toBe(false);
      expect(result.refundedUnits).toBe(2);
    });
  });

  describe('checkIn', () => {
    it('moves a confirmed booking to ATTENDED', async () => {
      mockPrisma.booking.findFirst.mockResolvedValueOnce({ id: 'booking-1', studioId: STUDIO_ID });
      mockPrisma.booking.updateMany.mockResolvedValueOnce({ count: 1 });
      mockPrisma.booking.findUniqueOrThrow.mockResolvedValueOnce({ id: 'booking-1', status: 'ATTENDED' });

      const result = await service.checkIn(tenant, 'booking-1');
      expect(result.status).toBe('ATTENDED');
      expect(mockPrisma.booking.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 'booking-1', status: 'CONFIRMED' }),
          data: expect.objectContaining({ status: 'ATTENDED' }),
        }),
      );
    });

    it('rejects check-in for a cancelled booking', async () => {
      mockPrisma.booking.findFirst.mockResolvedValueOnce({ id: 'booking-1', studioId: STUDIO_ID });
      mockPrisma.booking.updateMany.mockResolvedValueOnce({ count: 0 });
      await expect(service.checkIn(tenant, 'booking-1')).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException when the booking does not belong to the studio', async () => {
      mockPrisma.booking.findFirst.mockResolvedValueOnce(null);
      await expect(service.checkIn(tenant, 'booking-x')).rejects.toThrow(NotFoundException);
    });
  });

  describe('weekly recurrence', () => {
    it('keeps the local wall time across the Berlin DST change on 2026-10-25', async () => {
      mockPrisma.serviceType.findFirst.mockResolvedValueOnce({ id: 'service-1', studioId: STUDIO_ID, capacity: 5, requiresQualification: false, isActive: true });
      mockPrisma.studio.findUnique.mockResolvedValueOnce({ timezone: 'Europe/Berlin' });
      mockPrisma.sessionSchedule.findFirst.mockResolvedValue(null);
      mockPrisma.sessionSchedule.create.mockImplementation(async ({ data }) => data);
      // Saturday 2026-10-24 18:00 CEST, then four weekly occurrences.
      await service.createSchedule(tenant, {
        studioId: STUDIO_ID,
        serviceTypeId: 'service-1',
        title: 'Weekly',
        startTime: '2026-10-24T16:00:00.000Z',
        endTime: '2026-10-24T17:00:00.000Z',
        isRecurring: true,
        recurringWeeks: 2,
        deliveryMode: 'IN_PERSON',
      } as never);
      const starts = mockPrisma.sessionSchedule.create.mock.calls.map((c) => (c[0].data.startTime as Date).toISOString());
      const ends = mockPrisma.sessionSchedule.create.mock.calls.map((c) => (c[0].data.endTime as Date).toISOString());
      // 2026-10-31 18:00 CET is 17:00 UTC.
      expect(starts).toEqual(['2026-10-24T16:00:00.000Z', '2026-10-31T17:00:00.000Z']);
      expect(ends).toEqual(['2026-10-24T17:00:00.000Z', '2026-10-31T18:00:00.000Z']);
    });
  });

  describe('updateSchedule', () => {
    const existing = {
      id: 'schedule-1',
      studioId: STUDIO_ID,
      branchId: null,
      resourceId: null,
      trainerId: null,
      title: 'Class',
      isCancelled: false,
      capacity: 2,
      startTime: new Date(Date.now() + 24 * 3600_000),
      endTime: new Date(Date.now() + 25 * 3600_000),
    };

    it('moves the spot holds of the session together with the session', async () => {
      mockPrisma.sessionSchedule.findFirst.mockResolvedValueOnce(existing);
      mockPrisma.booking.findMany.mockResolvedValueOnce([]);
      mockPrisma.sessionSchedule.update.mockResolvedValueOnce({ ...existing });
      const start = new Date(Date.now() + 48 * 3600_000);
      const end = new Date(Date.now() + 49 * 3600_000);

      await service.updateSchedule(tenant, 'schedule-1', { startTime: start.toISOString(), endTime: end.toISOString() } as never);

      expect(mockPrisma.bookingResource.updateMany).toHaveBeenCalledWith({
        where: { studioId: STUDIO_ID, booking: { scheduleId: 'schedule-1' } },
        data: { startTime: start, endTime: end },
      });
    });

    it('turns a hold exclusion violation into a 409', async () => {
      mockPrisma.sessionSchedule.findFirst.mockResolvedValueOnce(existing);
      mockPrisma.booking.findMany.mockResolvedValueOnce([]);
      mockPrisma.sessionSchedule.update.mockResolvedValueOnce({ ...existing });
      mockPrisma.bookingResource.updateMany.mockRejectedValueOnce(Object.assign(new Error('23P01 exclusion'), { code: 'P2010' }));
      const start = new Date(Date.now() + 48 * 3600_000);

      await expect(
        service.updateSchedule(tenant, 'schedule-1', { startTime: start.toISOString(), endTime: new Date(start.getTime() + 3600_000).toISOString() } as never),
      ).rejects.toThrow(ConflictException);
    });

    it('promotes from the waitlist after a capacity increase, not after other edits', async () => {
      const promote = jest.spyOn(service, 'promoteFromWaitlist').mockResolvedValue(1);
      mockPrisma.sessionSchedule.findFirst.mockResolvedValue(existing);
      mockPrisma.booking.findMany.mockResolvedValue([]);
      mockPrisma.sessionSchedule.update.mockResolvedValue({ ...existing });

      await service.updateSchedule(tenant, 'schedule-1', { capacity: 5 } as never);
      expect(promote).toHaveBeenCalledWith(STUDIO_ID, 'schedule-1');

      promote.mockClear();
      await service.updateSchedule(tenant, 'schedule-1', { title: 'Renamed' } as never);
      expect(promote).not.toHaveBeenCalled();
    });

    it('takes the studio scheduling lock before checking conflicts', async () => {
      const order: string[] = [];
      mockPrisma.sessionSchedule.findFirst.mockImplementation(async (args: { where: { id?: unknown; trainerId?: unknown } }) => {
        if (args.where.trainerId) order.push('conflict-check');
        return args.where.trainerId ? null : existing;
      });
      mockPrisma.$executeRaw.mockImplementation(async () => {
        order.push('lock');
        return 1;
      });
      mockPrisma.trainerProfile.findFirst.mockResolvedValueOnce({ id: 'trainer-1' });
      mockPrisma.booking.findMany.mockResolvedValueOnce([]);
      mockPrisma.sessionSchedule.update.mockResolvedValueOnce({ ...existing });

      await service.updateSchedule(tenant, 'schedule-1', { trainerId: 'trainer-1' } as never);
      expect(order).toEqual(['lock', 'conflict-check']);
    });
  });
});
