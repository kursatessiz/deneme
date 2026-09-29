import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { BILLING_RESTRICTED_ERROR_CODE, isAllowedWhenRestricted, isWriteRestricted } from '@platform/shared';
import type { PermissionKey } from '@platform/shared';
import { ALLOW_WHEN_RESTRICTED_KEY, PERMISSIONS_KEY } from '../decorators/require-permission.decorator';
import type { AuthenticatedRequest } from '../tenant-context';
import type { PrismaClient } from '@platform/database';

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** The 403 a write gets in restricted mode; clients translate `billing.error.BILLING_RESTRICTED`. */
export function billingRestrictedError(): ForbiddenException {
  return new ForbiddenException({
    statusCode: 403,
    code: BILLING_RESTRICTED_ERROR_CODE,
    message: 'İşletme hesabı kısıtlı modda. Yeni kayıt oluşturmak için hesabı etkinleştirin.',
  });
}

/**
 * Restricted mode (G5c-1, docs/DENEME_VE_ETKINLESTIRME.md "Kısıtlı mod").
 * Runs last in @StudioScoped(), after the tenant is resolved. When the
 * studio's billing status is RESTRICTED or CANCELLED:
 * - reads (GET/HEAD/OPTIONS) always pass: staff can view and export;
 * - a write passes only when every permission the handler requires is in
 *   RESTRICTED_MODE_ALLOWED_WRITE_PERMISSIONS (billing, settings, roles,
 *   staff, exports) or the handler is marked @AllowWhenRestricted() (the
 *   member's own data, and since G5c-1b attendance, no-show and check-in
 *   marking plus booking, waitlist, session and event cancellation);
 * - every other write (new bookings, sessions, sales, campaigns, members,
 *   member self-service booking and checkout) gets 403 BILLING_RESTRICTED.
 * Super admins are never restricted. Deny by default: a new write
 * endpoint is blocked in restricted mode unless it is added to the list.
 */
@Injectable()
export class BillingWriteGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const tenant = request.tenant;
    if (!tenant || tenant.isSuperAdmin) return true;
    if (!isWriteRestricted(tenant.billingStatus)) return true;
    if (READ_METHODS.has((request.method ?? 'GET').toUpperCase())) return true;

    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean | undefined>(ALLOW_WHEN_RESTRICTED_KEY, targets)) return true;
    const required = this.reflector.getAllAndOverride<PermissionKey[] | undefined>(PERMISSIONS_KEY, targets) ?? [];
    if (isAllowedWhenRestricted(required)) return true;
    throw billingRestrictedError();
  }
}

/**
 * Restricted-mode check for writes that do not go through @StudioScoped()
 * (API-key public API bookings, public guest event registration).
 */
export async function assertStudioWritable(
  prisma: Pick<PrismaClient, 'studio'>,
  studioId: string,
): Promise<void> {
  const studio = await prisma.studio.findUnique({ where: { id: studioId }, select: { billingStatus: true } });
  if (studio && isWriteRestricted(studio.billingStatus)) throw billingRestrictedError();
}
