import type { PermissionKey, PlatformPermissionKey } from '@platform/shared';

/** Authenticated principal attached by JwtStrategy. No tenant data here. */
export interface AuthUser {
  id: string;
  phone: string;
  firstName: string;
  lastName: string;
  isSuperAdmin: boolean;
  /** The user has confirmed a TOTP authenticator (User.mfaEnabledAt). */
  mfaEnabled?: boolean;
  /** This access token was issued after the TOTP step (`mfa` claim). */
  mfaVerified?: boolean;
}

/** Resolved by PlatformPermissionGuard for @PlatformScoped() routes (docs/PAZARLAMA_MODULU.md 2.5). */
export interface PlatformContext {
  userId: string;
  isSuperAdmin: boolean;
  permissions: ReadonlySet<PlatformPermissionKey>;
  /** The platform tenant (Studio.isPlatform), always resolved server-side. */
  platformStudioId: string;
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
  /**
   * Branches a staff member may act on. Null means every branch (owners,
   * super-admins and staff without explicit grants).
   */
  branchIds: ReadonlySet<string> | null;
  /**
   * Studio.billingStatus (G5c-1). Read by BillingWriteGuard to enforce
   * restricted mode; absent where a tenant context is built by hand.
   */
  billingStatus?: string;
}

export interface AuthenticatedRequest {
  user?: AuthUser;
  tenant?: TenantContext;
  platform?: PlatformContext;
  params: Record<string, string | undefined>;
  query: Record<string, unknown>;
  body?: unknown;
  headers: Record<string, string | string[] | undefined>;
  method?: string;
}
