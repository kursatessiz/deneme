import { SetMetadata, UseGuards, applyDecorators } from '@nestjs/common';
import type { PermissionKey } from '@platform/shared';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { StudioTenantGuard } from '../guards/studio-tenant.guard';
import { PermissionGuard } from '../guards/permission.guard';

export const PERMISSIONS_KEY = 'requiredPermissions';
export const SELF_SERVICE_KEY = 'selfService';

/** Caller needs every listed permission in the current studio. */
export const RequirePermission = (...permissions: PermissionKey[]) => SetMetadata(PERMISSIONS_KEY, permissions);

/**
 * Any active member of the studio may call this; the handler is responsible
 * for limiting results to the caller's own data (tenant.memberProfileId).
 */
export const SelfService = () => SetMetadata(SELF_SERVICE_KEY, true);

/** JWT + tenant resolution + permission check, in that order. */
export const StudioScoped = () => applyDecorators(UseGuards(JwtAuthGuard, StudioTenantGuard, PermissionGuard));
