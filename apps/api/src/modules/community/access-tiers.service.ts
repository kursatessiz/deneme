import { Injectable } from '@nestjs/common';
import type { Prisma } from '@platform/database';
import type { AccessTierDTO, AccessTierRuleInput, AccessTierRuleKind, CreateAccessTierInput, UpdateAccessTierInput } from '@platform/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { TenantContext } from '../auth/tenant-context';
import { communityError } from './community.errors';

const TIER_INCLUDE = {
  rules: { include: { packageDefinition: { select: { name: true } } }, orderBy: { createdAt: 'asc' } },
  _count: { select: { posts: true } },
} satisfies Prisma.AccessTierInclude;

type TierRow = Prisma.AccessTierGetPayload<{ include: typeof TIER_INCLUDE }>;

/**
 * Access tiers (G5b, docs/TOPLULUK.md): tenant data naming which members
 * may see a post. Every query is scoped to the tenant's studio.
 */
@Injectable()
export class AccessTiersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(tenant: TenantContext): Promise<AccessTierDTO[]> {
    const rows = await this.prisma.accessTier.findMany({ where: { studioId: tenant.studioId }, include: TIER_INCLUDE, orderBy: { name: 'asc' } });
    return rows.map(toTierDTO);
  }

  async create(tenant: TenantContext, userId: string, input: CreateAccessTierInput): Promise<AccessTierDTO> {
    const studioId = tenant.studioId;
    await this.assertPackages(studioId, input.rules);
    const row = await this.prisma.accessTier.create({
      data: {
        studioId,
        name: input.name,
        description: input.description || null,
        rules: { create: dedupeRules(input.rules).map((r) => ({ studioId, kind: r.kind, packageDefinitionId: r.packageDefinitionId })) },
      },
      include: TIER_INCLUDE,
    });
    await this.audit(tenant, userId, 'community.tier.create', row.id, { name: row.name });
    return toTierDTO(row);
  }

  async update(tenant: TenantContext, userId: string, tierId: string, input: UpdateAccessTierInput): Promise<AccessTierDTO> {
    const studioId = tenant.studioId;
    const existing = await this.prisma.accessTier.findFirst({ where: { id: tierId, studioId }, select: { id: true } });
    if (!existing) throw communityError('COMMUNITY_TIER_NOT_FOUND');
    if (input.rules) await this.assertPackages(studioId, input.rules);

    const row = await this.prisma.$transaction(async (tx) => {
      if (input.rules) {
        await tx.accessTierRule.deleteMany({ where: { tierId, studioId } });
        await tx.accessTierRule.createMany({
          data: dedupeRules(input.rules).map((r) => ({ studioId, tierId, kind: r.kind, packageDefinitionId: r.packageDefinitionId })),
        });
      }
      return tx.accessTier.update({
        where: { id: tierId },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description || null } : {}),
        },
        include: TIER_INCLUDE,
      });
    });
    await this.audit(tenant, userId, 'community.tier.update', tierId, { fields: Object.keys(input) });
    return toTierDTO(row);
  }

  /**
   * A tier that any post still uses cannot be deleted: dropping it would
   * silently widen who sees that post. Remove it from the posts first.
   */
  async remove(tenant: TenantContext, userId: string, tierId: string): Promise<void> {
    const studioId = tenant.studioId;
    const existing = await this.prisma.accessTier.findFirst({ where: { id: tierId, studioId }, include: { _count: { select: { posts: true } } } });
    if (!existing) throw communityError('COMMUNITY_TIER_NOT_FOUND');
    if (existing._count.posts > 0) throw communityError('COMMUNITY_TIER_IN_USE');
    await this.prisma.accessTier.delete({ where: { id: tierId } });
    await this.audit(tenant, userId, 'community.tier.delete', tierId, { name: existing.name });
  }

  private async assertPackages(studioId: string, rules: AccessTierRuleInput[]): Promise<void> {
    const ids = [...new Set(rules.map((r) => r.packageDefinitionId).filter((id): id is string => id !== null))];
    if (ids.length === 0) return;
    const count = await this.prisma.packageDefinition.count({ where: { id: { in: ids }, studioId } });
    if (count !== ids.length) throw communityError('COMMUNITY_PACKAGE_NOT_FOUND');
  }

  private audit(tenant: TenantContext, userId: string, action: string, entityId: string, metadata: Prisma.InputJsonObject) {
    return this.prisma.auditLog.create({ data: { studioId: tenant.studioId, userId, action, entityType: 'AccessTier', entityId, metadata } });
  }
}

/** Drops repeated rules (same kind and package). */
function dedupeRules(rules: AccessTierRuleInput[]): AccessTierRuleInput[] {
  const seen = new Set<string>();
  return rules.filter((r) => {
    const key = `${r.kind}:${r.packageDefinitionId ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function toTierDTO(row: TierRow): AccessTierDTO {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    rules: row.rules.map((r) => ({
      kind: r.kind as AccessTierRuleKind,
      packageDefinitionId: r.packageDefinitionId,
      packageDefinitionName: r.packageDefinition?.name ?? null,
    })),
    postCount: row._count.posts,
    createdAt: row.createdAt.toISOString(),
  };
}
