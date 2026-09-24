import { Test, TestingModule } from '@nestjs/testing';
import { CatalogService } from './catalog.service';
import { PrismaService } from '../prisma/prisma.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { TenantContext } from '../auth/tenant-context';
import { EntitlementKind, HealthActivityType } from '@platform/shared';

describe('CatalogService', () => {
  let service: CatalogService;

  const STUDIO_ID = 'studio-1';

  const tenant: TenantContext = {
    studioId: STUDIO_ID,
    membershipId: 'membership-1',
    isOwner: true,
    isSuperAdmin: false,
    permissions: new Set(['catalog.view', 'catalog.manage']),
    memberProfileId: null,
    trainerProfileId: null,
    branchIds: null,
  };

  const mockPrisma = {
    resourceType: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    resource: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    branch: { findFirst: jest.fn() },
    commissionRule: { findFirst: jest.fn() },
    measurementFormTemplate: { findFirst: jest.fn() },
    cancellationPolicy: {
      findFirst: jest.fn(),
      updateMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    serviceType: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    serviceTypeResourceType: {
      deleteMany: jest.fn(),
      createMany: jest.fn(),
    },
    trainerProfile: { findFirst: jest.fn() },
    trainerQualification: { upsert: jest.fn(), deleteMany: jest.fn() },
    $transaction: jest.fn((callback) => callback(mockPrisma)),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CatalogService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();

    service = module.get<CatalogService>(CatalogService);
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation((callback) => callback(mockPrisma));
  });

  describe('single default cancellation policy invariant', () => {
    it('clears the previous default when creating a new default policy', async () => {
      mockPrisma.cancellationPolicy.create.mockResolvedValueOnce({ id: 'policy-2', isDefault: true });

      await service.createCancellationPolicy(tenant, {
        studioId: STUDIO_ID,
        name: 'Yeni Varsayılan',
        freeCancelHours: 6,
        lateCancelChargeUnits: 1,
        noShowChargeUnits: 1,
        isDefault: true,
      });

      expect(mockPrisma.cancellationPolicy.updateMany).toHaveBeenCalledWith({
        where: { studioId: STUDIO_ID, isDefault: true },
        data: { isDefault: false },
      });
    });

    it('does not touch other policies when creating a non-default one', async () => {
      mockPrisma.cancellationPolicy.create.mockResolvedValueOnce({ id: 'policy-3', isDefault: false });

      await service.createCancellationPolicy(tenant, {
        studioId: STUDIO_ID,
        name: 'İkincil',
        freeCancelHours: 2,
        lateCancelChargeUnits: 1,
        noShowChargeUnits: 1,
        isDefault: false,
      });

      expect(mockPrisma.cancellationPolicy.updateMany).not.toHaveBeenCalled();
    });

    it('clears the previous default (excluding itself) when updating a policy to be default', async () => {
      mockPrisma.cancellationPolicy.findFirst.mockResolvedValueOnce({ id: 'policy-1', studioId: STUDIO_ID });
      mockPrisma.cancellationPolicy.update.mockResolvedValueOnce({ id: 'policy-1', isDefault: true });

      await service.updateCancellationPolicy(tenant, 'policy-1', { studioId: STUDIO_ID, isDefault: true });

      expect(mockPrisma.cancellationPolicy.updateMany).toHaveBeenCalledWith({
        where: { studioId: STUDIO_ID, isDefault: true, id: { not: 'policy-1' } },
        data: { isDefault: false },
      });
    });

    it('refuses to deactivate the default policy', async () => {
      mockPrisma.cancellationPolicy.findFirst.mockResolvedValueOnce({
        id: 'policy-1',
        studioId: STUDIO_ID,
        isDefault: true,
      });

      await expect(service.deactivateCancellationPolicy(tenant, 'policy-1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('cross-tenant reference validation', () => {
    it('rejects creating a resource with a resource type from another studio', async () => {
      mockPrisma.resourceType.findFirst.mockResolvedValueOnce(null);

      await expect(
        service.createResource(tenant, {
          studioId: STUDIO_ID,
          resourceTypeId: 'other-tenant-resource-type',
          name: 'Reformer 9',
          capacity: 1,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects a service type referencing a cancellation policy from another studio', async () => {
      mockPrisma.cancellationPolicy.findFirst.mockResolvedValueOnce(null);

      await expect(
        service.createServiceType(tenant, {
          studioId: STUDIO_ID,
          name: 'Yeni Hizmet',
          durationMin: 50,
          capacity: 1,
          allowedEntitlementKinds: [EntitlementKind.SESSION_COUNT],
          cancellationPolicyId: 'other-tenant-policy',
          requiresQualification: false,
          healthActivityType: HealthActivityType.OTHER,
          requiredResourceTypes: [],
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects a service type requiring a resource type from another studio', async () => {
      mockPrisma.resourceType.findMany.mockResolvedValueOnce([]);

      await expect(
        service.createServiceType(tenant, {
          studioId: STUDIO_ID,
          name: 'Yeni Hizmet',
          durationMin: 50,
          capacity: 1,
          allowedEntitlementKinds: [EntitlementKind.SESSION_COUNT],
          requiresQualification: false,
          healthActivityType: HealthActivityType.OTHER,
          requiredResourceTypes: [{ resourceTypeId: 'other-tenant-resource-type', quantity: 1 }],
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('resource type deactivation', () => {
    it('refuses to deactivate a resource type with active resources', async () => {
      mockPrisma.resourceType.findFirst.mockResolvedValueOnce({ id: 'rt-1', studioId: STUDIO_ID });
      mockPrisma.resource.findFirst.mockResolvedValueOnce({ id: 'res-1' });

      await expect(service.deactivateResourceType(tenant, 'rt-1')).rejects.toThrow(BadRequestException);
    });
  });
});
