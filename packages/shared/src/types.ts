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
  /** Grid coordinates for a spot map, e.g. equipment inside a room. */
  layoutX?: number | null;
  layoutY?: number | null;
  /** Short visible label on a spot map, e.g. "3" or "Kort 2". */
  label?: string | null;
}

/** A single bookable unit's state on a session's spot map. */
export type SpotStatus = 'AVAILABLE' | 'TAKEN' | 'MAINTENANCE' | 'MINE';

export interface SpotDTO {
  id: string;
  name: string;
  label?: string | null;
  layoutX?: number | null;
  layoutY?: number | null;
  capacity: number;
  status: SpotStatus;
  /** Set only for staff with bookings.view, and only on a TAKEN spot; never shown to members. */
  takenByMemberName?: string | null;
}

export interface SpotGroupDTO {
  resourceTypeId: string;
  resourceTypeName: string;
  spots: SpotDTO[];
}

export interface ScheduleSpotsDTO {
  scheduleId: string;
  /** The session's room, if any; spots are its equipment, else the branch's standalone resources. */
  roomResourceId?: string | null;
  groups: SpotGroupDTO[];
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

/**
 * A lightweight session for members browsing what to book: no per-booking
 * detail, just enough to pick a session and open its spot map.
 */
export interface SessionScheduleSummaryDTO {
  id: string;
  studioId: string;
  branchId?: string | null;
  serviceTypeId: string;
  serviceTypeName: string;
  resourceId?: string | null;
  resourceName?: string | null;
  trainerId?: string | null;
  trainerName?: string | null;
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

// ---------------------------------------------------------------------------
// Leads (W11)
// ---------------------------------------------------------------------------

export interface LeadDTO {
  id: string;
  studioId: string;
  branchId: string | null;
  fullName: string;
  phone: string;
  email: string | null;
  source: string;
  sourceDetail: string | null;
  interestServiceTypeId: string | null;
  interestServiceTypeName: string | null;
  stage: string;
  lostReason: string | null;
  ownerMembershipId: string | null;
  ownerName: string | null;
  nextFollowUpAt: string | null;
  convertedMembershipId: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LeadActivityDTO {
  id: string;
  type: string;
  body: string;
  actorName: string | null;
  createdAt: string;
}

export interface LeadDetailDTO extends LeadDTO {
  activities: LeadActivityDTO[];
}

export interface LeadListResponseDTO {
  items: LeadDTO[];
  total: number;
  page: number;
  limit: number;
}
