import { createParamDecorator, ExecutionContext, InternalServerErrorException, SetMetadata, UseGuards, applyDecorators } from '@nestjs/common';
import type { PlatformPermissionKey } from '@platform/shared';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { PlatformPermissionGuard } from '../guards/platform-permission.guard';
import type { AuthenticatedRequest, PlatformContext } from '../tenant-context';

export const PLATFORM_PERMISSIONS_KEY = 'requiredPlatformPermissions';
export const PLATFORM_ANY_ACCESS_KEY = 'platformAnyAccess';

/** Caller needs every listed platform permission (super admins hold all of them). */
export const RequirePlatformPermission = (...permissions: PlatformPermissionKey[]) => SetMetadata(PLATFORM_PERMISSIONS_KEY, permissions);

/** Any platform-level account may call this (e.g. the shell context); the handler must not expose more than that. */
export const PlatformAnyAccess = () => SetMetadata(PLATFORM_ANY_ACCESS_KEY, true);

/** JWT + platform permission check, in that order. Existing SuperAdminOnly() routes are unaffected. */
export const PlatformScoped = () => applyDecorators(UseGuards(JwtAuthGuard, PlatformPermissionGuard));

/** The resolved context of a @PlatformScoped() route. */
export const Platform = createParamDecorator((_data: unknown, ctx: ExecutionContext): PlatformContext => {
  const platform = ctx.switchToHttp().getRequest<AuthenticatedRequest>().platform;
  if (!platform) throw new InternalServerErrorException('Platform used without PlatformPermissionGuard');
  return platform;
});
