import { Test, TestingModule } from '@nestjs/testing';
import { TrainersService } from './trainers.service';
import { PrismaService } from '../prisma/prisma.service';
import { CommissionType, SessionType } from '@platform/shared';

describe('TrainersService', () => {
  let service: TrainersService;
  let prisma: PrismaService;

  const mockPrisma = {
    trainerProfile: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
    sessionSchedule: {
      findMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TrainersService,
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
      ],
    }).compile();

    service = module.get<TrainersService>(TrainersService);
    prisma = module.get<PrismaService>(PrismaService);
    jest.clearAllMocks();
  });

  describe('calculateCommissionReport', () => {
    it('should calculate PER_SESSION_FIXED commission correctly', async () => {
      mockPrisma.trainerProfile.findFirst.mockResolvedValueOnce({
        id: 'trainer-1',
        commissionType: CommissionType.PER_SESSION_FIXED,
        commissionValue: 350.0,
        user: {
          firstName: 'Selin',
          lastName: 'Aydın',
        },
      });

      // 10 attended sessions
      const mockSchedules = Array.from({ length: 10 }).map((_, i) => ({
        id: `s-${i}`,
        title: 'Klinik Reformer',
        sessionType: SessionType.PRIVATE_REFORMER,
        startTime: new Date(),
        bookings: [{ status: 'ATTENDED' }],
      }));

      mockPrisma.sessionSchedule.findMany.mockResolvedValueOnce(mockSchedules);

      const report = await service.calculateCommissionReport('studio-1', 'trainer-1', 9, 2026);

      expect(report.totalSessionsTaught).toBe(10);
      expect(report.totalEarned).toBe(3500); // 10 * 350 TL = 3500 TL
      expect(report.trainer.fullName).toBe('Selin Aydın');
    });

    it('should calculate MONTHLY_SALARY without multiplying per session', async () => {
      mockPrisma.trainerProfile.findFirst.mockResolvedValueOnce({
        id: 'trainer-2',
        commissionType: CommissionType.MONTHLY_SALARY,
        commissionValue: 30000.0,
        user: {
          firstName: 'Burak',
          lastName: 'Kaya',
        },
      });

      mockPrisma.sessionSchedule.findMany.mockResolvedValueOnce([
        {
          id: 's-1',
          title: 'Grup Dersi',
          sessionType: SessionType.GROUP_REFORMER,
          startTime: new Date(),
          bookings: [{ status: 'ATTENDED' }],
        },
      ]);

      const report = await service.calculateCommissionReport('studio-1', 'trainer-2', 9, 2026);

      expect(report.totalSessionsTaught).toBe(1);
      expect(report.totalEarned).toBe(30000);
    });
  });
});
