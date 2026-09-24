import type { PermissionKey } from '@platform/shared';

/** Authenticated principal attached by JwtStrategy. No tenant data here. */
export interface AuthUser {
  id: string;
  phone: string;
  firstName: string;
  lastName: string;
  isSuperAdmin: boolean;
}

/** Resolved by StudioTenantGuard for studio-scoped routes. */
export interface TenantContext {
  studioId: string;
  /** Null only for super-admins acting on a studio they are not a member of. */
  membershipId: string | null;
  isOwner: boolean;
  isSuperAdmin: boolean;
  permissions: ReadonlySet<PermissionKey>;
  memberProfileId: string | null;
  trainerProfileId: string | null;
}

export interface AuthenticatedRequest {
  user?: AuthUser;
  tenant?: TenantContext;
  params: Record<string, string | undefined>;
  query: Record<string, unknown>;
  body?: unknown;
  headers: Record<string, string | string[] | undefined>;
}
