import { Test, TestingModule } from '@nestjs/testing';
import { MembersService } from './members.service';
import { PrismaService } from '../prisma/prisma.service';
import { ReferralsService } from '../feedback/referrals.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { ConflictException, NotFoundException } from '@nestjs/common';
import type { TenantContext } from '../auth/tenant-context';

describe('MembersService', () => {
  let service: MembersService;

  const STUDIO_ID = 'studio-1';

  const tenant: TenantContext = {
    studioId: STUDIO_ID,
    membershipId: 'membership-owner',
    isOwner: true,
    isSuperAdmin: false,
    permissions: new Set(['members.view', 'members.manage', 'members.contact.view', 'members.health.view']),
    memberProfileId: null,
    trainerProfileId: null,
    branchIds: null,
  };

  const mockPrisma = {
    roleTemplate: {
      findFirst: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    membership: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    memberProfile: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      upsert: jest.fn(),
    },
    packageDefinition: {
      findFirst: jest.fn(),
    },
    memberPackage: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    payment: {
      create: jest.fn(),
    },
    packageFreezeHistory: {
      create: jest.fn(),
    },
    $transaction: jest.fn((callback) => callback(mockPrisma)),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MembersService,
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
        {
          provide: ReferralsService,
          useValue: { recordReferral: jest.fn() },
        },
        {
          provide: WebhooksService,
          useValue: { emit: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<MembersService>(MembersService);
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation((callback) => callback(mockPrisma));
  });

  describe('createMember', () => {
    const dto = {
      studioId: STUDIO_ID,
      firstName: 'Ayşe',
      lastName: 'Yılmaz',
      phone: '+905321112233',
    } as any;

    it('should return 409 ConflictException when a membership already exists for that user+studio', async () => {
      mockPrisma.roleTemplate.findFirst.mockResolvedValueOnce({ id: 'role-member', key: 'member' });
      mockPrisma.user.findUnique.mockResolvedValueOnce({ id: 'user-1', phone: dto.phone });
      mockPrisma.membership.findUnique.mockResolvedValueOnce({ id: 'membership-existing' });

      await expect(service.createMember(tenant, dto)).rejects.toThrow(ConflictException);
      expect(mockPrisma.membership.create).not.toHaveBeenCalled();
    });

    it('should not overwrite an existing user name and create the membership + profile', async () => {
      mockPrisma.roleTemplate.findFirst.mockResolvedValueOnce({ id: 'role-member', key: 'member' });
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        id: 'user-1',
        phone: dto.phone,
        firstName: 'Eski Ad',
        lastName: 'Eski Soyad',
      });
      mockPrisma.membership.findUnique.mockResolvedValueOnce(null);
      mockPrisma.membership.create.mockResolvedValueOnce({ id: 'membership-new' });
      mockPrisma.memberProfile.upsert.mockResolvedValueOnce({
        id: 'member-1',
        membershipId: 'membership-new',
        studioId: STUDIO_ID,
        membership: { user: { firstName: 'Eski Ad', lastName: 'Eski Soyad', phone: dto.phone, email: null } },
      });

      await service.createMember(tenant, dto);

      expect(mockPrisma.user.create).not.toHaveBeenCalled();
      expect(mockPrisma.membership.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ userId: 'user-1', studioId: STUDIO_ID, roleTemplateId: 'role-member' }),
        }),
      );
    });

    it('should throw NotFoundException when the studio has no member role template', async () => {
      mockPrisma.roleTemplate.findFirst.mockResolvedValueOnce(null);
      await expect(service.createMember(tenant, dto)).rejects.toThrow(NotFoundException);
    });

    it('should promote an existing partner-guest membership instead of throwing, and reuse the same row', async () => {
      mockPrisma.roleTemplate.findFirst.mockResolvedValueOnce({ id: 'role-member', key: 'member' });
      mockPrisma.user.findUnique.mockResolvedValueOnce({ id: 'user-1', phone: dto.phone, firstName: 'Partner', lastName: 'Misafiri' });
      mockPrisma.membership.findUnique.mockResolvedValueOnce({
        id: 'membership-guest',
        userId: 'user-1',
        studioId: STUDIO_ID,
        joinedAt: new Date('2026-01-01T00:00:00.000Z'),
        isPartnerGuest: true,
      });
      mockPrisma.membership.update.mockResolvedValueOnce({ id: 'membership-guest', isPartnerGuest: false });
      mockPrisma.memberProfile.upsert.mockResolvedValueOnce({
        id: 'member-1',
        membershipId: 'membership-guest',
        studioId: STUDIO_ID,
        membership: { user: { firstName: 'Ayşe', lastName: 'Yılmaz', phone: dto.phone, email: null }, isPartnerGuest: false },
      });

      await service.createMember(tenant, dto);

      expect(mockPrisma.membership.create).not.toHaveBeenCalled();
      expect(mockPrisma.membership.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'membership-guest' },
          data: expect.objectContaining({ status: 'ACTIVE', isPartnerGuest: false }),
        }),
      );
      expect(mockPrisma.memberProfile.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { membershipId: 'membership-guest' } }),
      );
    });
  });
});
