import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { SubscriptionStatus } from '@platform/database';
import { ALL_PERMISSIONS, DEFAULT_ROLE_TEMPLATES } from '@platform/shared';
import type { CreateTenantInput, TenantDetailDTO, TenantListItemDTO } from '@platform/shared';
import { PrismaService } from '../prisma/prisma.service';
import { InvitesService } from '../invites/invites.service';

const TRIAL_PERIOD_DAYS = 30;

@Injectable()
export class AdminTenantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly invites: InvitesService,
  ) {}

  async list(): Promise<TenantListItemDTO[]> {
    const studios = await this.prisma.studio.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        businessTypeTemplate: { select: { key: true } },
        subscriptions: { orderBy: { createdAt: 'desc' }, take: 1, include: { plan: { select: { key: true } } } },
        _count: { select: { branches: true } },
      },
    });
    const [memberCounts, staffCounts] = await Promise.all([
      this.prisma.membership.groupBy({
        by: ['studioId'],
        where: { status: 'ACTIVE', memberProfile: { isNot: null } },
        _count: { _all: true },
      }),
      this.prisma.membership.groupBy({
        by: ['studioId'],
        where: { status: 'ACTIVE', roleTemplate: { isOwner: false }, memberProfile: null },
        _count: { _all: true },
      }),
    ]);
    const memberCountByStudio = new Map(memberCounts.map((m) => [m.studioId, m._count._all]));
    const staffCountByStudio = new Map(staffCounts.map((s) => [s.studioId, s._count._all]));

    return studios.map((s) => ({
      id: s.id,
      name: s.name,
      slug: s.slug,
      isActive: s.isActive,
      businessTypeTemplateKey: s.businessTypeTemplate?.key ?? null,
      planKey: s.subscriptions[0]?.plan.key ?? null,
      subscriptionStatus: s.subscriptions[0]?.status ?? null,
      branchCount: s._count.branches,
      activeMemberCount: memberCountByStudio.get(s.id) ?? 0,
      staffCount: staffCountByStudio.get(s.id) ?? 0,
      createdAt: s.createdAt.toISOString(),
    }));
  }

  async detail(studioId: string): Promise<TenantDetailDTO> {
    const studio = await this.prisma.studio.findUnique({
      where: { id: studioId },
      include: {
        businessTypeTemplate: { select: { key: true } },
        subscriptions: { orderBy: { createdAt: 'desc' }, take: 1, include: { plan: true } },
        _count: { select: { branches: true } },
      },
    });
    if (!studio) throw new NotFoundException('İşletme bulunamadı');

    const [activeMemberCount, staffCount] = await Promise.all([
      this.prisma.membership.count({ where: { studioId, status: 'ACTIVE', memberProfile: { isNot: null } } }),
      this.prisma.membership.count({
        where: { studioId, status: 'ACTIVE', roleTemplate: { isOwner: false }, memberProfile: null },
      }),
    ]);

    const subscription = studio.subscriptions[0];
    return {
      id: studio.id,
      name: studio.name,
      slug: studio.slug,
      isActive: studio.isActive,
      businessTypeTemplateKey: studio.businessTypeTemplate?.key ?? null,
      planKey: subscription?.plan.key ?? null,
      subscriptionStatus: subscription?.status ?? null,
      branchCount: studio._count.branches,
      activeMemberCount,
      staffCount,
      createdAt: studio.createdAt.toISOString(),
      phone: studio.phone,
      email: studio.email,
      timezone: studio.timezone,
      planLimits: (subscription?.plan.limits as TenantDetailDTO['planLimits']) ?? null,
    };
  }

  /**
   * Creates the tenant, its default role templates (packages/shared
   * DEFAULT_ROLE_TEMPLATES), a subscription on the chosen plan, and issues
   * the owner's invite token via the existing invite/onboarding flow
   * (InvitesService.createOwnerInvite) rather than duplicating it.
   */
  async create(actorUserId: string, dto: CreateTenantInput) {
    const [businessType, plan, slugTaken] = await Promise.all([
      this.prisma.businessTypeTemplate.findUnique({ where: { key: dto.businessTypeTemplateKey } }),
      this.prisma.plan.findUnique({ where: { key: dto.planKey } }),
      this.prisma.studio.findUnique({ where: { slug: dto.slug }, select: { id: true } }),
    ]);
    if (!businessType) throw new BadRequestException('İşletme türü şablonu bulunamadı');
    if (!plan) throw new BadRequestException('Plan bulunamadı');
    if (slugTaken) throw new ConflictException('Bu slug zaten kullanılıyor');

    const now = new Date();
    const periodEnd = new Date(now.getTime() + TRIAL_PERIOD_DAYS * 24 * 60 * 60 * 1000);

    const { studioId, ownerRoleTemplateId } = await this.prisma.$transaction(async (tx) => {
      const studio = await tx.studio.create({
        data: { name: dto.name, slug: dto.slug, businessTypeTemplateId: businessType.id },
      });

      const roleTemplates = await Promise.all(
        DEFAULT_ROLE_TEMPLATES.map((role) =>
          tx.roleTemplate.create({
            data: {
              studioId: studio.id,
              key: role.key,
              name: role.name,
              isOwner: role.isOwner,
              isSystem: true,
              permissions: {
                create: (role.isOwner ? ALL_PERMISSIONS : role.permissions).map((permissionKey) => ({ permissionKey })),
              },
            },
          }),
        ),
      );

      await tx.subscription.create({
        data: {
          studioId: studio.id,
          planId: plan.id,
          status: SubscriptionStatus.TRIALING,
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
        },
      });

      await tx.auditLog.create({
        data: {
          studioId: studio.id,
          userId: actorUserId,
          action: 'tenant.create',
          entityType: 'Studio',
          entityId: studio.id,
          metadata: { name: studio.name, slug: studio.slug, planKey: dto.planKey, businessTypeTemplateKey: dto.businessTypeTemplateKey },
        },
      });

      const owner = roleTemplates.find((r) => r.isOwner)!;
      return { studioId: studio.id, ownerRoleTemplateId: owner.id };
    });

    const ownerFullName = `${dto.ownerFirstName} ${dto.ownerLastName}`.trim();
    const invite = await this.invites.createOwnerInvite(
      studioId,
      actorUserId,
      ownerRoleTemplateId,
      dto.ownerPhone,
      ownerFullName,
      dto.ownerChannel,
    );

    return { studioId, ownerInvite: invite };
  }

  async setActive(actorUserId: string, studioId: string, isActive: boolean) {
    const studio = await this.prisma.studio.findUnique({ where: { id: studioId }, select: { id: true, isActive: true } });
    if (!studio) throw new NotFoundException('İşletme bulunamadı');

    const updated = await this.prisma.studio.update({ where: { id: studioId }, data: { isActive } });
    await this.prisma.auditLog.create({
      data: {
        studioId,
        userId: actorUserId,
        action: isActive ? 'tenant.reactivate' : 'tenant.suspend',
        entityType: 'Studio',
        entityId: studioId,
        metadata: { isActive },
      },
    });
    return { id: updated.id, isActive: updated.isActive };
  }

  async assignPlan(actorUserId: string, studioId: string, planKey: string) {
    const [studio, plan] = await Promise.all([
      this.prisma.studio.findUnique({ where: { id: studioId }, select: { id: true } }),
      this.prisma.plan.findUnique({ where: { key: planKey } }),
    ]);
    if (!studio) throw new NotFoundException('İşletme bulunamadı');
    if (!plan) throw new BadRequestException('Plan bulunamadı');

    const now = new Date();
    const periodEnd = new Date(now.getTime() + TRIAL_PERIOD_DAYS * 24 * 60 * 60 * 1000);

    const subscription = await this.prisma.$transaction(async (tx) => {
      await tx.subscription.updateMany({
        where: { studioId, status: { in: [SubscriptionStatus.TRIALING, SubscriptionStatus.ACTIVE] } },
        data: { status: SubscriptionStatus.CANCELLED, cancelledAt: now },
      });
      const created = await tx.subscription.create({
        data: { studioId, planId: plan.id, status: SubscriptionStatus.ACTIVE, currentPeriodStart: now, currentPeriodEnd: periodEnd },
        include: { plan: true },
      });
      await tx.auditLog.create({
        data: {
          studioId,
          userId: actorUserId,
          action: 'tenant.plan_assign',
          entityType: 'Subscription',
          entityId: created.id,
          metadata: { planKey },
        },
      });
      return created;
    });

    return subscription;
  }
}
