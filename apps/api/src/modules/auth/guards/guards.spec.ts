import { BadRequestException, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ALL_PERMISSIONS } from '@platform/shared';
import { StudioTenantGuard } from './studio-tenant.guard';
import { PermissionGuard } from './permission.guard';
import { PERMISSIONS_KEY, SELF_SERVICE_KEY } from '../decorators/require-permission.decorator';
import type { AuthenticatedRequest, AuthUser } from '../tenant-context';

const STUDIO_A = '11111111-1111-4111-8111-111111111111';
const STUDIO_B = '22222222-2222-4222-8222-222222222222';

const user: AuthUser = { id: 'u1', phone: '+905321112233', firstName: 'A', lastName: 'B', isSuperAdmin: false };

function ctx(request: Partial<AuthenticatedRequest>, handler = () => undefined): ExecutionContext {
  // Mutate the caller's object so assertions can read what the guard attached.
  const req = Object.assign(request, {
    params: request.params ?? {},
    query: request.query ?? {},
    headers: request.headers ?? {},
  });
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => handler,
    getClass: () => class {},
  } as unknown as ExecutionContext;
}

function membership(overrides: Record<string, unknown> = {}) {
  return {
    id: 'm1',
    status: 'ACTIVE',
    studio: { isActive: true },
    roleTemplate: { isOwner: false, permissions: [{ permissionKey: 'members.view' }, { permissionKey: 'unknown.key' }] },
    memberProfile: null,
    trainerProfile: { id: 't1' },
    branchAccess: [],
    ...overrides,
  };
}

describe('StudioTenantGuard', () => {
  const prisma = {
    membership: { findUnique: jest.fn() },
    studio: { findUnique: jest.fn() },
  };
  const guard = new StudioTenantGuard(prisma as never);

  beforeEach(() => jest.resetAllMocks());

  it('resolves tenant and effective permissions from the membership', async () => {
    prisma.membership.findUnique.mockResolvedValue(membership());
    const request: Partial<AuthenticatedRequest> = { user, params: { studioId: STUDIO_A } };
    await expect(guard.canActivate(ctx(request))).resolves.toBe(true);

    expect(prisma.membership.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId_studioId: { userId: 'u1', studioId: STUDIO_A } } }),
    );
    expect(request.tenant?.studioId).toBe(STUDIO_A);
    expect([...(request.tenant?.permissions ?? [])]).toEqual(['members.view']);
    expect(request.tenant?.trainerProfileId).toBe('t1');
  });

  it('staff without branch grants may act on every branch', async () => {
    prisma.membership.findUnique.mockResolvedValue(membership());
    const req: Partial<AuthenticatedRequest> = { user, params: { studioId: STUDIO_A } };
    await guard.canActivate(ctx(req));
    expect(req.tenant?.branchIds).toBeNull();
  });

  it('branch grants restrict staff to those branches', async () => {
    prisma.membership.findUnique.mockResolvedValue(membership({ branchAccess: [{ branchId: 'b1' }, { branchId: 'b2' }] }));
    const req: Partial<AuthenticatedRequest> = { user, params: { studioId: STUDIO_A } };
    await guard.canActivate(ctx(req));
    expect([...(req.tenant?.branchIds ?? [])]).toEqual(['b1', 'b2']);
  });

  it('the owner is never branch-restricted', async () => {
    prisma.membership.findUnique.mockResolvedValue(
      membership({ roleTemplate: { isOwner: true, permissions: [] }, branchAccess: [{ branchId: 'b1' }] }),
    );
    const req: Partial<AuthenticatedRequest> = { user, params: { studioId: STUDIO_A } };
    await guard.canActivate(ctx(req));
    expect(req.tenant?.branchIds).toBeNull();
  });

  it('accepts the studio from the x-studio-id header', async () => {
    prisma.membership.findUnique.mockResolvedValue(membership());
    const request: Partial<AuthenticatedRequest> = { user, headers: { 'x-studio-id': STUDIO_A } };
    await expect(guard.canActivate(ctx(request))).resolves.toBe(true);
    expect(request.tenant?.studioId).toBe(STUDIO_A);
  });

  it('rejects users without a membership in the studio', async () => {
    prisma.membership.findUnique.mockResolvedValue(null);
    await expect(guard.canActivate(ctx({ user, params: { studioId: STUDIO_B } }))).rejects.toThrow(ForbiddenException);
  });

  it.each(['INVITED', 'PASSIVE'])('rejects %s memberships', async (status) => {
    prisma.membership.findUnique.mockResolvedValue(membership({ status }));
    await expect(guard.canActivate(ctx({ user, params: { studioId: STUDIO_A } }))).rejects.toThrow(ForbiddenException);
  });

  it('rejects memberships of a deactivated studio', async () => {
    prisma.membership.findUnique.mockResolvedValue(membership({ studio: { isActive: false } }));
    await expect(guard.canActivate(ctx({ user, params: { studioId: STUDIO_A } }))).rejects.toThrow(ForbiddenException);
  });

  it('rejects a body studioId that differs from the route studio', async () => {
    const request = { user, params: { studioId: STUDIO_A }, body: { studioId: STUDIO_B } };
    await expect(guard.canActivate(ctx(request))).rejects.toThrow(ForbiddenException);
    expect(prisma.membership.findUnique).not.toHaveBeenCalled();
  });

  it('rejects a query studioId that differs from the header studio', async () => {
    const request = { user, headers: { 'x-studio-id': STUDIO_A }, query: { studioId: STUDIO_B } };
    await expect(guard.canActivate(ctx(request))).rejects.toThrow(ForbiddenException);
  });

  it('accepts the studio from the request body when nothing else names one', async () => {
    prisma.membership.findUnique.mockResolvedValue(membership());
    const request: Partial<AuthenticatedRequest> = { user, body: { studioId: STUDIO_A } };
    await expect(guard.canActivate(ctx(request))).resolves.toBe(true);
    expect(request.tenant?.studioId).toBe(STUDIO_A);
  });

  it('rejects a non-string studioId in the body', async () => {
    await expect(guard.canActivate(ctx({ user, body: { studioId: { $ne: null } } }))).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects conflicting route and header studios', async () => {
    const request = { user, params: { studioId: STUDIO_A }, headers: { 'x-studio-id': STUDIO_B } };
    await expect(guard.canActivate(ctx(request))).rejects.toThrow(ForbiddenException);
  });

  it('requires a valid studio id', async () => {
    await expect(guard.canActivate(ctx({ user }))).rejects.toThrow(BadRequestException);
    await expect(guard.canActivate(ctx({ user, params: { studioId: 'not-a-uuid' } }))).rejects.toThrow(
      BadRequestException,
    );
  });

  it('owner role resolves to every permission', async () => {
    prisma.membership.findUnique.mockResolvedValue(membership({ roleTemplate: { isOwner: true, permissions: [] } }));
    const request: Partial<AuthenticatedRequest> = { user, params: { studioId: STUDIO_A } };
    await guard.canActivate(ctx(request));
    expect(request.tenant?.permissions.size).toBe(ALL_PERMISSIONS.length);
  });

  it('super-admin may act on any existing studio without a membership', async () => {
    prisma.studio.findUnique.mockResolvedValue({ id: STUDIO_B });
    const request: Partial<AuthenticatedRequest> = { user: { ...user, isSuperAdmin: true }, params: { studioId: STUDIO_B } };
    await expect(guard.canActivate(ctx(request))).resolves.toBe(true);
    expect(request.tenant?.isSuperAdmin).toBe(true);
    expect(prisma.membership.findUnique).not.toHaveBeenCalled();
  });

  it('super-admin gets 403 for an unknown studio', async () => {
    prisma.studio.findUnique.mockResolvedValue(null);
    const request = { user: { ...user, isSuperAdmin: true }, params: { studioId: STUDIO_B } };
    await expect(guard.canActivate(ctx(request))).rejects.toThrow(ForbiddenException);
  });
});

describe('PermissionGuard', () => {
  const reflector = new Reflector();
  const guard = new PermissionGuard(reflector);
  const tenant = {
    studioId: STUDIO_A,
    membershipId: 'm1',
    isOwner: false,
    isSuperAdmin: false,
    permissions: new Set(['members.view', 'schedule.view'] as const),
    memberProfileId: null,
    trainerProfileId: null,
    branchIds: null,
  };

  function handlerWith(meta: Record<string, unknown>) {
    const handler = () => undefined;
    for (const [key, value] of Object.entries(meta)) Reflect.defineMetadata(key, value, handler);
    return handler;
  }

  it('allows when every required permission is held', () => {
    const handler = handlerWith({ [PERMISSIONS_KEY]: ['members.view', 'schedule.view'] });
    expect(guard.canActivate(ctx({ tenant }, handler))).toBe(true);
  });

  it('denies when any required permission is missing', () => {
    const handler = handlerWith({ [PERMISSIONS_KEY]: ['members.view', 'members.contact.view'] });
    expect(() => guard.canActivate(ctx({ tenant }, handler))).toThrow(ForbiddenException);
  });

  it('denies handlers that declare nothing (secure default)', () => {
    expect(() => guard.canActivate(ctx({ tenant }, handlerWith({})))).toThrow(ForbiddenException);
  });

  it('allows self-service handlers for any active member', () => {
    const handler = handlerWith({ [SELF_SERVICE_KEY]: true });
    expect(guard.canActivate(ctx({ tenant: { ...tenant, permissions: new Set() } }, handler))).toBe(true);
  });

  it('denies when the tenant was not resolved', () => {
    const handler = handlerWith({ [PERMISSIONS_KEY]: ['members.view'] });
    expect(() => guard.canActivate(ctx({}, handler))).toThrow(ForbiddenException);
  });
});
