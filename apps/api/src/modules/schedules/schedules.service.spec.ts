import { Test, TestingModule } from '@nestjs/testing';
import { SchedulesService } from './schedules.service';
import { PrismaService } from '../prisma/prisma.service';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { SessionType } from '@pilates/shared';

describe('SchedulesService', () => {
  let service: SchedulesService;
  let prisma: PrismaService;

  const mockPrisma = {
    sessionSchedule: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    room: {
      findUnique: jest.fn(),
    },
    booking: {
      findUnique: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
    memberPackage: {
      findFirst: jest.fn(),
      update: jest.fn(),
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
    prisma = module.get<PrismaService>(PrismaService);
    jest.clearAllMocks();
  });

  describe('createSchedule', () => {
    it('should throw ConflictException if trainer has another class at the same time', async () => {
      mockPrisma.sessionSchedule.findFirst.mockResolvedValueOnce({
        id: 'existing-schedule',
        trainerId: 'trainer-1',
      });

      const now = new Date();
      const oneHourLater = new Date(now.getTime() + 60 * 60 * 1000);

      await expect(
        service.createSchedule({
          studioId: 'studio-1',
          trainerId: 'trainer-1',
          sessionType: SessionType.PRIVATE_REFORMER,
          title: 'Klinik Pilates',
          startTime: now.toISOString(),
          endTime: oneHourLater.toISOString(),
          capacity: 1,
          isRecurring: false,
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw BadRequestException if end time is before start time', async () => {
      const now = new Date();
      const past = new Date(now.getTime() - 60 * 60 * 1000);

      await expect(
        service.createSchedule({
          studioId: 'studio-1',
          trainerId: 'trainer-1',
          sessionType: SessionType.PRIVATE_REFORMER,
          title: 'Hatalı Saat',
          startTime: now.toISOString(),
          endTime: past.toISOString(),
          capacity: 1,
          isRecurring: false,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('cancelBooking', () => {
    it('should refund credit when cancelled earlier than cancellationDeadlineHours (early cancel)', async () => {
      const now = new Date();
      // Class starts 10 hours from now (deadline is 4 hours)
      const classStart = new Date(now.getTime() + 10 * 60 * 60 * 1000);

      mockPrisma.booking.findUnique.mockResolvedValueOnce({
        id: 'booking-1',
        scheduleId: 'schedule-1',
        memberPackageId: 'pkg-1',
        status: 'CONFIRMED',
        schedule: {
          startTime: classStart,
        },
        studio: {
          cancellationDeadlineHours: 4,
        },
      });

      mockPrisma.booking.update.mockResolvedValueOnce({
        id: 'booking-1',
        status: 'CANCELLED_EARLY',
        isLateCancellation: false,
      });

      const result = await service.cancelBooking({
        bookingId: 'booking-1',
        cancelledBy: 'MEMBER',
        reason: 'İş seyahati',
      });

      expect(result.isLateCancellation).toBe(false);
      expect(result.creditRefunded).toBe(true);
      expect(mockPrisma.memberPackage.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            remainingSessions: { increment: 1 },
          }),
        }),
      );
    });

    it('should deduct credit (no refund) when cancelled late (< 4 hours)', async () => {
      const now = new Date();
      // Class starts in 2 hours (less than 4 hours deadline)
      const classStart = new Date(now.getTime() + 2 * 60 * 60 * 1000);

      mockPrisma.booking.findUnique.mockResolvedValueOnce({
        id: 'booking-1',
        scheduleId: 'schedule-1',
        memberPackageId: 'pkg-1',
        status: 'CONFIRMED',
        schedule: {
          startTime: classStart,
        },
        studio: {
          cancellationDeadlineHours: 4,
        },
      });

      mockPrisma.booking.update.mockResolvedValueOnce({
        id: 'booking-1',
        status: 'CANCELLED_LATE',
        isLateCancellation: true,
      });

      const result = await service.cancelBooking({
        bookingId: 'booking-1',
        cancelledBy: 'MEMBER',
        reason: 'Son dakika iptal',
      });

      expect(result.isLateCancellation).toBe(true);
      expect(result.creditRefunded).toBe(false);
      // Member package increment should NOT be called
      expect(mockPrisma.memberPackage.update).not.toHaveBeenCalled();
    });
  });

  describe('checkIn', () => {
    it('should update booking status to ATTENDED and record checkInAt time', async () => {
      mockPrisma.booking.findUnique.mockResolvedValueOnce({
        id: 'booking-1',
      });

      mockPrisma.booking.update.mockResolvedValueOnce({
        id: 'booking-1',
        status: 'ATTENDED',
        checkInAt: new Date(),
      });

      const result = await service.checkIn('booking-1');
      expect(result.status).toBe('ATTENDED');
      expect(mockPrisma.booking.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'booking-1' },
          data: expect.objectContaining({ status: 'ATTENDED' }),
        }),
      );
    });
  });
});
