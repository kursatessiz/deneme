import { ForbiddenException } from '@nestjs/common';
import type { PermissionKey } from '@platform/shared';
import type { TenantContext } from '../auth/tenant-context';
import type { PrismaService } from '../prisma/prisma.service';
import { RoleTemplatesService } from './role-templates.service';

function tenant(over: Partial<TenantContext> = {}): TenantContext {
  return {
    studioId: 'studio-1',
    membershipId: 'membership-actor',
    isOwner: false,
    isSuperAdmin: false,
    permissions: new Set<PermissionKey>(['roles.manage']),
    memberProfileId: null,
    trainerProfileId: null,
    branchIds: null,
    ...over,
  };
}

describe('RoleTemplatesService.assignRole', () => {
  const findMembership = jest.fn();
  const prisma = {
    membership: { findFirst: findMembership },
    roleTemplate: { findFirst: jest.fn() },
    roleTemplatePermission: { findMany: jest.fn(async () => []) },
  };
  const service = new RoleTemplatesService(prisma as unknown as PrismaService);

  it('a branch-restricted actor may not assign roles', async () => {
    const restricted = tenant({ branchIds: new Set(['branch-a']) });
    await expect(service.assignRole(restricted, 'user-1', 'membership-target', { roleTemplateId: 'role-1' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(findMembership).not.toHaveBeenCalled();
  });

  it('an unrestricted actor reaches the membership lookup', async () => {
    findMembership.mockResolvedValueOnce(null);
    await expect(service.assignRole(tenant(), 'user-1', 'membership-target', { roleTemplateId: 'role-1' })).rejects.toMatchObject({ status: 404 });
    expect(findMembership).toHaveBeenCalled();
  });
});
