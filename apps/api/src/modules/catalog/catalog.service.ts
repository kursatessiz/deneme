import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { TenantContext } from '../auth/tenant-context';
import { Prisma } from '@platform/database';
import type {
  CreateResourceTypeInput,
  UpdateResourceTypeInput,
  CreateResourceInput,
  UpdateResourceInput,
  CreateCancellationPolicyInput,
  UpdateCancellationPolicyInput,
  CreateServiceTypeInput,
  UpdateServiceTypeInput,
  ServiceTypeQualificationInput,
} from '@platform/shared';

@Injectable()
export class CatalogService {
  constructor(private prisma: PrismaService) {}

  // ---------------------------------------------------------------------
  // Resource types
  // ---------------------------------------------------------------------

  async listResourceTypes(tenant: TenantContext) {
    return this.prisma.resourceType.findMany({
      where: { studioId: tenant.studioId },
      orderBy: { name: 'asc' },
    });
  }

  async createResourceType(tenant: TenantContext, dto: CreateResourceTypeInput) {
    try {
      return await this.prisma.resourceType.create({
        data: { studioId: tenant.studioId, name: dto.name, selectableByMember: dto.selectableByMember },
      });
    } catch (err) {
      if (this.isUniqueViolation(err)) throw new ConflictException('Bu isimde bir kaynak türü zaten var');
      throw err;
    }
  }

  async updateResourceType(tenant: TenantContext, id: string, dto: UpdateResourceTypeInput) {
    await this.getOwnedResourceType(tenant.studioId, id);
    try {
      return await this.prisma.resourceType.update({
        where: { id },
        data: { name: dto.name, selectableByMember: dto.selectableByMember },
      });
    } catch (err) {
      if (this.isUniqueViolation(err)) throw new ConflictException('Bu isimde bir kaynak türü zaten var');
      throw err;
    }
  }

  async deactivateResourceType(tenant: TenantContext, id: string) {
    await this.getOwnedResourceType(tenant.studioId, id);
    const inUse = await this.prisma.resource.findFirst({
      where: { resourceTypeId: id, studioId: tenant.studioId, isActive: true },
    });
    if (inUse) {
      throw new BadRequestException('Bu kaynak türüne bağlı aktif kaynaklar var, önce onları pasifleştirin');
    }
    return this.prisma.resourceType.update({ where: { id }, data: { isActive: false } });
  }

  // ---------------------------------------------------------------------
  // Resources
  // ---------------------------------------------------------------------

  async listResources(tenant: TenantContext) {
    return this.prisma.resource.findMany({
      where: { studioId: tenant.studioId },
      include: { resourceType: true },
      orderBy: { name: 'asc' },
    });
  }

  async createResource(tenant: TenantContext, dto: CreateResourceInput) {
    const studioId = tenant.studioId;
    await this.getOwnedResourceType(studioId, dto.resourceTypeId);
    if (dto.branchId) await this.assertOwnedBranch(studioId, dto.branchId);
    if (dto.parentResourceId) await this.getOwnedResource(studioId, dto.parentResourceId);

    return this.prisma.resource.create({
      data: {
        studioId,
        branchId: dto.branchId,
        resourceTypeId: dto.resourceTypeId,
        parentResourceId: dto.parentResourceId,
        name: dto.name,
        capacity: dto.capacity,
        serialNumber: dto.serialNumber,
        layoutX: dto.layoutX,
        layoutY: dto.layoutY,
        label: dto.label,
      },
    });
  }

  async updateResource(tenant: TenantContext, id: string, dto: UpdateResourceInput) {
    const studioId = tenant.studioId;
    await this.getOwnedResource(studioId, id);
    if (dto.resourceTypeId) await this.getOwnedResourceType(studioId, dto.resourceTypeId);
    if (dto.branchId) await this.assertOwnedBranch(studioId, dto.branchId);
    if (dto.parentResourceId) {
      if (dto.parentResourceId === id) {
        throw new BadRequestException('Bir kaynak kendisinin üst kaynağı olamaz');
      }
      await this.getOwnedResource(studioId, dto.parentResourceId);
    }

    return this.prisma.resource.update({
      where: { id },
      data: {
        branchId: dto.branchId === null ? null : dto.branchId,
        resourceTypeId: dto.resourceTypeId,
        parentResourceId: dto.parentResourceId === null ? null : dto.parentResourceId,
        name: dto.name,
        capacity: dto.capacity,
        serialNumber: dto.serialNumber === null ? null : dto.serialNumber,
        isMaintenance: dto.isMaintenance,
        layoutX: dto.layoutX === null ? null : dto.layoutX,
        layoutY: dto.layoutY === null ? null : dto.layoutY,
        label: dto.label === null ? null : dto.label,
      },
    });
  }

  async deactivateResource(tenant: TenantContext, id: string) {
    await this.getOwnedResource(tenant.studioId, id);
    return this.prisma.resource.update({ where: { id }, data: { isActive: false } });
  }

  // ---------------------------------------------------------------------
  // Cancellation policies
  // ---------------------------------------------------------------------

  async listCancellationPolicies(tenant: TenantContext) {
    return this.prisma.cancellationPolicy.findMany({
      where: { studioId: tenant.studioId },
      orderBy: { name: 'asc' },
    });
  }

  async createCancellationPolicy(tenant: TenantContext, dto: CreateCancellationPolicyInput) {
    const studioId = tenant.studioId;
    return this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) {
        await tx.cancellationPolicy.updateMany({ where: { studioId, isDefault: true }, data: { isDefault: false } });
      }
      return tx.cancellationPolicy.create({
        data: {
          studioId,
          name: dto.name,
          freeCancelHours: dto.freeCancelHours,
          lateCancelChargeUnits: dto.lateCancelChargeUnits,
          noShowChargeUnits: dto.noShowChargeUnits,
          isDefault: dto.isDefault,
        },
      });
    });
  }

  async updateCancellationPolicy(tenant: TenantContext, id: string, dto: UpdateCancellationPolicyInput) {
    const studioId = tenant.studioId;
    await this.getOwnedPolicy(studioId, id);
    return this.prisma.$transaction(async (tx) => {
      if (dto.isDefault === true) {
        await tx.cancellationPolicy.updateMany({
          where: { studioId, isDefault: true, id: { not: id } },
          data: { isDefault: false },
        });
      }
      return tx.cancellationPolicy.update({
        where: { id },
        data: {
          name: dto.name,
          freeCancelHours: dto.freeCancelHours,
          lateCancelChargeUnits: dto.lateCancelChargeUnits,
          noShowChargeUnits: dto.noShowChargeUnits,
          isDefault: dto.isDefault,
        },
      });
    });
  }

  async deactivateCancellationPolicy(tenant: TenantContext, id: string) {
    const policy = await this.getOwnedPolicy(tenant.studioId, id);
    if (policy.isDefault) {
      throw new BadRequestException('Varsayılan iptal politikası pasifleştirilemez, önce başka bir politikayı varsayılan yapın');
    }
    const inUse = await this.prisma.serviceType.findFirst({
      where: { cancellationPolicyId: id, studioId: tenant.studioId, isActive: true },
    });
    if (inUse) {
      throw new BadRequestException('Bu politikayı kullanan aktif hizmet türleri var');
    }
    return this.prisma.cancellationPolicy.update({ where: { id }, data: { isActive: false } });
  }

  // ---------------------------------------------------------------------
  // Service types
  // ---------------------------------------------------------------------

  async listServiceTypes(tenant: TenantContext) {
    return this.prisma.serviceType.findMany({
      where: { studioId: tenant.studioId },
      include: { requiredResourceTypes: true, qualifiedTrainers: true },
      orderBy: { name: 'asc' },
    });
  }

  async createServiceType(tenant: TenantContext, dto: CreateServiceTypeInput) {
    const studioId = tenant.studioId;
    if (dto.cancellationPolicyId) await this.getOwnedPolicy(studioId, dto.cancellationPolicyId);
    if (dto.commissionRuleId) await this.assertOwnedCommissionRule(studioId, dto.commissionRuleId);
    if (dto.prerequisiteFormId) await this.assertOwnedForm(studioId, dto.prerequisiteFormId);
    await this.assertOwnedResourceTypes(
      studioId,
      dto.requiredResourceTypes.map((r) => r.resourceTypeId),
    );

    try {
      return await this.prisma.serviceType.create({
        data: {
          studioId,
          name: dto.name,
          description: dto.description,
          durationMin: dto.durationMin,
          capacity: dto.capacity,
          minRepeatIntervalDays: dto.minRepeatIntervalDays,
          prerequisiteFormId: dto.prerequisiteFormId,
          allowedEntitlementKinds: dto.allowedEntitlementKinds,
          cancellationPolicyId: dto.cancellationPolicyId,
          commissionRuleId: dto.commissionRuleId,
          requiresQualification: dto.requiresQualification,
          requiredResourceTypes: {
            create: dto.requiredResourceTypes.map((r) => ({ resourceTypeId: r.resourceTypeId, quantity: r.quantity })),
          },
        },
        include: { requiredResourceTypes: true },
      });
    } catch (err) {
      if (this.isUniqueViolation(err)) throw new ConflictException('Bu isimde bir hizmet türü zaten var');
      throw err;
    }
  }

  async updateServiceType(tenant: TenantContext, id: string, dto: UpdateServiceTypeInput) {
    const studioId = tenant.studioId;
    await this.getOwnedServiceType(studioId, id);
    if (dto.cancellationPolicyId) await this.getOwnedPolicy(studioId, dto.cancellationPolicyId);
    if (dto.commissionRuleId) await this.assertOwnedCommissionRule(studioId, dto.commissionRuleId);
    if (dto.prerequisiteFormId) await this.assertOwnedForm(studioId, dto.prerequisiteFormId);
    if (dto.requiredResourceTypes) {
      await this.assertOwnedResourceTypes(
        studioId,
        dto.requiredResourceTypes.map((r) => r.resourceTypeId),
      );
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        if (dto.requiredResourceTypes) {
          await tx.serviceTypeResourceType.deleteMany({ where: { serviceTypeId: id } });
          if (dto.requiredResourceTypes.length > 0) {
            await tx.serviceTypeResourceType.createMany({
              data: dto.requiredResourceTypes.map((r) => ({
                serviceTypeId: id,
                resourceTypeId: r.resourceTypeId,
                quantity: r.quantity,
              })),
            });
          }
        }
        return tx.serviceType.update({
          where: { id },
          data: {
            name: dto.name,
            description: dto.description === null ? null : dto.description,
            durationMin: dto.durationMin,
            capacity: dto.capacity,
            minRepeatIntervalDays: dto.minRepeatIntervalDays === null ? null : dto.minRepeatIntervalDays,
            prerequisiteFormId: dto.prerequisiteFormId === null ? null : dto.prerequisiteFormId,
            allowedEntitlementKinds: dto.allowedEntitlementKinds,
            cancellationPolicyId: dto.cancellationPolicyId === null ? null : dto.cancellationPolicyId,
            commissionRuleId: dto.commissionRuleId === null ? null : dto.commissionRuleId,
            requiresQualification: dto.requiresQualification,
          },
          include: { requiredResourceTypes: true },
        });
      });
    } catch (err) {
      if (this.isUniqueViolation(err)) throw new ConflictException('Bu isimde bir hizmet türü zaten var');
      throw err;
    }
  }

  async deactivateServiceType(tenant: TenantContext, id: string) {
    await this.getOwnedServiceType(tenant.studioId, id);
    return this.prisma.serviceType.update({ where: { id }, data: { isActive: false } });
  }

  async addQualification(tenant: TenantContext, serviceTypeId: string, dto: ServiceTypeQualificationInput) {
    const studioId = tenant.studioId;
    await this.getOwnedServiceType(studioId, serviceTypeId);
    const trainer = await this.prisma.trainerProfile.findFirst({
      where: { id: dto.trainerProfileId, studioId },
    });
    if (!trainer) throw new NotFoundException('Eğitmen bulunamadı');

    return this.prisma.trainerQualification.upsert({
      where: { trainerProfileId_serviceTypeId: { trainerProfileId: dto.trainerProfileId, serviceTypeId } },
      create: { trainerProfileId: dto.trainerProfileId, serviceTypeId },
      update: {},
    });
  }

  async removeQualification(tenant: TenantContext, serviceTypeId: string, trainerProfileId: string) {
    await this.getOwnedServiceType(tenant.studioId, serviceTypeId);
    await this.prisma.trainerQualification.deleteMany({
      where: { serviceTypeId, trainerProfileId },
    });
    return { removed: true };
  }

  // ---------------------------------------------------------------------
  // Cross-tenant guards
  // ---------------------------------------------------------------------

  private async getOwnedResourceType(studioId: string, id: string) {
    const row = await this.prisma.resourceType.findFirst({ where: { id, studioId } });
    if (!row) throw new NotFoundException('Kaynak türü bulunamadı');
    return row;
  }

  private async getOwnedResource(studioId: string, id: string) {
    const row = await this.prisma.resource.findFirst({ where: { id, studioId } });
    if (!row) throw new NotFoundException('Kaynak bulunamadı');
    return row;
  }

  private async getOwnedPolicy(studioId: string, id: string) {
    const row = await this.prisma.cancellationPolicy.findFirst({ where: { id, studioId } });
    if (!row) throw new NotFoundException('İptal politikası bulunamadı');
    return row;
  }

  private async getOwnedServiceType(studioId: string, id: string) {
    const row = await this.prisma.serviceType.findFirst({ where: { id, studioId } });
    if (!row) throw new NotFoundException('Hizmet türü bulunamadı');
    return row;
  }

  private async assertOwnedBranch(studioId: string, id: string) {
    const row = await this.prisma.branch.findFirst({ where: { id, studioId } });
    if (!row) throw new BadRequestException('Seçilen şube bu işletmede bulunamadı');
  }

  private async assertOwnedCommissionRule(studioId: string, id: string) {
    const row = await this.prisma.commissionRule.findFirst({ where: { id, studioId } });
    if (!row) throw new BadRequestException('Seçilen komisyon kuralı bu işletmede bulunamadı');
  }

  private async assertOwnedForm(studioId: string, id: string) {
    const row = await this.prisma.measurementFormTemplate.findFirst({
      where: { id, OR: [{ studioId }, { studioId: null }] },
    });
    if (!row) throw new BadRequestException('Seçilen ölçüm formu bu işletmede bulunamadı');
  }

  private async assertOwnedResourceTypes(studioId: string, ids: string[]) {
    const unique = Array.from(new Set(ids));
    if (unique.length === 0) return;
    const rows = await this.prisma.resourceType.findMany({ where: { id: { in: unique }, studioId } });
    if (rows.length !== unique.length) {
      throw new BadRequestException('Seçilen kaynak türlerinden biri bu işletmede bulunamadı');
    }
  }

  private isUniqueViolation(err: unknown): boolean {
    return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
  }
}
