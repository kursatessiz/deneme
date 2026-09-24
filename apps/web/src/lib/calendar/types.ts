export interface BookingRow {
  id: string;
  memberId: string;
  status: 'CONFIRMED' | 'ATTENDED' | 'CANCELLED_EARLY' | 'CANCELLED_LATE' | 'NO_SHOW' | 'WAITLIST';
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

export interface ResourceRow {
  id: string;
  name: string;
  branchId?: string | null;
  isMaintenance?: boolean;
}

export interface ServiceTypeRow {
  id: string;
  name: string;
  durationMin: number;
  capacity: number;
  requiresQualification?: boolean;
}

export interface BranchRow {
  id: string;
  name: string;
  isActive?: boolean;
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
