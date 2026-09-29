import { PERMISSIONS, PERMISSION_AREAS, isOwnerOnlyPermission } from '@platform/shared';
import type { PermissionArea, PermissionKey } from '@platform/shared';

export interface PermissionAreaGroup {
  area: PermissionArea;
  permissions: { key: PermissionKey; label: string }[];
}

/**
 * Groups the permission catalogue by area (`packages/shared/src/permissions.ts`)
 * for the role-template editor. Every grantable catalogue key appears
 * exactly once, areas keep the declaration order of `PERMISSION_AREAS`.
 * Owner-only keys (OWNER_ONLY_PERMISSIONS) are never offered, and an area
 * left without keys is dropped.
 */
export function groupPermissionsByArea(): PermissionAreaGroup[] {
  return (Object.keys(PERMISSION_AREAS) as PermissionArea[])
    .map((area) => ({
      area,
      permissions: (PERMISSION_AREAS[area] as readonly PermissionKey[])
        .filter((key) => !isOwnerOnlyPermission(key))
        .map((key) => ({ key, label: PERMISSIONS[key] })),
    }))
    .filter((group) => group.permissions.length > 0);
}

export interface RolePermissionDiff {
  added: PermissionKey[];
  removed: PermissionKey[];
}

/** What changed between a role's saved permission set and the editor's current selection, for a confirmation summary. */
export function diffRolePermissions(before: readonly PermissionKey[], after: readonly PermissionKey[]): RolePermissionDiff {
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  return {
    added: after.filter((p) => !beforeSet.has(p)),
    removed: before.filter((p) => !afterSet.has(p)),
  };
}
