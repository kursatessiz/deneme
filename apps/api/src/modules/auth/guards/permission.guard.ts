import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { PermissionKey } from '@platform/shared';
import { PERMISSIONS_KEY, SELF_SERVICE_KEY } from '../decorators/require-permission.decorator';
import type { AuthenticatedRequest } from '../tenant-context';

/**
 * Deny by default: a studio-scoped handler must declare either
 * @RequirePermission(...) or @SelfService(). All listed permissions are
 * required. Must run after StudioTenantGuard.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    const required = this.reflector.getAllAndOverride<PermissionKey[] | undefined>(PERMISSIONS_KEY, targets);
    const selfService = this.reflector.getAllAndOverride<boolean | undefined>(SELF_SERVICE_KEY, targets);

    const tenant = context.switchToHttp().getRequest<AuthenticatedRequest>().tenant;
    if (!tenant) throw new ForbiddenException('İşletme bağlamı çözümlenemedi');

    if (required && required.length > 0) {
      const missing = required.filter((key) => !tenant.permissions.has(key));
      if (missing.length > 0) throw new ForbiddenException('Bu işlem için yetkiniz yok');
      return true;
    }
    if (selfService) {
      // Any active membership; the handler must still restrict data to the caller.
      return true;
    }
    throw new ForbiddenException('Bu işlem için yetki tanımlanmamış');
  }
}
