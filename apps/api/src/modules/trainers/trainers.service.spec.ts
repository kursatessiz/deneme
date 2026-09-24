import { Test, TestingModule } from '@nestjs/testing';
import { TrainersService } from './trainers.service';
import { PrismaService } from '../prisma/prisma.service';
import { ForbiddenException } from '@nestjs/common';
import type { TenantContext } from '../auth/tenant-context';

describe('TrainersService', () => {
  let service: TrainersService;

  const STUDIO_ID = 'studio-1';

  const ownerTenant: TenantContext = {
    studioId: STUDIO_ID,
    membershipId: 'membership-1',
    isOwner: true,
    isSuperAdmin: false,
    permissions: new Set(['commissions.view.all']),
    memberProfileId: null,
    trainerProfileId: null,
    branchIds: null,
  };

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
    jest.clearAllMocks();
  });

  describe('calculateCommissionReport', () => {
    it('should calculate PER_SESSION_FIXED commission correctly', async () => {
      mockPrisma.trainerProfile.findFirst.mockResolvedValueOnce({
        id: 'trainer-1',
        commissionRule: { id: 'rule-1', name: 'Sabit', type: 'PER_SESSION_FIXED', value: 350.0 },
        membership: { user: { firstName: 'Selin', lastName: 'Aydın' } },
      });

      const mockSchedules = Array.from({ length: 10 }).map((_, i) => ({
        id: `s-${i}`,
        title: 'Klinik Reformer',
        serviceTypeId: 'service-1',
        startTime: new Date(),
        serviceType: { commissionRule: null },
        bookings: [{ status: 'ATTENDED' }],
      }));

      mockPrisma.sessionSchedule.findMany.mockResolvedValueOnce(mockSchedules);

      const report = await service.calculateCommissionReport(ownerTenant, 'trainer-1', 9, 2026);

      expect(report.totalSessionsTaught).toBe(10);
      expect(report.totalEarned).toBe(3500);
      expect(report.trainer.fullName).toBe('Selin Aydın');
    });

    it('should calculate MONTHLY_SALARY without multiplying per session', async () => {
      mockPrisma.trainerProfile.findFirst.mockResolvedValueOnce({
        id: 'trainer-2',
        commissionRule: { id: 'rule-2', name: 'Maaş', type: 'MONTHLY_SALARY', value: 30000.0 },
        membership: { user: { firstName: 'Burak', lastName: 'Kaya' } },
      });

      mockPrisma.sessionSchedule.findMany.mockResolvedValueOnce([
        {
          id: 's-1',
          title: 'Grup Dersi',
          serviceTypeId: 'service-1',
          startTime: new Date(),
          serviceType: { commissionRule: null },
          bookings: [{ status: 'ATTENDED' }],
        },
      ]);

      const report = await service.calculateCommissionReport(ownerTenant, 'trainer-2', 9, 2026);

      expect(report.totalSessionsTaught).toBe(1);
      expect(report.totalEarned).toBe(30000);
    });

    it('should forbid a trainer viewing another trainer payout without commissions.view.all', async () => {
      const trainerTenant: TenantContext = {
        ...ownerTenant,
        isOwner: false,
        permissions: new Set(['commissions.view.own']),
        trainerProfileId: 'trainer-1',
      };

      await expect(service.calculateCommissionReport(trainerTenant, 'trainer-2', 9, 2026)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });
});
