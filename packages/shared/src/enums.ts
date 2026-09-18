export enum UserRole {
  SUPER_ADMIN = 'SUPER_ADMIN',
  STUDIO_ADMIN = 'STUDIO_ADMIN',
  TRAINER = 'TRAINER',
  RECEPTIONIST = 'RECEPTIONIST',
  MEMBER = 'MEMBER',
}

export enum SessionType {
  PRIVATE_REFORMER = 'PRIVATE_REFORMER',       // 1-on-1 Reformer
  DUET_REFORMER = 'DUET_REFORMER',             // 2 persons
  TRIO_REFORMER = 'TRIO_REFORMER',             // 3 persons
  GROUP_REFORMER = 'GROUP_REFORMER',           // 4-6 persons
  CADILLAC_PILATES = 'CADILLAC_PILATES',       // Cadillac bed
  MAT_PILATES = 'MAT_PILATES',                 // Group mat
  EMS_TRAINING = 'EMS_TRAINING',               // Electro-muscle stimulation
  CLINICAL_PILATES = 'CLINICAL_PILATES',       // Posture/physio focused
}

export enum BookingStatus {
  CONFIRMED = 'CONFIRMED',
  ATTENDED = 'ATTENDED',
  CANCELLED_EARLY = 'CANCELLED_EARLY', // Cancelled before deadline (credit refunded)
  CANCELLED_LATE = 'CANCELLED_LATE',   // Cancelled after deadline (credit deducted)
  NO_SHOW = 'NO_SHOW',                 // Member didn't attend without notification
  WAITLIST = 'WAITLIST',               // In waitlist
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
  CASH = 'CASH',                     // Elden nakit
  CREDIT_CARD_POS = 'CREDIT_CARD_POS', // Fiziksel POS
  BANK_TRANSFER = 'BANK_TRANSFER',   // Havale / EFT
  ONLINE_IYZICO = 'ONLINE_IYZICO',   // iyzico online
  ONLINE_PAYTR = 'ONLINE_PAYTR',     // PayTR online
}

export enum NotificationChannel {
  SMS = 'SMS',
  WHATSAPP = 'WHATSAPP',
  PUSH = 'PUSH',
  EMAIL = 'EMAIL',
}

export enum CommissionType {
  PER_SESSION_FIXED = 'PER_SESSION_FIXED', // Seans başı sabit ücret (örn: 300 TL)
  PERCENTAGE = 'PERCENTAGE',               // Seans bedelinin yüzdesi (örn: %35)
  MONTHLY_SALARY = 'MONTHLY_SALARY',       // Sabit maaş
}
