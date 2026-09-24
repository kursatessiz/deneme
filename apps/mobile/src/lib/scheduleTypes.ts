/**
 * Local view types for the staff-facing schedule endpoints
 * (GET /schedules/studio/:studioId and friends), which return a raw,
 * nested roster shape rather than one of the flatter shared DTOs. Mirrors
 * apps/web/src/lib/calendar/types.ts so the mobile roster/check-in screens
 * read the same response shape the web calendar already relies on.
 */

export type BookingStatus = 'CONFIRMED' | 'ATTENDED' | 'CANCELLED_EARLY' | 'CANCELLED_LATE' | 'NO_SHOW' | 'WAITLIST';

export interface BookingRow {
  id: string;
  memberId: string;
  status: BookingStatus;
  unitsCharged: number;
  member?: {
    firstName?: string;
    lastName?: string;
    phone?: string;
    membership?: { isPartnerGuest?: boolean; user?: { firstName: string; lastName: string; phone?: string } };
  } | null;
  partnerConnection?: { provider: string; label: string } | null;
}

export interface ScheduleRow {
  id: string;
  studioId: string;
  branchId: string | null;
  serviceTypeId: string;
  resourceId: string | null;
  trainerId: string | null;
  originalTrainerId?: string | null;
  title: string;
  startTime: string;
  endTime: string;
  capacity: number;
  bookedCount: number;
  isCancelled: boolean;
  cancellationReason?: string | null;
  deliveryMode?: 'IN_PERSON' | 'ONLINE' | 'HYBRID';
  onlineCapacity?: number | null;
  resource?: { id: string; name: string; branchId?: string | null } | null;
  serviceType?: { id: string; name: string; durationMin?: number } | null;
  trainer?: { id: string; membership?: { user?: { firstName: string; lastName: string } } } | null;
  bookings: BookingRow[];
}

export interface TrainerRow {
  id: string;
  firstName: string;
  lastName: string;
}

export interface WaitlistRow {
  id: string;
  memberId: string;
  placeInLine: number;
  status: string;
  member?: { membership?: { user?: { firstName: string; lastName: string } } } | null;
}

export function trainerName(t: ScheduleRow['trainer']): string | null {
  if (!t?.membership?.user) return null;
  return `${t.membership.user.firstName} ${t.membership.user.lastName}`.trim();
}

export function bookingMemberName(b: BookingRow): string {
  const user = b.member?.membership?.user;
  if (user) return `${user.firstName} ${user.lastName}`.trim();
  if (b.partnerConnection) return b.partnerConnection.label || b.partnerConnection.provider;
  return 'Üye';
}

export const BOOKING_STATUS_LABEL: Record<BookingStatus, string> = {
  CONFIRMED: 'Onaylı',
  ATTENDED: 'Katıldı',
  CANCELLED_EARLY: 'İptal',
  CANCELLED_LATE: 'Geç iptal',
  NO_SHOW: 'Gelmedi',
  WAITLIST: 'Bekleme listesi',
};

/** Bookings shown in the roster section, excluding the separate waitlist section. */
export function rosterOf(schedule: ScheduleRow): BookingRow[] {
  return schedule.bookings.filter((b) => b.status !== 'WAITLIST');
}
