import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { AuthenticatedRequest } from '../tenant-context';
import { mfaGateError, platformMfaGate } from '../platform-access';
import { apiError } from '../../../common/api-error';

/**
 * Single gate for every platform-owner (super-admin) endpoint. Must run
 * after JwtAuthGuard (see SuperAdminOnly()), which attaches `request.user`.
 * There is no separate role or permission check here on purpose: platform
 * administration is not part of the per-tenant permission catalog in
 * packages/shared, it is a single global flag on User (CLAUDE.md rule 6).
 * M1 (docs/PAZARLAMA_MODULU.md 6.3): once a super admin has enrolled a TOTP
 * authenticator, only a session that passed the TOTP step is accepted; a
 * super admin without 2FA is not locked out (the web shell asks for
 * enrolment at next login).
 */
@Injectable()
export class SuperAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.user?.isSuperAdmin) {
      throw new ForbiddenException(apiError('apiErrors.auth.notPermissionAction'));
    }
    const gate = platformMfaGate(request.user, false);
    if (gate !== 'ok') throw mfaGateError(gate);
    return true;
  }
}
