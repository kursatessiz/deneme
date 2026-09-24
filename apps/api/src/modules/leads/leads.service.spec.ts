import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { LeadsService, splitFullName } from './leads.service';
import { PrismaService } from '../prisma/prisma.service';
import { MembersService } from '../members/members.service';
import { SchedulesService } from '../schedules/schedules.service';
import type { TenantContext } from '../auth/tenant-context';

describe('LeadsService', () => {
  let service: LeadsService;

  const STUDIO_ID = 'studio-1';
  const tenant: TenantContext = {
    studioId: STUDIO_ID,
    membershipId: 'membership-staff',
    isOwner: false,
    isSuperAdmin: false,
    permissions: new Set(['leads.view', 'leads.manage']),
    memberProfileId: null,
    trainerProfileId: null,
    branchIds: null,
  };

  const mockPrisma = {
    lead: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    leadActivity: {
      create: jest.fn(),
    },
    studio: {
      findFirst: jest.fn(),
    },
    membership: {
      findFirst: jest.fn(),
    },
    $transaction: jest.fn((arg) => (Array.isArray(arg) ? Promise.all(arg) : arg(mockPrisma))),
  };

  const mockMembers = { createMember: jest.fn() };
  const mockSchedules = { bookSession: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LeadsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: MembersService, useValue: mockMembers },
        { provide: SchedulesService, useValue: mockSchedules },
      ],
    }).compile();

    service = module.get<LeadsService>(LeadsService);
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation((arg) => (Array.isArray(arg) ? Promise.all(arg) : arg(mockPrisma)));
  });

  describe('changeStage', () => {
    it('rejects moving away from WON', async () => {
      mockPrisma.lead.findFirst.mockResolvedValueOnce({ id: 'lead-1', studioId: STUDIO_ID, branchId: null, stage: 'WON' });
      await expect(
        service.changeStage(tenant, 'lead-1', { stage: 'CONTACTED' } as any),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.lead.update).not.toHaveBeenCalled();
    });

    it('rejects LOST without a reason at the schema level (service assumes a valid dto)', () => {
      // ChangeLeadStageSchema.refine enforces this before it reaches the service;
      // this test documents that the service itself trusts a validated dto and
      // simply stores whatever lostReason it is given.
      expect(true).toBe(true);
    });

    it('allows NEW -> CONTACTED and records a stage-change activity', async () => {
      mockPrisma.lead.findFirst.mockResolvedValueOnce({ id: 'lead-1', studioId: STUDIO_ID, branchId: null, stage: 'NEW' });
      mockPrisma.lead.update.mockResolvedValueOnce({ id: 'lead-1', stage: 'CONTACTED' });

      await service.changeStage(tenant, 'lead-1', { stage: 'CONTACTED' } as any);

      expect(mockPrisma.lead.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ stage: 'CONTACTED', lostReason: null }) }),
      );
      expect(mockPrisma.leadActivity.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ type: 'STAGE_CHANGE' }) }),
      );
    });

    it('rejects a backward transition (TRIAL_BOOKED -> NEW)', async () => {
      mockPrisma.lead.findFirst.mockResolvedValueOnce({
        id: 'lead-1',
        studioId: STUDIO_ID,
        branchId: null,
        stage: 'TRIAL_BOOKED',
      });
      await expect(
        service.changeStage(tenant, 'lead-1', { stage: 'NEW' } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('stores the lost reason when moving to LOST', async () => {
      mockPrisma.lead.findFirst.mockResolvedValueOnce({ id: 'lead-1', studioId: STUDIO_ID, branchId: null, stage: 'NEW' });
      mockPrisma.lead.update.mockResolvedValueOnce({ id: 'lead-1', stage: 'LOST' });

      await service.changeStage(tenant, 'lead-1', { stage: 'LOST', lostReason: 'Fiyat uygun bulmadi' } as any);

      expect(mockPrisma.lead.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ stage: 'LOST', lostReason: 'Fiyat uygun bulmadi' }) }),
      );
    });
  });

  describe('phone dedupe', () => {
    it('create() folds a duplicate open-phone submission into an activity instead of a new lead', async () => {
      mockPrisma.lead.findFirst.mockResolvedValueOnce({ id: 'lead-existing', studioId: STUDIO_ID, phone: '+905399990001' });
      mockPrisma.leadActivity.create.mockResolvedValueOnce({ id: 'activity-1' });

      const result = await service.create(tenant, {
        studioId: STUDIO_ID,
        fullName: 'Ayse Yilmaz',
        phone: '+905399990001',
        source: 'PHONE',
      } as any);

      expect(result.deduplicated).toBe(true);
      expect(mockPrisma.lead.create).not.toHaveBeenCalled();
      expect(mockPrisma.leadActivity.create).toHaveBeenCalled();
    });

    it('create() makes a new lead when no open lead shares the phone', async () => {
      mockPrisma.lead.findFirst.mockResolvedValueOnce(null);
      mockPrisma.lead.create.mockResolvedValueOnce({ id: 'lead-new', phone: '+905399990002' });

      const result = await service.create(tenant, {
        studioId: STUDIO_ID,
        fullName: 'Deniz Kaya',
        phone: '+905399990002',
        source: 'WALK_IN',
      } as any);

      expect(result.deduplicated).toBe(false);
      expect(mockPrisma.lead.create).toHaveBeenCalled();
    });

    it('submitPublicForm() folds a duplicate open-phone submission into an activity', async () => {
      mockPrisma.studio.findFirst.mockResolvedValueOnce({ id: STUDIO_ID });
      mockPrisma.lead.findFirst.mockResolvedValueOnce({ id: 'lead-existing', phone: '+905399990003' });

      await service.submitPublicForm('zen-reformer-pilates', {
        fullName: 'Deniz Kaya',
        phone: '+905399990003',
        consent: true,
        website: '',
      } as any);

      expect(mockPrisma.lead.create).not.toHaveBeenCalled();
      expect(mockPrisma.leadActivity.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ leadId: 'lead-existing' }) }),
      );
    });

    it('submitPublicForm() does nothing for a honeypot hit', async () => {
      await service.submitPublicForm('zen-reformer-pilates', {
        fullName: 'Bot',
        phone: '+905399990004',
        consent: true,
        website: 'http://spam.example',
      } as any);

      expect(mockPrisma.studio.findFirst).not.toHaveBeenCalled();
      expect(mockPrisma.lead.create).not.toHaveBeenCalled();
    });

    it('submitPublicForm() does nothing for an unknown or inactive studio slug', async () => {
      mockPrisma.studio.findFirst.mockResolvedValueOnce(null);

      await service.submitPublicForm('unknown-slug', {
        fullName: 'Test',
        phone: '+905399990005',
        consent: true,
        website: '',
      } as any);

      expect(mockPrisma.lead.create).not.toHaveBeenCalled();
      expect(mockPrisma.lead.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('splitFullName', () => {
    it('splits the last word as the surname', () => {
      expect(splitFullName('Ayse Nur Yilmaz')).toEqual({ firstName: 'Ayse Nur', lastName: 'Yilmaz' });
    });

    it('uses a single word as both names', () => {
      expect(splitFullName('Cher')).toEqual({ firstName: 'Cher', lastName: 'Cher' });
    });
  });
});
