import type { MemberPackage, Prisma } from '@platform/database';

/**
 * Adds `units` to the member's newest ACTIVE, not yet expired unit-based
 * package (session count or credits) inside the caller's transaction. Used by the referral
 * reward (W15) and loyalty rewards (G3a), so both credit a package the same
 * way. Returns the credited package, or null when the member has no
 * unit-based package that is active and unexpired (time-unlimited packages
 * have no units; an expired package must never receive new credit).
 * Relative increments: a concurrent booking deduction is never lost.
 */
export async function creditActivePackageUnits(
  tx: Prisma.TransactionClient,
  studioId: string,
  memberProfileId: string,
  units: number,
  now: Date = new Date(),
): Promise<MemberPackage | null> {
  if (units <= 0) return null;
  const activePackage = await tx.memberPackage.findFirst({
    where: { studioId, memberId: memberProfileId, status: 'ACTIVE', endDate: { gt: now }, entitlementKind: { in: ['SESSION_COUNT', 'CREDIT'] } },
    orderBy: { createdAt: 'desc' },
  });
  if (!activePackage) return null;
  return tx.memberPackage.update({
    where: { id: activePackage.id },
    data: {
      totalUnits: activePackage.totalUnits != null ? { increment: units } : undefined,
      remainingUnits: activePackage.remainingUnits != null ? { increment: units } : undefined,
    },
  });
}
