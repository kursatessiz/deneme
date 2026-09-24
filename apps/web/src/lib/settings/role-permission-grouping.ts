import { PERMISSIONS, PERMISSION_AREAS } from '@platform/shared';
import type { PermissionArea, PermissionKey } from '@platform/shared';

export interface PermissionAreaGroup {
  area: PermissionArea;
  permissions: { key: PermissionKey; label: string }[];
}

/**
 * Groups the permission catalogue by area (`packages/shared/src/permissions.ts`)
 * for the role-template editor. Every catalogue key appears exactly once,
 * areas keep the declaration order of `PERMISSION_AREAS`.
 */
export function groupPermissionsByArea(): PermissionAreaGroup[] {
  return (Object.keys(PERMISSION_AREAS) as PermissionArea[]).map((area) => ({
    area,
    permissions: PERMISSION_AREAS[area].map((key) => ({ key, label: PERMISSIONS[key] })),
  }));
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
