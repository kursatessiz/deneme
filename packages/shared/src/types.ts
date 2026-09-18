import { UserRole, SessionType, BookingStatus, PackageStatus, PaymentMethod, PaymentStatus, CommissionType } from './enums';

export interface StudioConfig {
  cancellationDeadlineHours: number; // e.g. 4 hours before session
  maxAdvanceBookingDays: number;     // e.g. 14 days ahead
  reminderHoursBefore: number;       // e.g. 2 hours before session
  allowWaitlist: boolean;
  maxWaitlistPerSession: number;
}

export interface StudioDTO {
  id: string;
  name: string;
  slug: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  logoUrl?: string | null;
  primaryColor?: string | null;
  secondaryColor?: string | null;
  config: StudioConfig;
  isActive: boolean;
  createdAt: string;
}

export interface UserDTO {
  id: string;
  studioId?: string | null;
  email: string;
  phone: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  avatarUrl?: string | null;
  isActive: boolean;
}

export interface MemberProfileDTO {
  id: string;
  userId: string;
  studioId: string;
  birthDate?: string | null;
  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
  medicalConditions?: string | null; // Bel fıtığı, skolyoz, boyun düzleşmesi vb.
  notes?: string | null;
  hasSignedWaiver: boolean;
  activePackagesCount: number;
  remainingCreditsTotal: number;
}

export interface TrainerProfileDTO {
  id: string;
  userId: string;
  studioId: string;
  bio?: string | null;
  specialties: SessionType[];
  commissionType: CommissionType;
  commissionValue: number; // e.g. 350 for fixed 350TL or 35 for 35%
}

export interface PackageDefinitionDTO {
  id: string;
  studioId: string;
  name: string;
  sessionType: SessionType;
  totalSessions: number;
  validityDays: number;
  price: number;
  freezeDaysAllowed: number;
  isActive: boolean;
}

export interface MemberPackageDTO {
  id: string;
  memberId: string;
  packageDefinitionId: string;
  packageDefinitionName: string;
  sessionType: SessionType;
  totalSessions: number;
  usedSessions: number;
  remainingSessions: number;
  status: PackageStatus;
  startDate: string;
  endDate: string;
  frozenUntil?: string | null;
}

export interface SessionScheduleDTO {
  id: string;
  studioId: string;
  branchId?: string | null;
  roomId?: string | null;
  roomName?: string | null;
  trainerId: string;
  trainerName: string;
  sessionType: SessionType;
  title: string;
  startTime: string;
  endTime: string;
  capacity: number;
  bookedCount: number;
  isCancelled: boolean;
}

export interface BookingDTO {
  id: string;
  scheduleId: string;
  memberId: string;
  memberName: string;
  memberPhone: string;
  memberPackageId: string;
  status: BookingStatus;
  checkInAt?: string | null;
  bookedAt: string;
}

export interface DashboardMetricsDTO {
  todaySessionsCount: number;
  todayAttendeesCount: number;
  activeMembersCount: number;
  expiringPackagesCount: number;
  monthlyRevenue: number;
  reformerOccupancyRate: number; // percentage e.g. 84.5
}
