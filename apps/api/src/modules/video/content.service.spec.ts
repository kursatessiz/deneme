import { ConflictException, ForbiddenException } from '@nestjs/common';
import { VideoContentVisibility } from '@platform/database';
import { ContentService } from './content.service';
import type { TenantContext } from '../auth/tenant-context';

describe('ContentService', () => {
  let service: ContentService;
  let prisma: any;

  const STUDIO_ID = 'studio-1';
  const MEMBER_ID = 'member-1';
  const CONTENT_ID = 'content-1';

  const tenant: TenantContext = {
    studioId: STUDIO_ID,
    membershipId: 'membership-1',
    isOwner: false,
    isSuperAdmin: false,
    permissions: new Set(),
    memberProfileId: MEMBER_ID,
    trainerProfileId: null,
    branchIds: null,
  };

  const baseContent = {
    id: CONTENT_ID,
    studioId: STUDIO_ID,
    visibility: VideoContentVisibility.ALL_MEMBERS,
    creditCost: 5,
    isPublished: true,
    serviceType: null,
    trainerProfile: null,
    packages: [],
    publishedAt: new Date('2026-01-01T00:00:00Z'),
    createdAt: new Date('2026-01-01T00:00:00Z'),
  };

  beforeEach(() => {
    prisma = {
      videoContent: { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn(), count: jest.fn() },
      videoContentPackage: { deleteMany: jest.fn() },
      videoView: {
        create: jest.fn(),
        upsert: jest.fn(),
        updateMany: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
      },
      memberPackage: { findFirst: jest.fn(), findMany: jest.fn(), updateMany: jest.fn() },
      packageDefinition: { count: jest.fn() },
      serviceType: { findFirst: jest.fn() },
      trainerProfile: { findFirst: jest.fn() },
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
    };
    service = new ContentService(prisma);
  });

  describe('start (credit charge idempotency)', () => {
    it('charges the package exactly once on the first call', async () => {
      prisma.videoContent.findFirst.mockResolvedValue(baseContent);
      prisma.memberPackage.findMany.mockResolvedValue([]); // ALL_MEMBERS: no active-package requirement
      prisma.videoView.create.mockResolvedValue({ id: 'view-1', creditChargedAt: null });
      prisma.videoView.updateMany.mockResolvedValue({ count: 1 }); // wins the claim
      prisma.memberPackage.findFirst.mockResolvedValue({
        id: 'pkg-1',
        memberId: MEMBER_ID,
        entitlementKind: 'CREDIT',
      });
      prisma.memberPackage.updateMany.mockResolvedValue({ count: 1 });
      prisma.videoView.findUniqueOrThrow.mockResolvedValue({ id: 'view-1', creditChargedAt: new Date() });

      const result = await service.start(tenant, CONTENT_ID, 'pkg-1');

      expect(result.charged).toBe(true);
      expect(prisma.memberPackage.updateMany).toHaveBeenCalledTimes(1);
      expect(prisma.memberPackage.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { usedUnits: { increment: 5 }, remainingUnits: { decrement: 5 } },
        }),
      );
    });

    it('does not charge again once creditChargedAt is already set (second call / already claimed)', async () => {
      prisma.videoContent.findFirst.mockResolvedValue(baseContent);
      prisma.memberPackage.findMany.mockResolvedValue([]);
      prisma.videoView.create.mockResolvedValue({ id: 'view-1', creditChargedAt: new Date() });

      const result = await service.start(tenant, CONTENT_ID, 'pkg-1');

      expect(result.charged).toBe(false);
      expect(prisma.memberPackage.updateMany).not.toHaveBeenCalled();
    });

    it('loses the claim race (updateMany count 0) and does not touch the package', async () => {
      prisma.videoContent.findFirst.mockResolvedValue(baseContent);
      prisma.memberPackage.findMany.mockResolvedValue([]);
      prisma.videoView.create.mockResolvedValue({ id: 'view-1', creditChargedAt: null });
      prisma.videoView.updateMany.mockResolvedValue({ count: 0 }); // another concurrent request already claimed it

      const result = await service.start(tenant, CONTENT_ID, 'pkg-1');

      expect(result.charged).toBe(false);
      expect(prisma.memberPackage.updateMany).not.toHaveBeenCalled();
    });

    it('throws 409 and never leaves the package short when the package has insufficient credit', async () => {
      prisma.videoContent.findFirst.mockResolvedValue(baseContent);
      prisma.memberPackage.findMany.mockResolvedValue([]);
      prisma.videoView.create.mockResolvedValue({ id: 'view-1', creditChargedAt: null });
      prisma.videoView.updateMany.mockResolvedValue({ count: 1 });
      prisma.memberPackage.findFirst.mockResolvedValue({ id: 'pkg-1', memberId: MEMBER_ID, entitlementKind: 'CREDIT' });
      prisma.memberPackage.updateMany.mockResolvedValue({ count: 0 }); // conditional decrement failed

      await expect(service.start(tenant, CONTENT_ID, 'pkg-1')).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('visibility rules', () => {
    it('locks MEMBERS_WITH_ACTIVE_PACKAGE content for a member with no active package', async () => {
      prisma.videoContent.findMany.mockResolvedValue([
        { ...baseContent, visibility: VideoContentVisibility.MEMBERS_WITH_ACTIVE_PACKAGE },
      ]);
      prisma.memberPackage.findMany.mockResolvedValue([]);
      prisma.videoView.findMany.mockResolvedValue([]);

      const list = await service.listForMember(tenant, { publishedOnly: false, page: 1, pageSize: 20 });

      expect(list[0].isLocked).toBe(true);
      expect(list[0].sourceUrl).toBeNull();
    });

    it('unlocks SPECIFIC_PACKAGES content when the member holds one of the listed packages', async () => {
      prisma.videoContent.findMany.mockResolvedValue([
        {
          ...baseContent,
          visibility: VideoContentVisibility.SPECIFIC_PACKAGES,
          packages: [{ packageDefinitionId: 'def-1' }],
        },
      ]);
      prisma.memberPackage.findMany.mockResolvedValue([{ packageDefinitionId: 'def-1' }]);
      prisma.videoView.findMany.mockResolvedValue([]);

      const list = await service.listForMember(tenant, { publishedOnly: false, page: 1, pageSize: 20 });

      expect(list[0].isLocked).toBe(false);
    });

    it('rejects starting a locked content outright', async () => {
      prisma.videoContent.findFirst.mockResolvedValue({
        ...baseContent,
        visibility: VideoContentVisibility.SPECIFIC_PACKAGES,
        packages: [{ packageDefinitionId: 'def-1' }],
      });
      prisma.memberPackage.findMany.mockResolvedValue([]); // member has none of the required packages

      await expect(service.start(tenant, CONTENT_ID)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.videoView.create).not.toHaveBeenCalled();
    });
  });
});
