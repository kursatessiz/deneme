import { ForbiddenException } from '@nestjs/common';
import {
  ALL_PLATFORM_PERMISSIONS,
  PLATFORM_ACCESS_ERROR_CODES,
  resolvePlatformPermissions,
  type PlatformPermissionKey,
} from '@platform/shared';
import type { PrismaClient } from '@platform/database';

/**
 * Platform-level access resolution shared by PlatformPermissionGuard,
 * StudioTenantGuard, SuperAdminGuard, AuthService (/auth/me) and
 * PlatformAccessService, so there is one definition of "who is a platform
 * account" and "has this session passed 2FA" (docs/PAZARLAMA_MODULU.md 2.5, 6.3).
 */

type Db = Pick<PrismaClient, 'platformMembership' | 'platformAccessSettings'>;

export interface ResolvedPlatformAccess {
  isSuperAdmin: boolean;
  permissions: PlatformPermissionKey[];
  roleName: string | null;
}

/** Super admins hold every platform key; others need an ACTIVE PlatformMembership. Null: no platform access. */
export async function loadPlatformAccess(prisma: Db, user: { id: string; isSuperAdmin: boolean }): Promise<ResolvedPlatformAccess | null> {
  if (user.isSuperAdmin) return { isSuperAdmin: true, permissions: [...ALL_PLATFORM_PERMISSIONS], roleName: null };
  const pm = await prisma.platformMembership.findUnique({
    where: { userId: user.id },
    include: { roleTemplate: { include: { permissions: true } } },
  });
  if (!pm || pm.status !== 'ACTIVE') return null;
  return {
    isSuperAdmin: false,
    permissions: resolvePlatformPermissions(pm.roleTemplate.permissions.map((p) => p.permissionKey)),
    roleName: pm.roleTemplate.name,
  };
}

/** Platform policy `require2faForPlatformRoles`; defaults to true when the row is missing. */
export async function requireTwoFactorForPlatformRoles(prisma: Db): Promise<boolean> {
  const row = await prisma.platformAccessSettings.findUnique({ where: { id: 'platform' } });
  return row?.require2faForPlatformRoles ?? true;
}

export type MfaGate = 'ok' | typeof PLATFORM_ACCESS_ERROR_CODES.mfaRequired | typeof PLATFORM_ACCESS_ERROR_CODES.mfaEnrollmentRequired;

/**
 * Whether a platform-level session may act with platform privileges.
 * - Enrolled accounts always need a session that passed the TOTP step.
 * - Super admins without 2FA are never locked out (grace): the web shell
 *   sends them to enrolment at next login instead.
 * - Platform members without 2FA are refused while the policy requires it;
 *   the enrolment endpoints only need a plain session, so they can enrol.
 */
export function platformMfaGate(
  user: { isSuperAdmin: boolean; mfaEnabled?: boolean; mfaVerified?: boolean },
  requirePolicy: boolean,
): MfaGate {
  if (user.mfaEnabled) return user.mfaVerified ? 'ok' : PLATFORM_ACCESS_ERROR_CODES.mfaRequired;
  if (user.isSuperAdmin) return 'ok';
  return requirePolicy ? PLATFORM_ACCESS_ERROR_CODES.mfaEnrollmentRequired : 'ok';
}

export function mfaGateError(gate: Exclude<MfaGate, 'ok'>): ForbiddenException {
  return new ForbiddenException({
    statusCode: 403,
    code: gate,
    message:
      gate === PLATFORM_ACCESS_ERROR_CODES.mfaRequired
        ? 'Bu işlem için iki adımlı doğrulama kodunu girmeniz gerekir'
        : 'Devam etmek için iki adımlı doğrulamayı etkinleştirin',
  });
}

export function platformAccessDenied(): ForbiddenException {
  return new ForbiddenException({
    statusCode: 403,
    code: PLATFORM_ACCESS_ERROR_CODES.platformAccessDenied,
    message: 'Bu işlem için platform yetkiniz yok',
  });
}
