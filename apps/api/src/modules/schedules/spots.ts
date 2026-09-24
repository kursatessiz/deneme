import type { SpotStatus } from '@platform/shared';

export interface SpotOccupant {
  memberId: string;
  memberName: string;
}

export interface DeriveSpotStatusInput {
  isMaintenance: boolean;
  capacity: number;
  /** Members currently holding this resource for the session's time window. */
  occupants: SpotOccupant[];
  /** The caller's own member profile id, or null for staff without one. */
  callerMemberId: string | null;
}

export interface DeriveSpotStatusResult {
  status: SpotStatus;
  takenBy?: SpotOccupant;
}

/**
 * Pure status derivation for one spot on a session's spot map. Maintenance
 * wins over everything; the caller's own hold is MINE even if the resource
 * is otherwise (over)booked; a resource whose active holds reach its
 * capacity is TAKEN, and it never spills the occupant's identity to a
 * member, only who is calling this.
 */
export function deriveSpotStatus(input: DeriveSpotStatusInput): DeriveSpotStatusResult {
  if (input.isMaintenance) {
    return { status: 'MAINTENANCE' };
  }
  const mine = input.callerMemberId ? input.occupants.find((o) => o.memberId === input.callerMemberId) : undefined;
  if (mine) {
    return { status: 'MINE', takenBy: mine };
  }
  if (input.occupants.length >= Math.max(input.capacity, 1)) {
    return { status: 'TAKEN', takenBy: input.occupants[0] };
  }
  return { status: 'AVAILABLE' };
}
