import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { SuperAdminGuard } from './super-admin.guard';
import type { AuthenticatedRequest, AuthUser } from '../tenant-context';

function ctx(request: Partial<AuthenticatedRequest>): ExecutionContext {
  const req = Object.assign(request, {
    params: request.params ?? {},
    query: request.query ?? {},
    headers: request.headers ?? {},
  });
  return { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
}

const superAdmin: AuthUser = { id: 'admin1', phone: '+905321000001', firstName: 'A', lastName: 'B', isSuperAdmin: true };
const owner: AuthUser = { id: 'owner1', phone: '+905321000002', firstName: 'O', lastName: 'W', isSuperAdmin: false };

describe('SuperAdminGuard', () => {
  const guard = new SuperAdminGuard();

  it('allows a super admin through', () => {
    expect(guard.canActivate(ctx({ user: superAdmin }))).toBe(true);
  });

  it('rejects a non-super-admin user with 403', () => {
    expect(() => guard.canActivate(ctx({ user: owner }))).toThrow(ForbiddenException);
  });

  it('rejects an unauthenticated request with 403', () => {
    expect(() => guard.canActivate(ctx({ user: undefined }))).toThrow(ForbiddenException);
  });
});
