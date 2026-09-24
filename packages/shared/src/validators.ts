import { z } from 'zod';
import { CommissionType, EntitlementKind, InviteChannel, PaymentMethod } from './enums';
import { normalizePhone } from './phone';

/** Accepts common formats and outputs E.164. */
export const PhoneSchema = z
  .string()
  .transform((value, ctx) => {
    const normalized = normalizePhone(value);
    if (!normalized) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Geçerli bir telefon numarası giriniz (örn: 0532 111 22 33)' });
      return z.NEVER;
    }
    return normalized;
  });

export const LoginSchema = z.object({
  emailOrPhone: z.string().min(3, 'Geçerli bir e-posta veya telefon giriniz'),
  password: z.string().min(6, 'Şifre en az 6 karakter olmalıdır'),
});
export type LoginInput = z.infer<typeof LoginSchema>;

export const CreateMemberSchema = z.object({
  studioId: z.string().uuid(),
  firstName: z.string().trim().min(2, 'Ad en az 2 karakter olmalıdır'),
  lastName: z.string().trim().min(2, 'Soyad en az 2 karakter olmalıdır'),
  phone: PhoneSchema,
  email: z.string().email('Geçersiz e-posta formatı').optional().or(z.literal('')),
  birthDate: z.string().optional(),
  emergencyContactName: z.string().optional(),
  emergencyContactPhone: z.string().optional(),
  medicalConditions: z.string().optional(),
  notes: z.string().optional(),
});
export type CreateMemberInput = z.infer<typeof CreateMemberSchema>;

export const CreateInviteSchema = z.object({
  studioId: z.string().uuid(),
  fullName: z.string().trim().min(3, 'Ad soyad giriniz'),
  phone: PhoneSchema,
  roleKey: z.string().min(1).default('member'),
  channel: z.nativeEnum(InviteChannel).default(InviteChannel.SHOWN),
});
export type CreateInviteInput = z.infer<typeof CreateInviteSchema>;

export const CreatePackageDefinitionSchema = z
  .object({
    studioId: z.string().uuid(),
    name: z.string().trim().min(3, 'Paket adı zorunludur'),
    entitlementKind: z.nativeEnum(EntitlementKind),
    totalUnits: z.number().int().positive('Seans/kredi sayısı 0 dan büyük olmalıdır').optional(),
    validityDays: z.number().int().positive('Geçerlilik süresi en az 1 gün olmalıdır'),
    price: z.number().nonnegative('Fiyat 0 veya üzeri olmalıdır'),
    freezeDaysAllowed: z.number().int().nonnegative().default(0),
    isTransferable: z.boolean().default(false),
    services: z
      .array(z.object({ serviceTypeId: z.string().uuid(), unitCost: z.number().int().positive().default(1) }))
      .min(1, 'Paket en az bir hizmeti kapsamalıdır'),
  })
  .refine((v) => v.entitlementKind === EntitlementKind.TIME_UNLIMITED || v.totalUnits !== undefined, {
    path: ['totalUnits'],
    message: 'Seans veya kredi paketlerinde adet zorunludur',
  });
export type CreatePackageDefinitionInput = z.infer<typeof CreatePackageDefinitionSchema>;

export const AssignPackageToMemberSchema = z.object({
  studioId: z.string().uuid(),
  memberId: z.string().uuid(),
  packageDefinitionId: z.string().uuid(),
  startDate: z.string().datetime().optional(),
  paymentMethod: z.nativeEnum(PaymentMethod),
  paidAmount: z.number().nonnegative(),
  notes: z.string().optional(),
});
export type AssignPackageToMemberInput = z.infer<typeof AssignPackageToMemberSchema>;

export const FreezePackageSchema = z.object({
  studioId: z.string().uuid(),
  days: z.number().int().positive(),
  reason: z.string().max(500).optional(),
});
export type FreezePackageInput = z.infer<typeof FreezePackageSchema>;

export const CreateScheduleSchema = z
  .object({
    studioId: z.string().uuid(),
    branchId: z.string().uuid().optional(),
    serviceTypeId: z.string().uuid(),
    resourceId: z.string().uuid().optional(),
    trainerId: z.string().uuid().optional(),
    title: z.string().trim().min(3, 'Seans başlığı giriniz'),
    startTime: z.string().datetime(),
    endTime: z.string().datetime(),
    capacity: z.number().int().positive().optional(),
    isRecurring: z.boolean().default(false),
    recurringWeeks: z.number().int().min(1).max(12).optional(),
  })
  .refine((v) => new Date(v.endTime) > new Date(v.startTime), {
    path: ['endTime'],
    message: 'Bitiş saati başlangıçtan sonra olmalıdır',
  });
export type CreateScheduleInput = z.infer<typeof CreateScheduleSchema>;

export const BookSessionSchema = z.object({
  studioId: z.string().uuid(),
  scheduleId: z.string().uuid(),
  memberId: z.string().uuid(),
  memberPackageId: z.string().uuid().optional(),
  /** Specific units picked by the member, e.g. "reformer 3". */
  resourceIds: z.array(z.string().uuid()).max(5).default([]),
});
export type BookSessionInput = z.infer<typeof BookSessionSchema>;

export const CancelBookingSchema = z.object({
  bookingId: z.string().uuid(),
  cancelledBy: z.enum(['MEMBER', 'STUDIO']),
  reason: z.string().max(500).optional(),
});
export type CancelBookingInput = z.infer<typeof CancelBookingSchema>;

/** Six digits, not all the same and not a straight ascending/descending run. */
export function isWeakPin(pin: string): boolean {
  if (/^(\d)\1+$/.test(pin)) return true;
  const digits = pin.split('').map(Number);
  const ascending = digits.every((d, i) => i === 0 || d === (digits[i - 1] + 1) % 10);
  const descending = digits.every((d, i) => i === 0 || d === (digits[i - 1] + 9) % 10);
  return ascending || descending;
}

export const PinSchema = z
  .string()
  .regex(/^\d{6}$/, 'PIN 6 haneli bir sayı olmalıdır')
  .refine((pin) => !isWeakPin(pin), 'Bu PIN çok kolay tahmin edilir, başka bir PIN seçin');

export const OtpCodeSchema = z.string().regex(/^\d{6}$/, 'Doğrulama kodu 6 haneli olmalıdır');

export const RequestLoginOtpSchema = z.object({ phone: PhoneSchema });
export type RequestLoginOtpInput = z.infer<typeof RequestLoginOtpSchema>;

export const VerifyLoginOtpSchema = z.object({ phone: PhoneSchema, code: OtpCodeSchema });
export type VerifyLoginOtpInput = z.infer<typeof VerifyLoginOtpSchema>;

export const PinLoginSchema = z.object({ phone: PhoneSchema, pin: z.string().regex(/^\d{6}$/) });
export type PinLoginInput = z.infer<typeof PinLoginSchema>;

export const SetPinSchema = z.object({ pin: PinSchema });
export type SetPinInput = z.infer<typeof SetPinSchema>;

export const AcceptInviteSchema = z.object({
  code: OtpCodeSchema,
  /** Required when the user has no PIN yet. */
  pin: PinSchema.optional(),
  acceptedDocumentVersionIds: z.array(z.string().uuid()).max(10),
  device: z.string().max(200).optional(),
});
export type AcceptInviteInput = z.infer<typeof AcceptInviteSchema>;

// ---------------------------------------------------------------------------
// Catalog: resource types, resources, service types, cancellation policies
// ---------------------------------------------------------------------------

export const CreateResourceTypeSchema = z.object({
  studioId: z.string().uuid(),
  name: z.string().trim().min(2, 'Kaynak türü adı en az 2 karakter olmalıdır'),
  selectableByMember: z.boolean().default(false),
});
export type CreateResourceTypeInput = z.infer<typeof CreateResourceTypeSchema>;

export const UpdateResourceTypeSchema = z.object({
  studioId: z.string().uuid(),
  name: z.string().trim().min(2).optional(),
  selectableByMember: z.boolean().optional(),
});
export type UpdateResourceTypeInput = z.infer<typeof UpdateResourceTypeSchema>;

export const CreateResourceSchema = z.object({
  studioId: z.string().uuid(),
  branchId: z.string().uuid().optional(),
  resourceTypeId: z.string().uuid(),
  parentResourceId: z.string().uuid().optional(),
  name: z.string().trim().min(1, 'Kaynak adı zorunludur'),
  capacity: z.number().int().positive().default(1),
  serialNumber: z.string().max(100).optional(),
});
export type CreateResourceInput = z.infer<typeof CreateResourceSchema>;

export const UpdateResourceSchema = z.object({
  studioId: z.string().uuid(),
  branchId: z.string().uuid().nullable().optional(),
  resourceTypeId: z.string().uuid().optional(),
  parentResourceId: z.string().uuid().nullable().optional(),
  name: z.string().trim().min(1).optional(),
  capacity: z.number().int().positive().optional(),
  serialNumber: z.string().max(100).nullable().optional(),
  isMaintenance: z.boolean().optional(),
});
export type UpdateResourceInput = z.infer<typeof UpdateResourceSchema>;

export const CreateCancellationPolicySchema = z.object({
  studioId: z.string().uuid(),
  name: z.string().trim().min(2, 'Politika adı en az 2 karakter olmalıdır'),
  freeCancelHours: z.number().int().nonnegative(),
  lateCancelChargeUnits: z.number().int().nonnegative().default(1),
  noShowChargeUnits: z.number().int().nonnegative().default(1),
  isDefault: z.boolean().default(false),
});
export type CreateCancellationPolicyInput = z.infer<typeof CreateCancellationPolicySchema>;

export const UpdateCancellationPolicySchema = z.object({
  studioId: z.string().uuid(),
  name: z.string().trim().min(2).optional(),
  freeCancelHours: z.number().int().nonnegative().optional(),
  lateCancelChargeUnits: z.number().int().nonnegative().optional(),
  noShowChargeUnits: z.number().int().nonnegative().optional(),
  isDefault: z.boolean().optional(),
});
export type UpdateCancellationPolicyInput = z.infer<typeof UpdateCancellationPolicySchema>;

export const CreateServiceTypeSchema = z.object({
  studioId: z.string().uuid(),
  name: z.string().trim().min(2, 'Hizmet adı en az 2 karakter olmalıdır'),
  description: z.string().max(2000).optional(),
  durationMin: z.number().int().positive('Süre 0 dan büyük olmalıdır'),
  capacity: z.number().int().positive().default(1),
  minRepeatIntervalDays: z.number().int().positive().optional(),
  prerequisiteFormId: z.string().uuid().optional(),
  allowedEntitlementKinds: z.array(z.nativeEnum(EntitlementKind)).min(1, 'En az bir hak türü seçilmelidir'),
  cancellationPolicyId: z.string().uuid().optional(),
  commissionRuleId: z.string().uuid().optional(),
  requiresQualification: z.boolean().default(false),
  requiredResourceTypes: z
    .array(z.object({ resourceTypeId: z.string().uuid(), quantity: z.number().int().positive().default(1) }))
    .default([]),
});
export type CreateServiceTypeInput = z.infer<typeof CreateServiceTypeSchema>;

export const UpdateServiceTypeSchema = z.object({
  studioId: z.string().uuid(),
  name: z.string().trim().min(2).optional(),
  description: z.string().max(2000).nullable().optional(),
  durationMin: z.number().int().positive().optional(),
  capacity: z.number().int().positive().optional(),
  minRepeatIntervalDays: z.number().int().positive().nullable().optional(),
  prerequisiteFormId: z.string().uuid().nullable().optional(),
  allowedEntitlementKinds: z.array(z.nativeEnum(EntitlementKind)).min(1).optional(),
  cancellationPolicyId: z.string().uuid().nullable().optional(),
  commissionRuleId: z.string().uuid().nullable().optional(),
  requiresQualification: z.boolean().optional(),
  requiredResourceTypes: z
    .array(z.object({ resourceTypeId: z.string().uuid(), quantity: z.number().int().positive().default(1) }))
    .optional(),
});
export type UpdateServiceTypeInput = z.infer<typeof UpdateServiceTypeSchema>;

export const ServiceTypeQualificationSchema = z.object({
  studioId: z.string().uuid(),
  trainerProfileId: z.string().uuid(),
});
export type ServiceTypeQualificationInput = z.infer<typeof ServiceTypeQualificationSchema>;

export const DeactivateCatalogItemSchema = z.object({
  studioId: z.string().uuid(),
});
export type DeactivateCatalogItemInput = z.infer<typeof DeactivateCatalogItemSchema>;

/** Referenced here only so catalog validators stay consistent with CommissionRule.type. */
export const CommissionTypeSchema = z.nativeEnum(CommissionType);

// ---------------------------------------------------------------------------
// Whole-session cancellation
// ---------------------------------------------------------------------------

export const CancelSessionSchema = z.object({
  reason: z.string().max(500).optional(),
  notifyMembers: z.boolean().default(true),
});
export type CancelSessionInput = z.infer<typeof CancelSessionSchema>;
