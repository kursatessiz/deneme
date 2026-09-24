import {
  BookingStatus,
  CommissionType,
  EntitlementKind,
  MembershipStatus,
  PackageStatus,
} from './enums';
import type { PermissionKey } from './permissions';
import type { AppearancePreference, GradientPresetKey, TenantTheme } from './design/tokens';
import type { ThemeFamilyKey } from './design/themes';

export interface StudioDTO {
  id: string;
  name: string;
  slug: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  timezone: string;
  logoUrl?: string | null;
  themeFamily: ThemeFamilyKey;
  themePrimary: string;
  gradientPresetKey: GradientPresetKey;
  maxAdvanceBookingDays: number;
  reminderHoursBefore: number;
  isActive: boolean;
}

/** Global identity. Tenancy is described by memberships. */
export interface UserDTO {
  id: string;
  phone: string;
  email?: string | null;
  firstName: string;
  lastName: string;
  avatarUrl?: string | null;
  isSuperAdmin: boolean;
}

export interface MembershipDTO {
  id: string;
  studioId: string;
  studioName: string;
  studioSlug: string;
  status: MembershipStatus;
  roleKey: string;
  roleName: string;
  isOwner: boolean;
  permissions: PermissionKey[];
  memberProfileId?: string | null;
  trainerProfileId?: string | null;
  /** The member's home branch in this studio, if any. */
  homeBranchId?: string | null;
  /** The studio's brand and default theme family, for theming the app. */
  theme: TenantTheme;
}

export interface SessionUserDTO extends UserDTO {
  memberships: MembershipDTO[];
  appearance: AppearancePreference;
}

export interface MemberProfileDTO {
  id: string;
  membershipId: string;
  studioId: string;
  firstName: string;
  lastName: string;
  /** Omitted unless the caller has members.contact.view */
  phone?: string;
  email?: string | null;
  birthDate?: string | null;
  /** Omitted unless the caller has members.health.view */
  medicalConditions?: string | null;
  notes?: string | null;
  familyGroupId?: string | null;
}

export interface TrainerProfileDTO {
  id: string;
  membershipId: string;
  studioId: string;
  firstName: string;
  lastName: string;
  bio?: string | null;
  qualifiedServiceTypeIds: string[];
  commissionRule?: { id: string; name: string; type: CommissionType; value: number } | null;
}

export interface ResourceTypeDTO {
  id: string;
  name: string;
  selectableByMember: boolean;
}

export interface ResourceDTO {
  id: string;
  resourceTypeId: string;
  branchId?: string | null;
  parentResourceId?: string | null;
  name: string;
  capacity: number;
  isMaintenance: boolean;
}

export interface ServiceTypeDTO {
  id: string;
  name: string;
  description?: string | null;
  durationMin: number;
  capacity: number;
  minRepeatIntervalDays?: number | null;
  allowedEntitlementKinds: EntitlementKind[];
  requiresQualification: boolean;
  requiredResourceTypes: { resourceTypeId: string; quantity: number }[];
  isActive: boolean;
}

export interface PackageDefinitionDTO {
  id: string;
  studioId: string;
  name: string;
  entitlementKind: EntitlementKind;
  totalUnits?: number | null;
  validityDays: number;
  price: number;
  freezeDaysAllowed: number;
  isTransferable: boolean;
  services: { serviceTypeId: string; unitCost: number }[];
  isActive: boolean;
}

export interface MemberPackageDTO {
  id: string;
  memberId: string;
  packageDefinitionId: string;
  packageDefinitionName: string;
  entitlementKind: EntitlementKind;
  totalUnits?: number | null;
  usedUnits: number;
  remainingUnits?: number | null;
  status: PackageStatus;
  startDate: string;
  endDate: string;
  frozenUntil?: string | null;
}

export interface SessionScheduleDTO {
  id: string;
  studioId: string;
  branchId?: string | null;
  serviceTypeId: string;
  serviceTypeName: string;
  resourceId?: string | null;
  resourceName?: string | null;
  trainerId?: string | null;
  trainerName?: string | null;
  originalTrainerId?: string | null;
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
  memberPackageId?: string | null;
  status: BookingStatus;
  unitsCharged: number;
  resourceIds: string[];
  checkInAt?: string | null;
  bookedAt: string;
}

export interface DashboardMetricsDTO {
  todaySessionsCount: number;
  todayAttendeesCount: number;
  activeMembersCount: number;
  expiringPackagesCount: number;
  monthlyRevenue: number;
  /** Booked seats / capacity over today's sessions, percent. */
  occupancyRate: number;
}

export interface BranchDTO {
  id: string;
  studioId: string;
  name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  timezone: string | null;
  sortOrder: number;
  isActive: boolean;
}

/** Activity of one branch (or of sessions without a branch, branchId null) in a window. */
export interface BranchSummaryDTO {
  branchId: string | null;
  branchName: string;
  sessions: number;
  capacity: number;
  booked: number;
  attended: number;
  noShows: number;
  lateCancellations: number;
  /** booked / capacity, 0..1 */
  occupancy: number;
  /** Completed payments, in the studio currency, as a decimal string. */
  revenue: string;
  homeMembers: number;
}

export interface StudioPortfolioItemDTO {
  studioId: string;
  studioName: string;
  branchCount: number;
  activeMembers: number;
  sessions: number;
  occupancy: number;
  revenue: string;
}

export interface PortfolioSummaryDTO {
  from: string;
  to: string;
  studios: StudioPortfolioItemDTO[];
  totals: Omit<StudioPortfolioItemDTO, 'studioId' | 'studioName'>;
}
