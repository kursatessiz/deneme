import { Injectable, NotFoundException } from '@nestjs/common';
import type { UpsertBusinessTypeTemplateInput } from '@platform/shared';
import { PrismaService } from '../prisma/prisma.service';

const DEFAULT_SERVICE_DURATION_MIN = 50;
const DEFAULT_SERVICE_CAPACITY = 1;

@Injectable()
export class AdminBusinessTypesService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    return this.prisma.businessTypeTemplate.findMany({ orderBy: { name: 'asc' } });
  }

  async upsert(actorUserId: string, input: UpsertBusinessTypeTemplateInput) {
    const template = await this.prisma.businessTypeTemplate.upsert({
      where: { key: input.key },
      create: {
        key: input.key,
        name: input.name,
        vocabulary: input.vocabulary,
        defaults: input.defaults as object,
        enabledModules: input.enabledModules,
        isActive: input.isActive,
      },
      update: {
        name: input.name,
        vocabulary: input.vocabulary,
        defaults: input.defaults as object,
        enabledModules: input.enabledModules,
        isActive: input.isActive,
      },
    });
    await this.prisma.auditLog.create({
      data: {
        studioId: null,
        userId: actorUserId,
        action: 'business_type_template.upsert',
        entityType: 'BusinessTypeTemplate',
        entityId: template.id,
        metadata: { key: input.key },
      },
    });
    return template;
  }

  /**
   * Applies a template's default resource types and service types to a
   * tenant that has none yet (e.g. a new tenant created without them, or a
   * tenant whose business type template changed). Never overwrites
   * existing rows of the same name - it only fills gaps, so it is safe to
   * call more than once. `defaults` shape matches what the seed data and
   * UpsertBusinessTypeTemplateSchema already use:
   * `{ serviceTypeNames: string[], resourceTypeNames: string[] }`. Service
   * types get a generic duration/capacity the tenant is expected to tune
   * afterwards - CLAUDE.md forbids hardcoding sector-specific durations
   * here.
   */
  async applyToTenant(actorUserId: string, studioId: string, templateKey: string) {
    const [studio, template] = await Promise.all([
      this.prisma.studio.findUnique({ where: { id: studioId }, select: { id: true } }),
      this.prisma.businessTypeTemplate.findUnique({ where: { key: templateKey } }),
    ]);
    if (!studio) throw new NotFoundException('İşletme bulunamadı');
    if (!template) throw new NotFoundException('İşletme türü şablonu bulunamadı');

    const defaults = (template.defaults ?? {}) as {
      resourceTypeNames?: string[];
      serviceTypeNames?: string[];
    };

    const result = await this.prisma.$transaction(async (tx) => {
      let resourceTypesCreated = 0;
      for (const name of defaults.resourceTypeNames ?? []) {
        const existing = await tx.resourceType.findFirst({ where: { studioId, name } });
        if (existing) continue;
        await tx.resourceType.create({ data: { studioId, name } });
        resourceTypesCreated += 1;
      }

      let serviceTypesCreated = 0;
      for (const name of defaults.serviceTypeNames ?? []) {
        const existing = await tx.serviceType.findFirst({ where: { studioId, name } });
        if (existing) continue;
        await tx.serviceType.create({
          data: { studioId, name, durationMin: DEFAULT_SERVICE_DURATION_MIN, capacity: DEFAULT_SERVICE_CAPACITY },
        });
        serviceTypesCreated += 1;
      }

      await tx.studio.update({ where: { id: studioId }, data: { businessTypeTemplateId: template.id } });

      await tx.auditLog.create({
        data: {
          studioId,
          userId: actorUserId,
          action: 'business_type_template.apply',
          entityType: 'Studio',
          entityId: studioId,
          metadata: { templateKey, resourceTypesCreated, serviceTypesCreated },
        },
      });

      return { resourceTypesCreated, serviceTypesCreated };
    });

    return result;
  }
}
