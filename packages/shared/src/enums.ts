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
