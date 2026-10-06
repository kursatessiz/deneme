import { Injectable } from '@nestjs/common';
import { Prisma, VideoContentVisibility } from '@platform/database';
import { apiErrorBaseMessage } from '@platform/shared';
import type { AccessTierRuleKind, ApiErrorKey } from '@platform/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { TenantContext } from '../auth/tenant-context';
import { communityError } from './community.errors';

/** What one caller may see in the community feed of one studio. */
export interface CommunityAccess {
  studioId: string;
  membershipId: string | null;
  /** Staff with community.view or community.manage, and super admins: every published post. */
  seesEverything: boolean;
  /** The caller has a member profile in this studio. */
  isMember: boolean;
  /** Package definitions of the member's ACTIVE, unexpired packages. */
  activePackageDefinitionIds: ReadonlySet<string>;
}

/** Whether the tenant's permissions let the caller read every post regardless of tiers. */
export function seesEveryPost(tenant: Pick<TenantContext, 'isSuperAdmin' | 'permissions'>): boolean {
  return tenant.isSuperAdmin || tenant.permissions.has('community.view') || tenant.permissions.has('community.manage');
}

/**
 * The rule kinds (and package definitions) a caller satisfies. An empty list
 * means no tier can ever match. Exported for the unit tests.
 */
export function satisfiedRuleFilters(access: Pick<CommunityAccess, 'isMember' | 'activePackageDefinitionIds'>): Prisma.AccessTierRuleWhereInput[] {
  if (!access.isMember) return [];
  const rules: Prisma.AccessTierRuleWhereInput[] = [{ kind: 'ACTIVE_MEMBER' satisfies AccessTierRuleKind }];
  const ids = [...access.activePackageDefinitionIds];
  if (ids.length > 0) {
    rules.push({ kind: 'ACTIVE_PACKAGE' satisfies AccessTierRuleKind });
    rules.push({ kind: 'PACKAGE_DEFINITION' satisfies AccessTierRuleKind, packageDefinitionId: { in: ids } });
  }
  return rules;
}

/**
 * Where-clause for the posts a caller may read: always one studio and only
 * PUBLISHED posts. Staff who see everything skip the tier filter; everyone
 * else needs a post without tiers or one tier with a satisfied rule. The
 * feed, a single post, its comments and likes all go through this one
 * clause, so pagination and single reads can never disagree.
 */
export function visiblePostsWhere(access: CommunityAccess): Prisma.CommunityPostWhereInput {
  const base: Prisma.CommunityPostWhereInput = { studioId: access.studioId, status: 'PUBLISHED' };
  if (access.seesEverything) return base;
  const rules = satisfiedRuleFilters(access);
  const anyTier: Prisma.CommunityPostWhereInput[] = [{ tiers: { none: {} } }];
  if (rules.length > 0) anyTier.push({ tiers: { some: { tier: { studioId: access.studioId, rules: { some: { OR: rules } } } } } });
  return { ...base, OR: anyTier };
}

/** Lock state of a video item: `reason` is the Turkish base text, `reasonKey` its apiErrors key for translation. */
export interface VideoLockResult {
  locked: boolean;
  reason: string | null;
  reasonKey: ApiErrorKey | null;
}

function lockedFor(reasonKey: ApiErrorKey): VideoLockResult {
  return { locked: true, reason: apiErrorBaseMessage(reasonKey), reasonKey };
}

/** Lock state of a video library item for one member (W19 rules, unchanged). */
export function videoLock(
  content: { visibility: VideoContentVisibility | string; packages?: { packageDefinitionId: string }[] },
  activePackageDefIds: ReadonlySet<string>,
): VideoLockResult {
  if (content.visibility === VideoContentVisibility.ALL_MEMBERS) {
    return { locked: false, reason: null, reasonKey: null };
  }
  if (content.visibility === VideoContentVisibility.MEMBERS_WITH_ACTIVE_PACKAGE) {
    if (activePackageDefIds.size > 0) return { locked: false, reason: null, reasonKey: null };
    return lockedFor('apiErrors.community.activePackageRequiredToWatch');
  }
  // SPECIFIC_PACKAGES
  const required = content.packages ?? [];
  const unlocked = required.some((p) => activePackageDefIds.has(p.packageDefinitionId));
  if (unlocked) return { locked: false, reason: null, reasonKey: null };
  return lockedFor('apiErrors.community.contentForSpecificPackagesOnly');
}

/**
 * The single access resolver for members-only content (G5b,
 * docs/TOPLULUK.md): the community feed and the video library (W19) both
 * read a member's entitlement from here. A package counts while it is
 * ACTIVE and its end date has not passed; FROZEN, DEPLETED and EXPIRED
 * packages never grant access.
 */
@Injectable()
export class CommunityAccessService {
  constructor(private readonly prisma: PrismaService) {}

  /** Package-definition ids covered by the member's currently ACTIVE, unexpired packages. */
  async activePackageDefinitionIds(studioId: string, memberId: string, now: Date = new Date()): Promise<Set<string>> {
    const packages = await this.prisma.memberPackage.findMany({
      where: { studioId, memberId, status: 'ACTIVE', endDate: { gte: now } },
      select: { packageDefinitionId: true },
    });
    return new Set(packages.map((p) => p.packageDefinitionId));
  }

  /**
   * Resolves the caller's access. A caller who is neither a member nor
   * staff with community.view gets 403 COMMUNITY_MEMBERS_ONLY.
   */
  async resolve(tenant: TenantContext): Promise<CommunityAccess> {
    const seesEverything = seesEveryPost(tenant);
    const isMember = tenant.memberProfileId !== null;
    if (!seesEverything && !isMember) throw communityError('COMMUNITY_MEMBERS_ONLY');
    const activePackageDefinitionIds = tenant.memberProfileId
      ? await this.activePackageDefinitionIds(tenant.studioId, tenant.memberProfileId)
      : new Set<string>();
    return { studioId: tenant.studioId, membershipId: tenant.membershipId, seesEverything, isMember, activePackageDefinitionIds };
  }

  visiblePostsWhere(access: CommunityAccess): Prisma.CommunityPostWhereInput {
    return visiblePostsWhere(access);
  }

  videoLock(
    content: { visibility: VideoContentVisibility | string; packages?: { packageDefinitionId: string }[] },
    activePackageDefIds: ReadonlySet<string>,
  ): VideoLockResult {
    return videoLock(content, activePackageDefIds);
  }
}
