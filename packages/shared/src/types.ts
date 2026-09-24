import {
  BookingStatus,
  CommissionType,
  EntitlementKind,
  GiftCardStatus,
  GiftCardTransactionType,
  HealthActivityType,
  MemberSubscriptionStatus,
  MembershipStatus,
  PackageStatus,
  PaymentAttemptStatus,
  PaymentMethod,
  PaymentProvider,
  PaymentStatus,
  PromoCodeKind,
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
  healthActivityType: HealthActivityType;
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
  /** W19: ONLINE/HYBRID sessions can be joined once the join window opens; the link itself is never listed here. */
  deliveryMode: 'IN_PERSON' | 'ONLINE' | 'HYBRID';
  onlineCapacity?: number | null;
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
// Payments (W6)
// ---------------------------------------------------------------------------

export interface StoredCardDTO {
  id: string;
  memberId: string;
  provider: PaymentProvider;
  last4: string;
  brand: string;
  expMonth: number;
  expYear: number;
  isDefault: boolean;
}

export interface PaymentDTO {
  id: string;
  studioId: string;
  memberId: string;
  /**
   * First name plus the initial of the last name (see
   * `maskLeaderboardName` in gamification.ts), or the full name when the
   * caller has `members.contact.view`. Only set by list endpoints that join
   * the member; absent elsewhere.
   */
  memberDisplayName?: string;
  memberPackageId?: string | null;
  memberSubscriptionId?: string | null;
  branchId?: string | null;
  amount: string;
  currency: string;
  refundedAmount: string;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  provider?: PaymentProvider | null;
  installmentCount: number;
  receiptNumber?: string | null;
  providerReference?: string | null;
  notes?: string | null;
  paidAt: string;
}

export interface MemberSubscriptionDTO {
  id: string;
  memberId: string;
  packageDefinitionId: string;
  packageDefinitionName: string;
  storedCardId?: string | null;
  status: MemberSubscriptionStatus;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  nextChargeAt: string;
  cancelAtPeriodEnd: boolean;
  installmentCount: number;
}

export interface InvoiceDTO {
  id: string;
  studioId: string;
  branchId?: string | null;
  paymentId: string;
  number: string;
  issueDate: string;
  subtotal: string;
  vatAmount: string;
  total: string;
  currency: string;
  status: string;
  provider: string;
  providerUuid?: string | null;
  /** Set for real integrators that return a public/pre-signed document link; MOCK leaves this empty (see docs/INVOICING.md). */
  pdfUrl?: string | null;
  failureReason?: string | null;
  cancelledAt?: string | null;
  cancelReason?: string | null;
}

export interface PaymentAttemptDTO {
  id: string;
  memberSubscriptionId: string;
  attemptNumber: number;
  status: PaymentAttemptStatus;
  failureCode?: string | null;
  nextRetryAt?: string | null;
  createdAt: string;
}

/** Result of a provider checkout/charge call, shared by every adapter. */
export interface ProviderChargeResult {
  success: boolean;
  providerReference: string;
  /** Present only for a stored-card charge that produced or reused a token. */
  cardToken?: { token: string; last4: string; brand: string; expMonth: number; expYear: number };
  failureCode?: string;
  failureMessage?: string;
}

/** Result of starting a hosted/online checkout (member self-service or staff online sale). */
export interface ProviderCheckoutResult {
  providerReference: string;
  /** Mock adapter resolves immediately; real adapters return a redirect URL instead. */
  status: 'PENDING' | 'COMPLETED';
  checkoutUrl?: string;
}

// ---------------------------------------------------------------------------
// W13: reports
// ---------------------------------------------------------------------------

export interface OccupancyDayRowDTO {
  /** ISO date (yyyy-mm-dd) in the studio timezone. */
  date: string;
  sessions: number;
  capacity: number;
  booked: number;
  attended: number;
  /** booked / capacity, 0..1 */
  occupancy: number;
}

export interface OccupancyServiceRowDTO {
  serviceTypeId: string;
  serviceTypeName: string;
  sessions: number;
  capacity: number;
  booked: number;
  attended: number;
  occupancy: number;
}

export interface OccupancyHeatmapCellDTO {
  /** 0 (Monday) .. 6 (Sunday), ISO weekday - 1, in the studio timezone. */
  weekday: number;
  /** 0..23, in the studio timezone. */
  hour: number;
  sessions: number;
  capacity: number;
  booked: number;
  occupancy: number;
}

export interface OccupancyReportDTO {
  from: string;
  to: string;
  byDay: OccupancyDayRowDTO[];
  byServiceType: OccupancyServiceRowDTO[];
  heatmap: OccupancyHeatmapCellDTO[];
}

export interface RevenuePeriodRowDTO {
  /** ISO date (day/week start) or yyyy-MM for month granularity. */
  period: string;
  amount: string;
  paymentCount: number;
}

export interface RevenueMethodRowDTO {
  paymentMethod: string;
  amount: string;
  paymentCount: number;
}

export interface RevenuePackageRowDTO {
  packageDefinitionId: string | null;
  packageDefinitionName: string;
  amount: string;
  paymentCount: number;
}

export type ReportGranularity = 'day' | 'week' | 'month';

export interface RevenueReportDTO {
  from: string;
  to: string;
  granularity: ReportGranularity;
  total: string;
  byPeriod: RevenuePeriodRowDTO[];
  byMethod: RevenueMethodRowDTO[];
  byPackage: RevenuePackageRowDTO[];
  /** Only present when Payment.refundedAmount exists in the current schema. */
  /** Sum of refundedAmount over the payments in range. */
  refundTotal: string;
  /** total - refundTotal */
  netTotal: string;
}

export interface MembersReportDTO {
  from: string;
  to: string;
  activeMembers: number;
  newMembers: number;
  churnedMembers: number;
  revenue: string;
  /** revenue / activeMembers, as a decimal string; "0.00" when no active members. */
  arpu: string;
}

export interface RenewalReportDTO {
  from: string;
  to: string;
  expiredPackages: number;
  renewedPackages: number;
  /** renewedPackages / expiredPackages, 0..1; 0 when expiredPackages is 0. */
  renewalRate: number;
}

export interface CohortRowDTO {
  /** yyyy-MM of the member's first package purchase. */
  cohortMonth: string;
  cohortSize: number;
  /** retention[0] is month 0 (the cohort month itself), up to 11 months later. */
  retention: number[];
}

export interface CohortReportDTO {
  cohorts: CohortRowDTO[];
}

export interface TrainerReportRowDTO {
  trainerProfileId: string;
  trainerName: string;
  sessions: number;
  capacity: number;
  booked: number;
  attended: number;
  occupancy: number;
  noShows: number;
  lateCancellations: number;
  substitutions: number;
}

export interface TrainerReportDTO {
  from: string;
  to: string;
  trainers: TrainerReportRowDTO[];
}

// ---------------------------------------------------------------------------
// Payroll (trainer commission runs, W14)
// ---------------------------------------------------------------------------

export type PayrollRunStatus = 'DRAFT' | 'APPROVED' | 'PAID';

/** One booking's contribution to a trainer's payroll line, for the audit trail. */
export interface PayrollLineDetailDTO {
  scheduleId: string;
  bookingId: string | null;
  serviceTypeName: string;
  startTime: string;
  ruleType: CommissionType;
  ruleSource: 'SERVICE_TYPE' | 'TRAINER';
  /** Units consumed by the booking (unitsCharged, penaltyUnits for late cancels). */
  units: number;
  /** Only set for PERCENTAGE rules: package price / totalUnits (or / validity days for TIME_UNLIMITED). */
  unitPrice: string | null;
  amount: string;
}

export interface PayrollLineDTO {
  id: string;
  runId: string;
  trainerProfileId: string;
  trainerFullName: string;
  sessions: number;
  attendees: number;
  grossAmount: string;
  adjustments: string;
  netAmount: string;
  note: string | null;
  lines: PayrollLineDetailDTO[];
}

export interface PayrollRunDTO {
  id: string;
  studioId: string;
  branchId: string | null;
  periodStart: string;
  periodEnd: string;
  status: PayrollRunStatus;
  totalGross: string;
  totalAdjustments: string;
  totalNet: string;
  createdByUserId: string;
  approvedByUserId: string | null;
  approvedAt: string | null;
  paidAt: string | null;
  createdAt: string;
  lines?: PayrollLineDTO[];
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

/** Result of an EInvoiceProvider.issue() call. */
export interface EInvoiceIssueResult {
  success: boolean;
  providerUuid?: string;
  providerStatus?: string;
  pdfUrl?: string;
  failureMessage?: string;
}

/** Result of an EInvoiceProvider.cancel() call. */
export interface EInvoiceCancelResult {
  success: boolean;
  failureMessage?: string;
}

// ---------------------------------------------------------------------------
// Sales tools: trial offers, promo codes, gift cards (W9)
// ---------------------------------------------------------------------------

/** Public listing of a studio's active trial offers (no auth, by slug). */
export interface TrialOfferDTO {
  packageDefinitionId: string;
  name: string;
  price: string;
  currency: string;
  totalUnits: number | null;
  validityDays: number;
}

export interface PromoCodeDTO {
  id: string;
  studioId: string;
  code: string;
  kind: PromoCodeKind;
  value: string;
  validFrom?: string | null;
  validTo?: string | null;
  maxRedemptions?: number | null;
  redeemedCount: number;
  perUserLimit: number;
  minAmount?: string | null;
  applicablePackageDefinitionIds: string[];
  newMembersOnly: boolean;
  isActive: boolean;
  createdAt: string;
}

export interface PromoRedemptionDTO {
  id: string;
  promoCodeId: string;
  userId: string;
  paymentId: string;
  discountAmount: string;
  createdAt: string;
}

/** Preview of what a code would discount, without redeeming it. */
export interface PromoPreviewDTO {
  valid: boolean;
  reason?: string;
  basePrice: string;
  discountAmount: string;
  finalAmount: string;
  bonusUnits: number;
}

export interface GiftCardDTO {
  id: string;
  studioId: string;
  last4: string;
  initialAmount: string;
  balance: string;
  currency: string;
  purchaserUserId?: string | null;
  recipientName?: string | null;
  recipientPhone?: string | null;
  message?: string | null;
  expiresAt?: string | null;
  status: GiftCardStatus;
  createdAt: string;
}

/** Returned once, right after a gift card is issued: the only time the full code is shown. */
export interface GiftCardIssuedDTO extends GiftCardDTO {
  code: string;
}

export interface GiftCardTransactionDTO {
  id: string;
  giftCardId: string;
  type: GiftCardTransactionType;
  amount: string;
  paymentId?: string | null;
  actorUserId?: string | null;
  note?: string | null;
  createdAt: string;
}

/** Member self-service balance check result; never reveals the studio-wide card list. */
export interface GiftCardBalanceDTO {
  last4: string;
  balance: string;
  currency: string;
  status: GiftCardStatus;
  expiresAt?: string | null;
}

export interface RoleTemplateDTO {
  id: string;
  studioId: string;
  key: string;
  name: string;
  isOwner: boolean;
  isSystem: boolean;
  permissions: string[];
}

/** A staff (non-member) membership, for the role-assignment screen. */
export interface StaffMembershipDTO {
  membershipId: string;
  userId: string;
  fullName: string;
  phone: string;
  status: string;
  roleTemplateId: string;
  roleName: string;
  isOwner: boolean;
}

// ---------------------------------------------------------------------------
// Expenses (W2.4)
// ---------------------------------------------------------------------------

export interface ExpenseDTO {
  id: string;
  studioId: string;
  branchId: string | null;
  category: string;
  amount: string;
  spentAt: string;
  note: string | null;
  createdByUserId: string;
  createdByName: string | null;
  createdAt: string;
}
