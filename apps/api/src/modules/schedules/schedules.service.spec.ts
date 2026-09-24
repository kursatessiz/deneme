import { Test, TestingModule } from '@nestjs/testing';
import { SchedulesService } from './schedules.service';
import { PrismaService } from '../prisma/prisma.service';
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
    },
    packageDefinitionService: {
      findUnique: jest.fn(),
    },
    booking: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    bookingResource: {
      create: jest.fn(),
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
    it('should refund credit when cancelled earlier than the policy deadline (early cancel)', async () => {
      const now = new Date();
      const classStart = new Date(now.getTime() + 10 * 60 * 60 * 1000);

      mockPrisma.booking.findFirst.mockResolvedValueOnce({
        id: 'booking-1',
        studioId: STUDIO_ID,
        scheduleId: 'schedule-1',
        memberPackageId: 'pkg-1',
        status: 'CONFIRMED',
        unitsCharged: 1,
        schedule: {
          startTime: classStart,
          serviceType: { cancellationPolicy: { freeCancelHours: 4 } },
        },
        memberPackage: { entitlementKind: 'SESSION_COUNT' },
      });

      mockPrisma.booking.update.mockResolvedValueOnce({
        id: 'booking-1',
        status: 'CANCELLED_EARLY',
        isLateCancellation: false,
      });

      const result = await service.cancelBooking(tenant, {
        bookingId: 'booking-1',
        cancelledBy: 'MEMBER',
        reason: 'İş seyahati',
      });

      expect(result.isLateCancellation).toBe(false);
      expect(result.creditRefunded).toBe(true);
      expect(mockPrisma.memberPackage.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            remainingUnits: { increment: 1 },
          }),
        }),
      );
    });

    it('should deduct credit (no refund) when cancelled late', async () => {
      const now = new Date();
      const classStart = new Date(now.getTime() + 2 * 60 * 60 * 1000);

      mockPrisma.booking.findFirst.mockResolvedValueOnce({
        id: 'booking-1',
        studioId: STUDIO_ID,
        scheduleId: 'schedule-1',
        memberPackageId: 'pkg-1',
        status: 'CONFIRMED',
        unitsCharged: 1,
        schedule: {
          startTime: classStart,
          serviceType: { cancellationPolicy: { freeCancelHours: 4 } },
        },
        memberPackage: { entitlementKind: 'SESSION_COUNT' },
      });

      mockPrisma.booking.update.mockResolvedValueOnce({
        id: 'booking-1',
        status: 'CANCELLED_LATE',
        isLateCancellation: true,
      });

      const result = await service.cancelBooking(tenant, {
        bookingId: 'booking-1',
        cancelledBy: 'MEMBER',
        reason: 'Son dakika iptal',
      });

      expect(result.isLateCancellation).toBe(true);
      expect(result.creditRefunded).toBe(false);
      expect(mockPrisma.memberPackage.update).not.toHaveBeenCalled();
    });
  });

  describe('checkIn', () => {
    it('should update booking status to ATTENDED and record checkInAt time', async () => {
      mockPrisma.booking.findFirst.mockResolvedValueOnce({
        id: 'booking-1',
        studioId: STUDIO_ID,
      });

      mockPrisma.booking.update.mockResolvedValueOnce({
        id: 'booking-1',
        status: 'ATTENDED',
        checkInAt: new Date(),
      });

      const result = await service.checkIn(tenant, 'booking-1');
      expect(result.status).toBe('ATTENDED');
      expect(mockPrisma.booking.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'booking-1' },
          data: expect.objectContaining({ status: 'ATTENDED' }),
        }),
      );
    });

    it('should throw NotFoundException when the booking does not belong to the studio', async () => {
      mockPrisma.booking.findFirst.mockResolvedValueOnce(null);
      await expect(service.checkIn(tenant, 'booking-x')).rejects.toThrow(NotFoundException);
    });
  });
});
