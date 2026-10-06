import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { PlatformPermissionKey } from '@platform/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { PLATFORM_ANY_ACCESS_KEY, PLATFORM_PERMISSIONS_KEY } from '../decorators/platform-scoped.decorator';
import { loadPlatformAccess, mfaGateError, platformAccessDenied, platformMfaGate, requireTwoFactorForPlatformRoles } from '../platform-access';
import type { AuthenticatedRequest } from '../tenant-context';
import { apiError } from '../../../common/api-error';

/**
 * Gate for platform-level endpoints (docs/PAZARLAMA_MODULU.md 2.5). Must run
 * after JwtAuthGuard (see PlatformScoped()). Super admins pass with every
 * platform permission; everyone else needs an ACTIVE PlatformMembership,
 * loaded from the database on every request so a revocation takes effect
 * immediately, whose role template holds every required key. A handler that
 * declares neither @RequirePlatformPermission nor @PlatformAnyAccess is
 * refused (same safe default as PermissionGuard).
 */
@Injectable()
export class PlatformPermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const required = this.reflector.getAllAndOverride<PlatformPermissionKey[] | undefined>(PLATFORM_PERMISSIONS_KEY, targets);
    const anyAccess = this.reflector.getAllAndOverride<boolean | undefined>(PLATFORM_ANY_ACCESS_KEY, targets);
    if ((!required || required.length === 0) && !anyAccess) {
      throw new ForbiddenException(apiError('apiErrors.auth.noPermissionDefinedAction'));
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;
    if (!user) throw new UnauthorizedException(apiError('apiErrors.auth.userSessionNotFound'));

    const access = await loadPlatformAccess(this.prisma, user);
    if (!access) throw platformAccessDenied();

    const gate = platformMfaGate(user, user.isSuperAdmin ? false : await requireTwoFactorForPlatformRoles(this.prisma));
    if (gate !== 'ok') throw mfaGateError(gate);

    const permissions = new Set(access.permissions);
    if (required && required.some((key) => !permissions.has(key))) {
      throw new ForbiddenException(apiError('apiErrors.auth.notPermissionAction'));
    }

    const platformStudio = await this.prisma.studio.findFirst({ where: { isPlatform: true }, select: { id: true } });
    if (!platformStudio) throw new ForbiddenException(apiError('apiErrors.common.platformTenantNotFound'));

    request.platform = {
      userId: user.id,
      isSuperAdmin: user.isSuperAdmin,
      permissions,
      platformStudioId: platformStudio.id,
    };
    return true;
  }
}
