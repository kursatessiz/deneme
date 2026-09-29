import { VideoContentVisibility } from '@platform/database';
import type { PermissionKey } from '@platform/shared';
import type { TenantContext } from '../auth/tenant-context';
import { CommunityAccessService, satisfiedRuleFilters, seesEveryPost, videoLock, visiblePostsWhere } from './community-access.service';
import type { CommunityAccess } from './community-access.service';

const STUDIO = '11111111-1111-4111-8111-111111111111';

function tenant(overrides: Partial<TenantContext> = {}, permissions: PermissionKey[] = []): TenantContext {
  return {
    studioId: STUDIO,
    membershipId: 'membership-1',
    isOwner: false,
    isSuperAdmin: false,
    permissions: new Set(permissions),
    memberProfileId: 'member-1',
    trainerProfileId: null,
    branchIds: null,
    ...overrides,
  };
}

function access(overrides: Partial<CommunityAccess> = {}): CommunityAccess {
  return {
    studioId: STUDIO,
    membershipId: 'membership-1',
    seesEverything: false,
    isMember: true,
    activePackageDefinitionIds: new Set(),
    ...overrides,
  };
}

describe('CommunityAccessService', () => {
  let prisma: { memberPackage: { findMany: jest.Mock } };
  let service: CommunityAccessService;

  beforeEach(() => {
    prisma = { memberPackage: { findMany: jest.fn().mockResolvedValue([]) } };
    service = new CommunityAccessService(prisma as never);
  });

  describe('seesEveryPost', () => {
    it('is true for community.view, community.manage and super admins only', () => {
      expect(seesEveryPost(tenant({}, ['community.view']))).toBe(true);
      expect(seesEveryPost(tenant({}, ['community.manage']))).toBe(true);
      expect(seesEveryPost(tenant({ isSuperAdmin: true }))).toBe(true);
      expect(seesEveryPost(tenant({}, ['community.moderate', 'content.view']))).toBe(false);
      expect(seesEveryPost(tenant())).toBe(false);
    });
  });

  describe('resolve', () => {
    it('loads only ACTIVE, unexpired packages of the member in this studio', async () => {
      prisma.memberPackage.findMany.mockResolvedValue([{ packageDefinitionId: 'pd-1' }, { packageDefinitionId: 'pd-1' }, { packageDefinitionId: 'pd-2' }]);
      const result = await service.resolve(tenant());
      const where = prisma.memberPackage.findMany.mock.calls[0][0].where;
      expect(where.studioId).toBe(STUDIO);
      expect(where.memberId).toBe('member-1');
      expect(where.status).toBe('ACTIVE');
      expect(where.endDate.gte).toBeInstanceOf(Date);
      expect([...result.activePackageDefinitionIds].sort()).toEqual(['pd-1', 'pd-2']);
      expect(result.isMember).toBe(true);
      expect(result.seesEverything).toBe(false);
    });

    it('rejects a caller who is neither a member nor staff with community.view', async () => {
      await expect(service.resolve(tenant({ memberProfileId: null }, ['members.view']))).rejects.toMatchObject({
        response: { code: 'COMMUNITY_MEMBERS_ONLY' },
      });
      expect(prisma.memberPackage.findMany).not.toHaveBeenCalled();
    });

    it('lets staff with community.view in without a member profile and without a package query', async () => {
      const result = await service.resolve(tenant({ memberProfileId: null }, ['community.view']));
      expect(result.seesEverything).toBe(true);
      expect(result.isMember).toBe(false);
      expect(prisma.memberPackage.findMany).not.toHaveBeenCalled();
    });
  });

  describe('satisfiedRuleFilters', () => {
    it('grants nothing to a non-member', () => {
      expect(satisfiedRuleFilters({ isMember: false, activePackageDefinitionIds: new Set(['pd-1']) })).toEqual([]);
    });

    it('grants only ACTIVE_MEMBER to a member without an active package', () => {
      expect(satisfiedRuleFilters({ isMember: true, activePackageDefinitionIds: new Set() })).toEqual([{ kind: 'ACTIVE_MEMBER' }]);
    });

    it('adds ACTIVE_PACKAGE and the exact package definitions the member holds', () => {
      expect(satisfiedRuleFilters({ isMember: true, activePackageDefinitionIds: new Set(['pd-1', 'pd-2']) })).toEqual([
        { kind: 'ACTIVE_MEMBER' },
        { kind: 'ACTIVE_PACKAGE' },
        { kind: 'PACKAGE_DEFINITION', packageDefinitionId: { in: ['pd-1', 'pd-2'] } },
      ]);
    });
  });

  describe('visiblePostsWhere', () => {
    it('always scopes to the studio and PUBLISHED posts', () => {
      for (const a of [access(), access({ seesEverything: true }), access({ isMember: false })]) {
        const where = visiblePostsWhere(a);
        expect(where.studioId).toBe(STUDIO);
        expect(where.status).toBe('PUBLISHED');
      }
    });

    it('skips the tier filter only for staff who see everything', () => {
      expect(visiblePostsWhere(access({ seesEverything: true }))).toEqual({ studioId: STUDIO, status: 'PUBLISHED' });
    });

    it('members see untiered posts or posts with one satisfied tier of the same studio', () => {
      const where = visiblePostsWhere(access({ activePackageDefinitionIds: new Set(['pd-1']) }));
      expect(where.OR).toEqual([
        { tiers: { none: {} } },
        {
          tiers: {
            some: {
              tier: {
                studioId: STUDIO,
                rules: { some: { OR: satisfiedRuleFilters({ isMember: true, activePackageDefinitionIds: new Set(['pd-1']) }) } },
              },
            },
          },
        },
      ]);
    });

    it('a caller with no satisfied rule only sees posts without tiers', () => {
      expect(visiblePostsWhere(access({ isMember: false })).OR).toEqual([{ tiers: { none: {} } }]);
    });
  });

  describe('videoLock (W19 rules)', () => {
    it('ALL_MEMBERS is never locked', () => {
      expect(videoLock({ visibility: VideoContentVisibility.ALL_MEMBERS }, new Set()).locked).toBe(false);
    });

    it('MEMBERS_WITH_ACTIVE_PACKAGE needs any active package', () => {
      expect(videoLock({ visibility: VideoContentVisibility.MEMBERS_WITH_ACTIVE_PACKAGE }, new Set()).locked).toBe(true);
      expect(videoLock({ visibility: VideoContentVisibility.MEMBERS_WITH_ACTIVE_PACKAGE }, new Set(['pd-9'])).locked).toBe(false);
    });

    it('SPECIFIC_PACKAGES needs one of the listed package definitions', () => {
      const content = { visibility: VideoContentVisibility.SPECIFIC_PACKAGES, packages: [{ packageDefinitionId: 'pd-1' }] };
      expect(videoLock(content, new Set(['pd-2'])).locked).toBe(true);
      expect(videoLock(content, new Set(['pd-1'])).locked).toBe(false);
    });
  });
});
