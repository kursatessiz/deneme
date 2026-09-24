// Lifecycle states shared by every business type. Mirrors the Prisma enums.
// Sector-specific concepts (service types, resource types) are tenant data.

export enum MembershipStatus {
  INVITED = 'INVITED',
  ACTIVE = 'ACTIVE',
  PASSIVE = 'PASSIVE',
}

export enum InviteChannel {
  SHOWN = 'SHOWN',
  WHATSAPP = 'WHATSAPP',
  SMS = 'SMS',
}

export enum EntitlementKind {
  SESSION_COUNT = 'SESSION_COUNT',
  TIME_UNLIMITED = 'TIME_UNLIMITED',
  CREDIT = 'CREDIT',
}

export enum BookingStatus {
  CONFIRMED = 'CONFIRMED',
  ATTENDED = 'ATTENDED',
  CANCELLED_EARLY = 'CANCELLED_EARLY', // before the policy deadline, unit returned
  CANCELLED_LATE = 'CANCELLED_LATE', // after the deadline, unit charged
  NO_SHOW = 'NO_SHOW',
  WAITLIST = 'WAITLIST',
}

export enum WaitlistStatus {
  WAITING = 'WAITING',
  OFFERED = 'OFFERED',
  PROMOTED = 'PROMOTED',
  EXPIRED = 'EXPIRED',
  CANCELLED = 'CANCELLED',
}

export enum PackageStatus {
  ACTIVE = 'ACTIVE',
  FROZEN = 'FROZEN',
  EXPIRED = 'EXPIRED',
  DEPLETED = 'DEPLETED',
}

export enum PaymentStatus {
  PENDING = 'PENDING',
  COMPLETED = 'COMPLETED',
  REFUNDED = 'REFUNDED',
  FAILED = 'FAILED',
}

export enum PaymentMethod {
  CASH = 'CASH',
  CREDIT_CARD_POS = 'CREDIT_CARD_POS',
  BANK_TRANSFER = 'BANK_TRANSFER',
  ONLINE_IYZICO = 'ONLINE_IYZICO',
  ONLINE_PAYTR = 'ONLINE_PAYTR',
}

export enum NotificationChannel {
  WHATSAPP = 'WHATSAPP',
  SMS = 'SMS',
  PUSH = 'PUSH',
  EMAIL = 'EMAIL',
}

export enum NotificationStatus {
  PENDING = 'PENDING',
  SENT = 'SENT',
  FAILED = 'FAILED',
}

export enum CommissionType {
  PER_SESSION_FIXED = 'PER_SESSION_FIXED',
  PERCENTAGE = 'PERCENTAGE',
  MONTHLY_SALARY = 'MONTHLY_SALARY',
}

export enum DocumentType {
  MEMBERSHIP_CONTRACT = 'MEMBERSHIP_CONTRACT',
  KVKK_NOTICE = 'KVKK_NOTICE',
  EXPLICIT_CONSENT = 'EXPLICIT_CONSENT',
  HEALTH_WAIVER = 'HEALTH_WAIVER',
  /** KVKK explicit consent text for special-category health data sync (W21). */
  HEALTH_DATA = 'HEALTH_DATA',
}

export enum SmsTransactionType {
  PURCHASE = 'PURCHASE',
  USAGE = 'USAGE',
  ADJUSTMENT = 'ADJUSTMENT',
  REFUND = 'REFUND',
}

/** Payment provider adapter: MOCK is deterministic and used by default/tests. */
export enum PaymentProvider {
  MOCK = 'MOCK',
  IYZICO = 'IYZICO',
  PAYTR = 'PAYTR',
}

/** Auto-renewing member billing subscription (distinct from the platform Studio -> Plan subscription). */
export enum MemberSubscriptionStatus {
  ACTIVE = 'ACTIVE',
  PAST_DUE = 'PAST_DUE',
  CANCELLED = 'CANCELLED',
  PAUSED = 'PAUSED',
}

export enum PaymentAttemptStatus {
  SUCCEEDED = 'SUCCEEDED',
  FAILED = 'FAILED',
  PENDING = 'PENDING',
}

export enum LeadSource {
  WEB_FORM = 'WEB_FORM',
  INSTAGRAM = 'INSTAGRAM',
  WALK_IN = 'WALK_IN',
  REFERRAL = 'REFERRAL',
  PHONE = 'PHONE',
  OTHER = 'OTHER',
}

export enum LeadStage {
  NEW = 'NEW',
  CONTACTED = 'CONTACTED',
  TRIAL_BOOKED = 'TRIAL_BOOKED',
  TRIAL_DONE = 'TRIAL_DONE',
  WON = 'WON',
  LOST = 'LOST',
}

export enum LeadActivityType {
  NOTE = 'NOTE',
  CALL = 'CALL',
  MESSAGE = 'MESSAGE',
  STAGE_CHANGE = 'STAGE_CHANGE',
  TRIAL_BOOKED = 'TRIAL_BOOKED',
}

/**
 * Valid forward stage transitions. WON is terminal (no way back to an
 * earlier stage); LOST requires a reason and can be reached from any
 * non-terminal stage; a lead may not move backwards otherwise.
 */
export const LEAD_STAGE_TRANSITIONS: Record<LeadStage, readonly LeadStage[]> = {
  [LeadStage.NEW]: [LeadStage.CONTACTED, LeadStage.TRIAL_BOOKED, LeadStage.WON, LeadStage.LOST],
  [LeadStage.CONTACTED]: [LeadStage.TRIAL_BOOKED, LeadStage.WON, LeadStage.LOST],
  [LeadStage.TRIAL_BOOKED]: [LeadStage.TRIAL_DONE, LeadStage.WON, LeadStage.LOST],
  [LeadStage.TRIAL_DONE]: [LeadStage.WON, LeadStage.LOST],
  [LeadStage.WON]: [],
  [LeadStage.LOST]: [],
};

/** True when moving a lead from `from` to `to` is an allowed transition. */
export function canTransitionLeadStage(from: LeadStage, to: LeadStage): boolean {
  if (from === to) return false;
  return LEAD_STAGE_TRANSITIONS[from].includes(to);
}

/** How a studio issues e-invoices; NONE never auto-issues one. */
export enum EInvoiceMode {
  NONE = 'NONE',
  EARSIV = 'EARSIV',
  EFATURA = 'EFATURA',
}

/** e-invoice integrator adapter. MOCK is deterministic and disabled in production. */
export enum EInvoiceProvider {
  MOCK = 'MOCK',
  PARASUT = 'PARASUT',
  ELOGO = 'ELOGO',
  FORIBA = 'FORIBA',
  UYUMSOFT = 'UYUMSOFT',
}

export enum InvoiceStatus {
  DRAFT = 'DRAFT',
  ISSUED = 'ISSUED',
  CANCELLED = 'CANCELLED',
  FAILED = 'FAILED',
}

/** Whether a billing profile is a private individual (TCKN) or a company (VKN). */
export enum BillingProfileKind {
  INDIVIDUAL = 'INDIVIDUAL',
  COMPANY = 'COMPANY',
}

/** W9 sales tools: promo codes, gift cards, trial offers. */
export enum PromoCodeKind {
  PERCENT = 'PERCENT',
  FIXED_AMOUNT = 'FIXED_AMOUNT',
  FREE_UNITS = 'FREE_UNITS',
}

export enum GiftCardStatus {
  ACTIVE = 'ACTIVE',
  REDEEMED = 'REDEEMED',
  EXPIRED = 'EXPIRED',
  CANCELLED = 'CANCELLED',
}

export enum GiftCardTransactionType {
  ISSUE = 'ISSUE',
  REDEEM = 'REDEEM',
  REFUND = 'REFUND',
  ADJUST = 'ADJUST',
}

/** Gamification (W16): kind of condition a badge definition awards on. */
export enum BadgeKind {
  MILESTONE_SESSIONS = 'MILESTONE_SESSIONS',
  STREAK_WEEKS = 'STREAK_WEEKS',
  MONTHLY_GOAL_MET = 'MONTHLY_GOAL_MET',
  FIRST_SESSION = 'FIRST_SESSION',
  EARLY_BIRD = 'EARLY_BIRD',
  VARIETY = 'VARIETY',
}

export enum ReferralStatus {
  PENDING = 'PENDING',
  QUALIFIED = 'QUALIFIED',
  REWARDED = 'REWARDED',
  VOIDED = 'VOIDED',
}

/** Only EXTRA_UNITS exists while no gift-card module is on main (see W15). */
export enum ReferralRewardType {
  EXTRA_UNITS = 'EXTRA_UNITS',
}

/**
 * Generic workout type mapped from a tenant's ServiceType (W21). Kept
 * deliberately sector-neutral: it never encodes a business's own vocabulary,
 * only the closest Apple Health / Health Connect workout category. Defaults
 * to OTHER and is never hardcoded per sector.
 */
export enum HealthActivityType {
  STRENGTH = 'STRENGTH',
  FLEXIBILITY = 'FLEXIBILITY',
  YOGA = 'YOGA',
  PILATES = 'PILATES',
  DANCE = 'DANCE',
  MARTIAL_ARTS = 'MARTIAL_ARTS',
  SWIMMING = 'SWIMMING',
  CYCLING = 'CYCLING',
  RUNNING = 'RUNNING',
  WALKING = 'WALKING',
  TENNIS = 'TENNIS',
  OTHER = 'OTHER',
}

/** Which device health store a workout or aggregate was written from / to (W21). */
export enum HealthPlatform {
  APPLE_HEALTH = 'APPLE_HEALTH',
  HEALTH_CONNECT = 'HEALTH_CONNECT',
}

/** W19: how a session is delivered. IN_PERSON is the default for every existing session. */
export enum SessionDeliveryMode {
  IN_PERSON = 'IN_PERSON',
  ONLINE = 'ONLINE',
  HYBRID = 'HYBRID',
}

/** W19: which adapter produced a session's meeting link. */
export enum VideoMeetingProviderKind {
  MANUAL = 'MANUAL',
  JITSI = 'JITSI',
}

/** W19: on-demand library content source. UPLOADED is reserved, not implemented yet. */
export enum VideoContentProvider {
  EXTERNAL_URL = 'EXTERNAL_URL',
  UPLOADED = 'UPLOADED',
}

/** W19: who can see/watch a piece of on-demand content. */
export enum VideoContentVisibility {
  MEMBERS_WITH_ACTIVE_PACKAGE = 'MEMBERS_WITH_ACTIVE_PACKAGE',
  ALL_MEMBERS = 'ALL_MEMBERS',
  SPECIFIC_PACKAGES = 'SPECIFIC_PACKAGES',
}
