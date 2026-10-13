import { Prisma } from '@platform/database';
import { zonedDateKey } from '@platform/shared';

/**
 * Pure quota math, isolated for unit testing: how many spots out of a
 * session's remaining free capacity a partner connection may reserve, and
 * the decimal payout math for attended partner visits.
 */

/** Never reserves more than the session's actual remaining free capacity. */
export function computeReservedSpots(spotsPerSession: number, freeCapacity: number): number {
  return Math.max(0, Math.min(spotsPerSession, freeCapacity));
}

/** True once a partner spot allocation may no longer accept new reservations. */
export function isAllocationClosed(isReleased: boolean, releaseAt: Date, now: Date): boolean {
  return isReleased || now >= releaseAt;
}

/**
 * Expected payout for a month's attended partner visits: payoutRatePerVisit
 * (a Decimal string) times the visit count, using Prisma.Decimal so cents
 * never drift through floating point (CLAUDE.md: Prisma.Decimal for all
 * money). Returns a fixed 2-decimal string.
 */
export function computeExpectedPayout(payoutRatePerVisit: string, visits: number): string {
  return new Prisma.Decimal(payoutRatePerVisit).mul(visits).toFixed(2);
}

/**
 * Report month (`YYYY-MM`) of a partner visit: the month in which the SESSION
 * takes place, evaluated in the studio's time zone (not the booking's
 * creation time, and not UTC).
 */
export function partnerVisitMonthKey(sessionStart: Date, timeZone: string): string {
  return zonedDateKey(sessionStart, timeZone).slice(0, 7);
}
