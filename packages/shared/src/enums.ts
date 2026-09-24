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
