import { Test, TestingModule } from '@nestjs/testing';
import { SchedulesService } from './schedules.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { GamificationService } from '../gamification/gamification.service';
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
      startTime: new Date(),
      endTime: new Date(),
      serviceType: { id: 'service-1' },
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
});
