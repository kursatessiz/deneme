import { ForbiddenException } from '@nestjs/common';
import type { TenantContext } from '../auth/tenant-context';

/**
 * Branch scoping for staff. A null branch on a row means "not tied to a
 * branch" (studio-wide) and stays visible to everyone in the studio.
 */
export function canAccessBranch(tenant: TenantContext, branchId: string | null | undefined): boolean {
  return tenant.branchIds === null || !branchId || tenant.branchIds.has(branchId);
}

export function assertBranchAccess(tenant: TenantContext, branchId: string | null | undefined): void {
  if (!canAccessBranch(tenant, branchId)) {
    throw new ForbiddenException('Bu şubede işlem yetkiniz yok');
  }
}

/**
 * Prisma `where` fragment for rows with a nullable branchId column.
 * An explicit filter must be a branch the caller may see.
 */
export function branchScope(
  tenant: TenantContext,
  requested?: string,
): { branchId?: string } | { OR: ({ branchId: { in: string[] } } | { branchId: null })[] } {
  if (requested) {
    assertBranchAccess(tenant, requested);
    return { branchId: requested };
  }
  if (tenant.branchIds === null) return {};
  return { OR: [{ branchId: { in: [...tenant.branchIds] } }, { branchId: null }] };
}

/** Staff restricted to some branches may not create branches or grant access. */
export function assertUnrestricted(tenant: TenantContext): void {
  if (tenant.branchIds !== null) {
    throw new ForbiddenException('Bu işlem tüm şubelere erişimi olan kullanıcılar içindir');
  }
}
