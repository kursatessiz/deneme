import { Injectable } from '@nestjs/common';
import { FeatureFlagScope, Prisma } from '@platform/database';
import type { SetFeatureFlagInput } from '@platform/shared';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Single resolver for feature flags, used both by the admin API (to list
 * effective state) and by any other module that needs to gate a feature.
 * Resolution order (see FeatureFlag doc comment in schema.prisma):
 * TENANT > BUSINESS_TYPE > GLOBAL. The most specific row that exists wins,
 * even if it is `enabled: false` (an explicit tenant override can turn a
 * globally-on feature off, and vice versa).
 *
 * `businessTypeTemplateId`/`studioId` are nullable and part of the
 * compound unique key (`@@unique([key, scope, businessTypeTemplateId,
 * studioId])`, enforced NULLS NOT DISTINCT at the database, see the init
 * migration). Prisma's generated `findUnique`/`upsert` typing does not
 * accept `null` for those fields even though the constraint does, so this
 * service reads and writes them with findFirst/create/update instead.
 */
@Injectable()
export class FeatureFlagsService {
  constructor(private readonly prisma: PrismaService) {}

  async isFeatureEnabled(studioId: string, key: string): Promise<boolean> {
    const studio = await this.prisma.studio.findUnique({
      where: { id: studioId },
      select: { businessTypeTemplateId: true },
    });

    const [tenantFlag, businessTypeFlag, globalFlag] = await Promise.all([
      this.prisma.featureFlag.findFirst({ where: { key, scope: FeatureFlagScope.TENANT, studioId } }),
      studio?.businessTypeTemplateId
        ? this.prisma.featureFlag.findFirst({
            where: { key, scope: FeatureFlagScope.BUSINESS_TYPE, businessTypeTemplateId: studio.businessTypeTemplateId },
          })
        : Promise.resolve(null),
      this.prisma.featureFlag.findFirst({ where: { key, scope: FeatureFlagScope.GLOBAL } }),
    ]);

    if (tenantFlag) return tenantFlag.enabled;
    if (businessTypeFlag) return businessTypeFlag.enabled;
    if (globalFlag) return globalFlag.enabled;
    return false;
  }

  async list() {
    return this.prisma.featureFlag.findMany({
      include: { businessTypeTemplate: { select: { key: true, name: true } }, studio: { select: { name: true, slug: true } } },
      orderBy: [{ key: 'asc' }, { scope: 'asc' }],
    });
  }

  async set(actorUserId: string, input: SetFeatureFlagInput) {
    const data: Prisma.FeatureFlagUncheckedCreateInput = {
      key: input.key,
      scope: input.scope,
      businessTypeTemplateId: input.scope === FeatureFlagScope.BUSINESS_TYPE ? input.businessTypeTemplateId! : null,
      studioId: input.scope === FeatureFlagScope.TENANT ? input.studioId! : null,
      enabled: input.enabled,
    };

    const flag = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.featureFlag.findFirst({
        where: { key: data.key, scope: data.scope, businessTypeTemplateId: data.businessTypeTemplateId ?? null, studioId: data.studioId ?? null },
      });
      if (existing) {
        return tx.featureFlag.update({ where: { id: existing.id }, data: { enabled: input.enabled } });
      }
      return tx.featureFlag.create({ data });
    });

    await this.prisma.auditLog.create({
      data: {
        studioId: data.studioId ?? null,
        userId: actorUserId,
        action: 'feature_flag.set',
        entityType: 'FeatureFlag',
        entityId: flag.id,
        metadata: { key: input.key, scope: input.scope, enabled: input.enabled },
      },
    });
    return flag;
  }
}
