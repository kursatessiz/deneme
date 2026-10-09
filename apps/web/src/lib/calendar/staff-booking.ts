import type { BookSessionInput } from '@platform/shared';
import type { MemberPackageRow } from '@/lib/members/types';

/** apiErrors key the API answers with when a booking breaks the service's minimum repeat interval. */
export const REPEAT_INTERVAL_ERROR_CODE = 'apiErrors.schedules.minRepeatIntervalNotElapsed';
/** apiErrors key of a full session; staff may then offer the waitlist. */
export const SESSION_FULL_ERROR_CODE = 'apiErrors.schedules.sessionFull';

/** The minimal error shape these helpers read (BffError satisfies it). */
export interface BookingErrorLike {
  status?: number;
  code?: string | null;
  params?: Record<string, string | number> | null;
}

export interface RepeatIntervalConflict {
  count: number;
  /** ISO instant of the conflicting session. */
  date: string;
}

/** Reads the minimum-repeat-interval rejection so the UI can offer the staff override; null for any other error. */
export function repeatIntervalConflict(error: BookingErrorLike | null | undefined): RepeatIntervalConflict | null {
  if (!error || error.status !== 400 || error.code !== REPEAT_INTERVAL_ERROR_CODE) return null;
  const count = Number(error.params?.count);
  const date = error.params?.date;
  if (!Number.isFinite(count) || typeof date !== 'string') return null;
  return { count, date };
}

export function isSessionFull(error: BookingErrorLike | null | undefined): boolean {
  return !!error && error.code === SESSION_FULL_ERROR_CODE;
}

/** A package definition with the services it covers, as `catalog/package-definitions` returns it. */
export interface PackageDefinitionCoverage {
  id: string;
  services: { serviceTypeId: string }[];
}

/** Active, not expired and with units left (or unlimited). */
export function isPackageUsable(pkg: MemberPackageRow, now: Date = new Date()): boolean {
  if (pkg.status !== 'ACTIVE') return false;
  if (new Date(pkg.endDate).getTime() < now.getTime()) return false;
  return pkg.entitlementKind === 'TIME_UNLIMITED' || (pkg.remainingUnits ?? 0) > 0;
}

/**
 * Packages of the member that can pay for a session of `serviceTypeId`: active, not expired, units left
 * (or unlimited) and, when the definitions are known, covering the service. Without definitions
 * (staff lacking catalog.view) every usable package is offered and the API decides.
 */
export function usablePackages(
  packages: MemberPackageRow[],
  definitions: PackageDefinitionCoverage[] | null,
  serviceTypeId: string,
  now: Date = new Date(),
): MemberPackageRow[] {
  return packages.filter((pkg) => {
    if (!isPackageUsable(pkg, now)) return false;
    if (!definitions) return true;
    const definition = definitions.find((d) => d.id === pkg.packageDefinitionId);
    return !!definition && definition.services.some((s) => s.serviceTypeId === serviceTypeId);
  });
}

export interface StaffBookingDraft {
  studioId: string;
  scheduleId: string;
  memberId: string;
  memberPackageId: string;
  /** One chosen spot per group; empty strings (no choice) are dropped. */
  resourceIds: string[];
  overrideRepeatInterval: boolean;
}

/** Body of POST /schedules/book (BookSessionSchema) from the dialog state. */
export function buildBookBody(draft: StaffBookingDraft): BookSessionInput {
  return {
    studioId: draft.studioId,
    scheduleId: draft.scheduleId,
    memberId: draft.memberId,
    resourceIds: draft.resourceIds.filter((id) => id !== ''),
    ...(draft.memberPackageId ? { memberPackageId: draft.memberPackageId } : {}),
    ...(draft.overrideRepeatInterval ? { overrideRepeatInterval: true } : {}),
  };
}

/** Service types any of the given packages covers; null definitions mean unknown (no filtering). */
export function coveredServiceTypeIds(
  packages: MemberPackageRow[],
  definitions: PackageDefinitionCoverage[] | null,
): Set<string> | null {
  if (!definitions) return null;
  const ids = new Set<string>();
  for (const pkg of packages.filter((p) => isPackageUsable(p))) {
    const definition = definitions.find((d) => d.id === pkg.packageDefinitionId);
    for (const service of definition?.services ?? []) ids.add(service.serviceTypeId);
  }
  return ids;
}

export interface BookableSessionLike {
  serviceTypeId: string;
  isCancelled: boolean;
  capacity: number;
  bookedCount: number;
  endTime: string;
}

/** Upcoming, not cancelled sessions with a free place, optionally limited to the covered service types. */
export function bookableSessions<T extends BookableSessionLike>(sessions: T[], covered: Set<string> | null, now: Date = new Date()): T[] {
  return sessions
    .filter((s) => !s.isCancelled && s.bookedCount < s.capacity && new Date(s.endTime).getTime() > now.getTime())
    .filter((s) => !covered || covered.has(s.serviceTypeId));
}
