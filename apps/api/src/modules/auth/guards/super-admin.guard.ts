import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { AuthenticatedRequest } from '../tenant-context';

/**
 * Single gate for every platform-owner (super-admin) endpoint. Must run
 * after JwtAuthGuard (see SuperAdminOnly()), which attaches `request.user`.
 * There is no separate role or permission check here on purpose: platform
 * administration is not part of the per-tenant permission catalog in
 * packages/shared, it is a single global flag on User (CLAUDE.md rule 6).
 */
@Injectable()
export class SuperAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.user?.isSuperAdmin) {
      throw new ForbiddenException('Bu işlem için yetkiniz yok');
    }
    return true;
  }
}
