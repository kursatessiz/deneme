import { EntitlementKind } from './enums';

/** A member package together with what its definition says about one service type. */
export interface PackageCandidate {
  id: string;
  entitlementKind: EntitlementKind | `${EntitlementKind}`;
  status: string;
  endDate: Date | string;
  createdAt: Date | string;
  frozenUntil: Date | string | null;
  remainingUnits: number | null;
  /** Units or credits one session of the service costs; null when the package does not cover the service. */
  unitCost: number | null;
}

/** Why the first usable-package check failed, or null when the package can pay. */
export function packageUnusableReason(
  pkg: PackageCandidate,
  allowedKinds: readonly (EntitlementKind | `${EntitlementKind}`)[],
  now: Date,
): 'inactive' | 'expired' | 'frozen' | 'notCovered' | 'kindNotAllowed' | 'noUnits' | null {
  if (pkg.status !== 'ACTIVE') return 'inactive';
  if (new Date(pkg.endDate).getTime() <= now.getTime()) return 'expired';
  if (pkg.frozenUntil && new Date(pkg.frozenUntil).getTime() > now.getTime()) return 'frozen';
  if (pkg.unitCost === null) return 'notCovered';
  if (allowedKinds.length > 0 && !allowedKinds.includes(pkg.entitlementKind)) return 'kindNotAllowed';
  if (pkg.entitlementKind !== 'TIME_UNLIMITED' && (pkg.remainingUnits ?? 0) < pkg.unitCost) return 'noUnits';
  return null;
}

/**
 * Picks the package a booking is charged to when the caller names none: active, not expired, not frozen,
 * covering the service with an allowed entitlement kind and enough units or credits (unlimited packages
 * need none). The package that expires soonest wins, then the oldest, then the id, so the choice is
 * deterministic. Returns null when nothing can pay.
 */
export function selectUsablePackage<T extends PackageCandidate>(
  candidates: readonly T[],
  allowedKinds: readonly (EntitlementKind | `${EntitlementKind}`)[],
  now: Date = new Date(),
): T | null {
  const usable = candidates.filter((c) => packageUnusableReason(c, allowedKinds, now) === null);
  usable.sort(
    (a, b) =>
      new Date(a.endDate).getTime() - new Date(b.endDate).getTime() ||
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() ||
      a.id.localeCompare(b.id),
  );
  return usable[0] ?? null;
}
