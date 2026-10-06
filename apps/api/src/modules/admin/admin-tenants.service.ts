import { BadRequestException, ConflictException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { FeatureFlagScope, SubscriptionStatus } from '@platform/database';
import {
  ALL_PERMISSIONS,
  DEFAULT_ROLE_TEMPLATES,
  DEFAULT_THEME_FAMILY,
  GRADIENT_PRESET_KEYS_BY_FAMILY,
  OPTIONAL_THEME_FAMILY_KEYS,
  countryDefaultsOf,
  getThemeFamily,
  isThemeFamilyKey,
  themeFamilyFlagKey,
} from '@platform/shared';
import type {
  CreateTenantInput,
  TenantDetailDTO,
  TenantListItemDTO,
  TenantThemeFamiliesDTO,
  UpdateTenantThemeFamiliesInput,
} from '@platform/shared';
import { loadAllowedThemeFamiliesForStudio } from '../appearance/theme-families';
import { PrismaService } from '../prisma/prisma.service';
import { InvitesService } from '../invites/invites.service';
import { CrmHooksService } from '../crm/hooks/crm-hooks.service';
import { PlatformBillingService } from '../billing/platform-billing.service';
import { StudioReferralsService } from '../billing/studio-referrals.service';
import { isPlatformBillingCurrency, isStudioBillingStatus, studioBillingCurrency } from '@platform/shared';
import { apiError } from '../../common/api-error';

/** Period of a plan the super admin assigns by hand (not a trial; trials use Plan.trialDays). */
const ASSIGNED_PERIOD_DAYS = 30;

@Injectable()
export class AdminTenantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly invites: InvitesService,
    private readonly billing: PlatformBillingService,
    private readonly referrals: StudioReferralsService,
    @Optional() private readonly crm?: CrmHooksService,
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
      billingStatus: isStudioBillingStatus(s.billingStatus) ? s.billingStatus : 'ACTIVE',
      trialEndsAt: s.trialEndsAt?.toISOString() ?? null,
      activatedAt: s.activatedAt?.toISOString() ?? null,
      countryCode: s.countryCode,
      billingCurrency: studioBillingCurrency(s),
      billingCurrencyOverride: isPlatformBillingCurrency(s.billingCurrency) ? s.billingCurrency : null,
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
    if (!studio) throw new NotFoundException(apiError('apiErrors.common.businessNotFound'));

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
      billingStatus: isStudioBillingStatus(studio.billingStatus) ? studio.billingStatus : 'ACTIVE',
      trialEndsAt: studio.trialEndsAt?.toISOString() ?? null,
      activatedAt: studio.activatedAt?.toISOString() ?? null,
      countryCode: studio.countryCode,
      billingCurrency: studioBillingCurrency(studio),
      billingCurrencyOverride: isPlatformBillingCurrency(studio.billingCurrency) ? studio.billingCurrency : null,
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
    if (!businessType) throw new BadRequestException(apiError('apiErrors.admin.businessTypeTemplateNotFound'));
    if (!plan) throw new BadRequestException(apiError('apiErrors.common.planNotFound'));
    if (slugTaken) throw new ConflictException(apiError('apiErrors.admin.slugAlreadyUse'));

    const now = new Date();

    const regionDefaults = countryDefaultsOf(dto.countryCode);

    const { studioId, ownerRoleTemplateId } = await this.prisma.$transaction(async (tx) => {
      const studio = await tx.studio.create({
        data: {
          name: dto.name,
          slug: dto.slug,
          businessTypeTemplateId: businessType.id,
          countryCode: dto.countryCode,
          currency: regionDefaults.currency,
          timezone: regionDefaults.timezone,
          taxRegime: regionDefaults.taxRegime,
          defaultLocale: regionDefaults.defaultLocale,
        },
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

      // G5c-1: every new business starts on the plan's trial (Plan.trialDays).
      const trialEndsAt = await this.billing.startTrial(tx, studio.id, plan, now);
      await tx.subscription.create({
        data: {
          studioId: studio.id,
          planId: plan.id,
          status: SubscriptionStatus.TRIALING,
          currentPeriodStart: now,
          currentPeriodEnd: trialEndsAt,
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

    // Default pipeline stages, and studio_signup on the platform tenant when
    // its CRM already knows the owner (e.g. from a landing page form).
    await this.crm?.onStudioCreated(studioId, dto.ownerPhone);
    // G5c-1: the referring business, from the code given or the owner's pw_ref visit.
    await this.referrals.recordSignup(studioId, dto.ownerPhone, dto.referralCode ?? null);

    return { studioId, ownerInvite: invite };
  }

  /** The studio's theme-family allow-list and the family stored on it. */
  async getThemeFamilies(studioId: string): Promise<TenantThemeFamiliesDTO> {
    const studio = await this.prisma.studio.findUnique({ where: { id: studioId }, select: { themeFamily: true } });
    if (!studio) throw new NotFoundException(apiError('apiErrors.common.businessNotFound'));
    return {
      allowed: await loadAllowedThemeFamiliesForStudio(this.prisma, studioId),
      current: isThemeFamilyKey(studio.themeFamily) ? studio.themeFamily : DEFAULT_THEME_FAMILY,
    };
  }

  /**
   * Replaces the allow-list (one tenant-scoped `theme_family.<key>` flag per
   * optional family; the default family needs none) and sets the family the
   * studio uses. A non-default family also gets one of its own gradient
   * preset keys when the stored one belongs elsewhere, because the theme
   * schema ties a non-default family to its presets.
   */
  async setThemeFamilies(actorUserId: string, studioId: string, input: UpdateTenantThemeFamiliesInput): Promise<TenantThemeFamiliesDTO> {
    const studio = await this.prisma.studio.findUnique({ where: { id: studioId }, select: { themeFamily: true, gradientPresetKey: true } });
    if (!studio) throw new NotFoundException(apiError('apiErrors.common.businessNotFound'));
    const before = await this.getThemeFamilies(studioId);

    await this.prisma.$transaction(async (tx) => {
      for (const key of OPTIONAL_THEME_FAMILY_KEYS) {
        const enabled = input.allowed.includes(key);
        const where = { key: themeFamilyFlagKey(key), scope: FeatureFlagScope.TENANT, studioId, businessTypeTemplateId: null };
        const existing = await tx.featureFlag.findFirst({ where });
        if (existing) await tx.featureFlag.update({ where: { id: existing.id }, data: { enabled } });
        else await tx.featureFlag.create({ data: { ...where, enabled } });
      }
      const presets = GRADIENT_PRESET_KEYS_BY_FAMILY[input.current] as readonly string[];
      await tx.studio.update({
        where: { id: studioId },
        data: {
          themeFamily: input.current,
          ...(input.current !== DEFAULT_THEME_FAMILY && !presets.includes(studio.gradientPresetKey)
            ? { gradientPresetKey: getThemeFamily(input.current).gradients[0].key }
            : {}),
        },
      });
      await tx.auditLog.create({
        data: {
          studioId,
          userId: actorUserId,
          action: 'tenant.theme_families.update',
          entityType: 'Studio',
          entityId: studioId,
          metadata: { before: { allowed: before.allowed, current: before.current }, after: { allowed: input.allowed, current: input.current } },
        },
      });
    });
    return this.getThemeFamilies(studioId);
  }

  async setActive(actorUserId: string, studioId: string, isActive: boolean) {
    const studio = await this.prisma.studio.findUnique({ where: { id: studioId }, select: { id: true, isActive: true } });
    if (!studio) throw new NotFoundException(apiError('apiErrors.common.businessNotFound'));

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
    if (!studio) throw new NotFoundException(apiError('apiErrors.common.businessNotFound'));
    if (!plan) throw new BadRequestException(apiError('apiErrors.common.planNotFound'));

    const now = new Date();
    const periodEnd = new Date(now.getTime() + ASSIGNED_PERIOD_DAYS * 24 * 60 * 60 * 1000);

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
