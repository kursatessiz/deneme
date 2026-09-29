import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ALL_PERMISSIONS } from '@platform/shared';
import type { PermissionKey } from '@platform/shared';
import { BillingWriteGuard } from './billing-write.guard';
import { ALLOW_WHEN_RESTRICTED_KEY, PERMISSIONS_KEY } from '../decorators/require-permission.decorator';
import type { AuthenticatedRequest, TenantContext } from '../tenant-context';

function tenant(overrides: Partial<TenantContext> = {}): TenantContext {
  return {
    studioId: 's1',
    membershipId: 'm1',
    isOwner: true,
    isSuperAdmin: false,
    permissions: new Set<PermissionKey>(ALL_PERMISSIONS),
    memberProfileId: null,
    trainerProfileId: null,
    branchIds: null,
    billingStatus: 'RESTRICTED',
    ...overrides,
  };
}

function ctx(method: string, t: TenantContext, meta: { permissions?: PermissionKey[]; allow?: boolean } = {}): ExecutionContext {
  const handler = () => undefined;
  if (meta.permissions) Reflect.defineMetadata(PERMISSIONS_KEY, meta.permissions, handler);
  if (meta.allow) Reflect.defineMetadata(ALLOW_WHEN_RESTRICTED_KEY, true, handler);
  const req: AuthenticatedRequest = { method, tenant: t, params: {}, query: {}, headers: {} };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => handler,
    getClass: () => class {},
  } as unknown as ExecutionContext;
}

describe('BillingWriteGuard (restricted mode)', () => {
  const guard = new BillingWriteGuard(new Reflector());

  it('lets every request through when the studio is not restricted', () => {
    for (const status of ['TRIALING', 'ACTIVE', 'PAST_DUE', undefined]) {
      expect(guard.canActivate(ctx('POST', tenant({ billingStatus: status }), { permissions: ['bookings.manage'] }))).toBe(true);
    }
  });

  it('always allows reads', () => {
    expect(guard.canActivate(ctx('GET', tenant(), { permissions: ['bookings.view'] }))).toBe(true);
  });

  it('blocks a core write with the BILLING_RESTRICTED code', () => {
    try {
      guard.canActivate(ctx('POST', tenant(), { permissions: ['bookings.manage'] }));
      throw new Error('expected a ForbiddenException');
    } catch (err) {
      expect(err).toBeInstanceOf(ForbiddenException);
      expect((err as ForbiddenException).getResponse()).toMatchObject({ code: 'BILLING_RESTRICTED' });
    }
    expect(() => guard.canActivate(ctx('POST', tenant({ billingStatus: 'CANCELLED' }), { permissions: ['retail.sell'] }))).toThrow(ForbiddenException);
    // Member self-service (no permission) is blocked unless explicitly allowed.
    expect(() => guard.canActivate(ctx('POST', tenant({ isOwner: false }), {}))).toThrow(ForbiddenException);
  });

  it('allows the explicit allow-list: billing, exports and @AllowWhenRestricted handlers', () => {
    expect(guard.canActivate(ctx('POST', tenant(), { permissions: ['billing.manage'] }))).toBe(true);
    expect(guard.canActivate(ctx('PUT', tenant(), { permissions: ['staff.manage'] }))).toBe(true);
    expect(guard.canActivate(ctx('POST', tenant(), { allow: true }))).toBe(true);
  });

  it('never restricts a super admin', () => {
    expect(guard.canActivate(ctx('POST', tenant({ isSuperAdmin: true }), { permissions: ['bookings.manage'] }))).toBe(true);
  });
});
