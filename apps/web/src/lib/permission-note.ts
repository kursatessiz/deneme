import { PERMISSIONS } from '@platform/shared';
import type { PermissionKey } from '@platform/shared';

/**
 * The catalogue label (`packages/shared/src/permissions.ts`, the same one
 * the role-template editor renders) of the first permission in `required`
 * the caller lacks -- for an inline "this needs X" note next to a disabled
 * action. Null when the caller already has the action (nothing missing) or
 * `required` is empty.
 */
export function firstMissingPermissionLabel(required: readonly PermissionKey[], granted: readonly PermissionKey[], isOwner: boolean): string | null {
  if (isOwner || required.length === 0) return null;
  const grantedSet = new Set(granted);
  if (required.some((key) => grantedSet.has(key))) return null;
  return PERMISSIONS[required[0]];
}
