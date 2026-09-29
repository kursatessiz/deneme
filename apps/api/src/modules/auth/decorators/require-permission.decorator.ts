import { SetMetadata, UseGuards, applyDecorators } from '@nestjs/common';
import type { PermissionKey } from '@platform/shared';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { StudioTenantGuard } from '../guards/studio-tenant.guard';
import { PermissionGuard } from '../guards/permission.guard';
import { BillingWriteGuard } from '../guards/billing-write.guard';

export const PERMISSIONS_KEY = 'requiredPermissions';
export const SELF_SERVICE_KEY = 'selfService';

/** Caller needs every listed permission in the current studio. */
export const RequirePermission = (...permissions: PermissionKey[]) => SetMetadata(PERMISSIONS_KEY, permissions);

/**
 * Any active member of the studio may call this; the handler is responsible
 * for limiting results to the caller's own data (tenant.memberProfileId).
 */
export const SelfService = () => SetMetadata(SELF_SERVICE_KEY, true);

/**
 * Restricted mode exception (G5c-1): this write stays available while the
 * studio's billing status is RESTRICTED or CANCELLED. Use only for the
 * member's own data and GDPR/KVKK requests; permission-based exceptions
 * live in RESTRICTED_MODE_ALLOWED_WRITE_PERMISSIONS (@platform/shared).
 */
export const ALLOW_WHEN_RESTRICTED_KEY = 'allowWhenRestricted';
export const AllowWhenRestricted = () => SetMetadata(ALLOW_WHEN_RESTRICTED_KEY, true);

/** JWT + tenant resolution + permission check + restricted-mode check, in that order. */
export const StudioScoped = () => applyDecorators(UseGuards(JwtAuthGuard, StudioTenantGuard, PermissionGuard, BillingWriteGuard));
