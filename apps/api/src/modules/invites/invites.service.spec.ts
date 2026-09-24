import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, ConflictException, ForbiddenException, GoneException } from '@nestjs/common';
import { DocumentType, InviteChannel } from '@platform/database';
import { InvitesService, hashInviteToken } from './invites.service';
import { PrismaService } from '../prisma/prisma.service';
import { OtpService } from '../otp/otp.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuthService } from '../auth/auth.service';
import { PlanLimitsService } from '../admin/plan-limits.service';
import type { AuthUser, TenantContext } from '../auth/tenant-context';

const VALID_TOKEN = 'a'.repeat(43);

describe('InvitesService', () => {
  let service: InvitesService;

  const mockPrisma = {
    roleTemplate: { findUnique: jest.fn() },
    membership: { findFirst: jest.fn(), findUnique: jest.fn(), update: jest.fn(), create: jest.fn() },
    inviteToken: { updateMany: jest.fn(), create: jest.fn(), findUnique: jest.fn() },
    documentVersion: { findMany: jest.fn() },
    user: { findUnique: jest.fn(), upsert: jest.fn() },
    memberProfile: { upsert: jest.fn() },
    trainerProfile: { upsert: jest.fn() },
    consent: { createMany: jest.fn() },
    auditLog: { create: jest.fn() },
    $transaction: jest.fn((cb: any) => cb(mockPrisma)),
  };

  const mockOtp = { issue: jest.fn(), verify: jest.fn() };
  const mockNotifications = { sendSms: jest.fn() };
  const mockAuth = { issueTokens: jest.fn(), sessionUser: jest.fn() };
  const mockConfig = { getOrThrow: jest.fn(() => 'https://app.example.com') };

  const STUDIO_ID = 'studio-1';
  const creator: AuthUser = {
    id: 'creator-1',
    phone: '+905321000000',
    firstName: 'Owner',
    lastName: 'One',
    isSuperAdmin: false,
  };

  function tenantWith(permissions: string[]): TenantContext {
    return {
      studioId: STUDIO_ID,
      membershipId: 'membership-owner',
      isOwner: permissions.length === 0,
      isSuperAdmin: false,
      permissions: new Set(permissions as any),
      memberProfileId: null,
      trainerProfileId: null,
      branchIds: null,
    };
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation((cb: any) => cb(mockPrisma));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InvitesService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: OtpService, useValue: mockOtp },
        { provide: NotificationsService, useValue: mockNotifications },
        { provide: AuthService, useValue: mockAuth },
        { provide: ConfigService, useValue: mockConfig },
        { provide: PlanLimitsService, useValue: { assertWithinLimit: jest.fn() } },
      ],
    }).compile();

    service = module.get<InvitesService>(InvitesService);
  });

  describe('create', () => {
    const baseDto = {
      studioId: STUDIO_ID,
      fullName: 'Deniz Kaya',
      phone: '+905327776655',
      roleKey: 'member',
      channel: InviteChannel.SHOWN,
    };

    it('owner role is never invitable -> 403, no db writes', async () => {
      const tenant = tenantWith(['members.manage', 'staff.manage']);
      await expect(
        service.create(tenant, creator, { ...baseDto, roleKey: 'owner' } as any),
      ).rejects.toThrow(ForbiddenException);
      expect(mockPrisma.roleTemplate.findUnique).not.toHaveBeenCalled();
      expect(mockPrisma.inviteToken.create).not.toHaveBeenCalled();
    });

    it('trainer invite without staff.manage -> 403', async () => {
      const tenant = tenantWith(['members.manage']); // has members.manage but not staff.manage
      await expect(
        service.create(tenant, creator, { ...baseDto, roleKey: 'trainer' } as any),
      ).rejects.toThrow(ForbiddenException);
      expect(mockPrisma.roleTemplate.findUnique).not.toHaveBeenCalled();
    });

    it('member invite with members.manage succeeds: 43-char token, inviteUrl ends with /j/<token>, stored hash differs', async () => {
      const tenant = tenantWith(['members.manage']);
      mockPrisma.roleTemplate.findUnique.mockResolvedValueOnce({ id: 'role-member', isOwner: false });
      mockPrisma.membership.findFirst.mockResolvedValueOnce(null);
      mockPrisma.inviteToken.updateMany.mockResolvedValueOnce({ count: 0 });
      mockPrisma.inviteToken.create.mockImplementationOnce(async ({ data }: any) => ({
        id: 'invite-1',
        ...data,
        studio: { name: 'Zen' },
      }));

      const result = await service.create(tenant, creator, baseDto as any);

      expect(result.token).toHaveLength(43);
      expect(result.inviteUrl).toBe(`https://app.example.com/j/${result.token}`);

      const createCall = mockPrisma.inviteToken.create.mock.calls[0][0];
      expect(createCall.data.tokenHash).not.toBe(result.token);
      expect(createCall.data.tokenHash).toBe(hashInviteToken(result.token));
    });

    it('revokes older open invites for the same phone before creating a new one', async () => {
      const tenant = tenantWith(['members.manage']);
      mockPrisma.roleTemplate.findUnique.mockResolvedValueOnce({ id: 'role-member', isOwner: false });
      mockPrisma.membership.findFirst.mockResolvedValueOnce(null);
      mockPrisma.inviteToken.updateMany.mockResolvedValueOnce({ count: 1 });
      mockPrisma.inviteToken.create.mockImplementationOnce(async ({ data }: any) => ({
        id: 'invite-2',
        ...data,
        studio: { name: 'Zen' },
      }));

      await service.create(tenant, creator, baseDto as any);

      expect(mockPrisma.inviteToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            studioId: STUDIO_ID,
            phone: baseDto.phone,
            usedAt: null,
            revokedAt: null,
          }),
          data: expect.objectContaining({ revokedAt: expect.any(Date) }),
        }),
      );
    });

    it('active member in the studio -> 409', async () => {
      const tenant = tenantWith(['members.manage']);
      mockPrisma.roleTemplate.findUnique.mockResolvedValueOnce({ id: 'role-member', isOwner: false });
      mockPrisma.membership.findFirst.mockResolvedValueOnce({ id: 'existing-membership' });

      await expect(service.create(tenant, creator, baseDto as any)).rejects.toThrow(ConflictException);
      expect(mockPrisma.inviteToken.create).not.toHaveBeenCalled();
    });
  });

  describe('accept', () => {
    const documents = [
      { id: 'doc-kvkk', type: DocumentType.KVKK_NOTICE, studioId: STUDIO_ID },
      { id: 'doc-contract', type: DocumentType.MEMBERSHIP_CONTRACT, studioId: STUDIO_ID },
    ];

    function mockUsableInvite() {
      mockPrisma.inviteToken.findUnique.mockResolvedValueOnce({
        id: 'invite-1',
        studioId: STUDIO_ID,
        phone: '+905327776655',
        fullName: 'Deniz Kaya',
        roleTemplateId: 'role-member',
        usedAt: null,
        revokedAt: null,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60),
        studio: { name: 'Zen', logoUrl: null, isActive: true },
        roleTemplate: { key: 'member', name: 'Member' },
      });
      mockPrisma.documentVersion.findMany.mockResolvedValueOnce(documents);
    }

    it('rejects missing consent (400) before touching the OTP', async () => {
      mockUsableInvite();

      await expect(
        service.accept(
          VALID_TOKEN,
          { code: '482915', acceptedDocumentVersionIds: ['doc-kvkk'], pin: '482916' } as any,
          '1.2.3.4',
        ),
      ).rejects.toThrow(BadRequestException);
      expect(mockOtp.verify).not.toHaveBeenCalled();
    });

    it('requires a PIN when the user has none yet', async () => {
      mockUsableInvite();
      mockOtp.verify.mockResolvedValueOnce(true);
      mockPrisma.user.findUnique.mockResolvedValueOnce(null); // no existing user -> no pinHash

      await expect(
        service.accept(
          VALID_TOKEN,
          { code: '482915', acceptedDocumentVersionIds: ['doc-kvkk', 'doc-contract'] } as any,
          '1.2.3.4',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('a second concurrent claim of the same invite -> 410 Gone', async () => {
      mockUsableInvite();
      mockOtp.verify.mockResolvedValueOnce(true);
      mockPrisma.user.findUnique.mockResolvedValueOnce({ id: 'user-1', pinHash: 'already-set' });
      mockPrisma.inviteToken.updateMany.mockResolvedValueOnce({ count: 0 }); // lost the claim race

      await expect(
        service.accept(
          VALID_TOKEN,
          { code: '482915', acceptedDocumentVersionIds: ['doc-kvkk', 'doc-contract'] } as any,
          '1.2.3.4',
        ),
      ).rejects.toThrow(GoneException);
    });
  });
});
