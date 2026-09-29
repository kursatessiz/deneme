import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PlatformPermissionGuard } from './platform-permission.guard';
import { StudioTenantGuard } from './studio-tenant.guard';
import { SuperAdminGuard } from './super-admin.guard';
import { PLATFORM_ANY_ACCESS_KEY, PLATFORM_PERMISSIONS_KEY } from '../decorators/platform-scoped.decorator';
import { platformMfaGate } from '../platform-access';
import type { AuthenticatedRequest, AuthUser } from '../tenant-context';

const PLATFORM_STUDIO = '33333333-3333-4333-8333-333333333333';

const member: AuthUser = { id: 'u1', phone: '+905321112233', firstName: 'A', lastName: 'B', isSuperAdmin: false, mfaEnabled: true, mfaVerified: true };
const superAdmin: AuthUser = { id: 'sa', phone: '+905321000001', firstName: 'S', lastName: 'A', isSuperAdmin: true };

function ctx(request: Partial<AuthenticatedRequest>, handler = () => undefined): ExecutionContext {
  const req = Object.assign(request, { params: request.params ?? {}, query: request.query ?? {}, headers: request.headers ?? {} });
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => handler,
    getClass: () => class {},
  } as unknown as ExecutionContext;
}

function reflectorWith(meta: Record<string, unknown>): Reflector {
  return { getAllAndOverride: (key: string) => meta[key] } as unknown as Reflector;
}

function activeMembership(permissions: string[], status = 'ACTIVE') {
  return { status, roleTemplate: { name: 'Pazarlama yöneticisi', permissions: permissions.map((permissionKey) => ({ permissionKey })) } };
}

describe('platformMfaGate', () => {
  it('enrolled accounts need a verified session, super admins without 2FA get the grace, members follow the policy', () => {
    expect(platformMfaGate({ isSuperAdmin: false, mfaEnabled: true, mfaVerified: false }, true)).toBe('MFA_REQUIRED');
    expect(platformMfaGate({ isSuperAdmin: true, mfaEnabled: true, mfaVerified: false }, false)).toBe('MFA_REQUIRED');
    expect(platformMfaGate({ isSuperAdmin: true }, true)).toBe('ok');
    expect(platformMfaGate({ isSuperAdmin: false }, true)).toBe('MFA_ENROLLMENT_REQUIRED');
    expect(platformMfaGate({ isSuperAdmin: false }, false)).toBe('ok');
    expect(platformMfaGate({ isSuperAdmin: false, mfaEnabled: true, mfaVerified: true }, true)).toBe('ok');
  });
});

describe('PlatformPermissionGuard', () => {
  const prisma = {
    platformMembership: { findUnique: jest.fn() },
    platformAccessSettings: { findUnique: jest.fn() },
    studio: { findFirst: jest.fn() },
  };

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.studio.findFirst.mockResolvedValue({ id: PLATFORM_STUDIO });
    prisma.platformAccessSettings.findUnique.mockResolvedValue({ require2faForPlatformRoles: true });
  });

  const guard = (meta: Record<string, unknown>) => new PlatformPermissionGuard(reflectorWith(meta), prisma as never);

  it('refuses a handler that declares no platform permission', async () => {
    await expect(guard({}).canActivate(ctx({ user: superAdmin }))).rejects.toThrow('Bu işlem için yetki tanımlanmamış');
  });

  it('lets a super admin through with every platform permission, without a membership row', async () => {
    const req: Partial<AuthenticatedRequest> = { user: superAdmin };
    await expect(guard({ [PLATFORM_PERMISSIONS_KEY]: ['platform.integrations.manage'] }).canActivate(ctx(req))).resolves.toBe(true);
    expect(prisma.platformMembership.findUnique).not.toHaveBeenCalled();
    expect(req.platform?.permissions.has('platform.users.manage')).toBe(true);
    expect(req.platform?.platformStudioId).toBe(PLATFORM_STUDIO);
  });

  it('an ACTIVE member with the key passes; the platform studio comes from the server', async () => {
    prisma.platformMembership.findUnique.mockResolvedValue(activeMembership(['platform.integrations.manage']));
    const req: Partial<AuthenticatedRequest> = { user: member, headers: { 'x-studio-id': 'forged' } };
    await expect(guard({ [PLATFORM_PERMISSIONS_KEY]: ['platform.integrations.manage'] }).canActivate(ctx(req))).resolves.toBe(true);
    expect(req.platform?.platformStudioId).toBe(PLATFORM_STUDIO);
  });

  it('403 for a PASSIVE membership, a missing key, or a super-admin-only key stored on a template', async () => {
    prisma.platformMembership.findUnique.mockResolvedValue(activeMembership(['platform.integrations.manage'], 'PASSIVE'));
    await expect(guard({ [PLATFORM_ANY_ACCESS_KEY]: true }).canActivate(ctx({ user: member }))).rejects.toMatchObject({
      response: { code: 'PLATFORM_ACCESS_DENIED' },
    });

    prisma.platformMembership.findUnique.mockResolvedValue(activeMembership(['platform.ads.view']));
    await expect(guard({ [PLATFORM_PERMISSIONS_KEY]: ['platform.integrations.manage'] }).canActivate(ctx({ user: member }))).rejects.toThrow(
      ForbiddenException,
    );

    prisma.platformMembership.findUnique.mockResolvedValue(activeMembership(['platform.users.manage']));
    await expect(guard({ [PLATFORM_PERMISSIONS_KEY]: ['platform.users.manage'] }).canActivate(ctx({ user: member }))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('a member without 2FA is refused while the policy requires it, and allowed when it is off', async () => {
    prisma.platformMembership.findUnique.mockResolvedValue(activeMembership(['platform.marketing.view']));
    const noMfa: AuthUser = { ...member, mfaEnabled: false, mfaVerified: false };
    await expect(guard({ [PLATFORM_ANY_ACCESS_KEY]: true }).canActivate(ctx({ user: noMfa }))).rejects.toMatchObject({
      response: { code: 'MFA_ENROLLMENT_REQUIRED' },
    });
    prisma.platformAccessSettings.findUnique.mockResolvedValue({ require2faForPlatformRoles: false });
    await expect(guard({ [PLATFORM_ANY_ACCESS_KEY]: true }).canActivate(ctx({ user: noMfa }))).resolves.toBe(true);
  });

  it('an enrolled super admin whose session skipped the TOTP step gets MFA_REQUIRED', async () => {
    await expect(
      guard({ [PLATFORM_ANY_ACCESS_KEY]: true }).canActivate(ctx({ user: { ...superAdmin, mfaEnabled: true, mfaVerified: false } })),
    ).rejects.toMatchObject({ response: { code: 'MFA_REQUIRED' } });
  });
});

describe('SuperAdminGuard and 2FA', () => {
  const guard = new SuperAdminGuard();
  it('keeps unenrolled super admins working (grace) and requires the TOTP step once enrolled', () => {
    expect(guard.canActivate(ctx({ user: superAdmin }))).toBe(true);
    expect(guard.canActivate(ctx({ user: { ...superAdmin, mfaEnabled: true, mfaVerified: true } }))).toBe(true);
    expect(() => guard.canActivate(ctx({ user: { ...superAdmin, mfaEnabled: true, mfaVerified: false } }))).toThrow(ForbiddenException);
  });

  it('a platform member is never a super admin', () => {
    expect(() => guard.canActivate(ctx({ user: member }))).toThrow(ForbiddenException);
  });
});

describe('StudioTenantGuard on the platform system role', () => {
  const prisma = {
    membership: { findUnique: jest.fn() },
    studio: { findUnique: jest.fn() },
    platformAccessSettings: { findUnique: jest.fn() },
  };
  const guard = new StudioTenantGuard(prisma as never);

  function systemMembership(pm: { status: string; platformStudioMembershipId: string } | null, isPlatform = true) {
    return {
      id: 'm-platform',
      status: 'ACTIVE',
      studio: { isActive: true, billingStatus: 'ACTIVE', isPlatform },
      roleTemplate: { key: 'platform:marketing_admin', isSystem: true, isOwner: false, permissions: [{ permissionKey: 'crm.view' }] },
      memberProfile: null,
      trainerProfile: null,
      branchAccess: [],
      user: { platformMembership: pm },
    };
  }

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.platformAccessSettings.findUnique.mockResolvedValue({ require2faForPlatformRoles: true });
  });

  it('allows the mirrored membership while the PlatformMembership is ACTIVE and points at it', async () => {
    prisma.membership.findUnique.mockResolvedValue(systemMembership({ status: 'ACTIVE', platformStudioMembershipId: 'm-platform' }));
    const req: Partial<AuthenticatedRequest> = { user: member, params: { studioId: PLATFORM_STUDIO } };
    await expect(guard.canActivate(ctx(req))).resolves.toBe(true);
    expect([...(req.tenant?.permissions ?? [])]).toEqual(['crm.view']);
  });

  it('403 right after revocation even if the mirrored membership is still ACTIVE', async () => {
    prisma.membership.findUnique.mockResolvedValue(systemMembership({ status: 'PASSIVE', platformStudioMembershipId: 'm-platform' }));
    await expect(guard.canActivate(ctx({ user: member, params: { studioId: PLATFORM_STUDIO } }))).rejects.toMatchObject({
      response: { code: 'PLATFORM_ACCESS_DENIED' },
    });
    prisma.membership.findUnique.mockResolvedValue(systemMembership(null));
    await expect(guard.canActivate(ctx({ user: member, params: { studioId: PLATFORM_STUDIO } }))).rejects.toThrow(ForbiddenException);
  });

  it('403 without the TOTP step when the policy requires 2FA', async () => {
    prisma.membership.findUnique.mockResolvedValue(systemMembership({ status: 'ACTIVE', platformStudioMembershipId: 'm-platform' }));
    await expect(
      guard.canActivate(ctx({ user: { ...member, mfaVerified: false }, params: { studioId: PLATFORM_STUDIO } })),
    ).rejects.toMatchObject({ response: { code: 'MFA_REQUIRED' } });
  });

  it('an enrolled super admin without the TOTP step gets no bypass', async () => {
    prisma.membership.findUnique.mockResolvedValue(null);
    await expect(
      guard.canActivate(ctx({ user: { ...superAdmin, mfaEnabled: true, mfaVerified: false }, params: { studioId: PLATFORM_STUDIO } })),
    ).rejects.toThrow(ForbiddenException);
    expect(prisma.studio.findUnique).not.toHaveBeenCalled();
  });
});
