import { z } from 'zod';
import { EntitlementKind, InviteChannel, PaymentMethod } from './enums';
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
  /** Staff only: return every unit even for a late cancellation. Ignored on self-service. */
  waivePenalty: z.boolean().default(false),
});
export type CancelBookingInput = z.infer<typeof CancelBookingSchema>;

export const MarkNoShowSchema = z.object({
  /** Staff override: keep no units for this no-show. */
  waivePenalty: z.boolean().default(false),
});
export type MarkNoShowInput = z.infer<typeof MarkNoShowSchema>;

export const JoinWaitlistSchema = z.object({
  studioId: z.string().uuid(),
  scheduleId: z.string().uuid(),
  memberId: z.string().uuid(),
  /** Package charged automatically when a seat opens. */
  memberPackageId: z.string().uuid().optional(),
});
export type JoinWaitlistInput = z.infer<typeof JoinWaitlistSchema>;

export const LeaveWaitlistSchema = z.object({
  waitlistId: z.string().uuid(),
});
export type LeaveWaitlistInput = z.infer<typeof LeaveWaitlistSchema>;

export const SubstituteTrainerSchema = z.object({
  trainerId: z.string().uuid(),
  reason: z.string().trim().max(500).optional(),
  /** Tell booked members about the change. */
  notifyMembers: z.boolean().default(true),
});
export type SubstituteTrainerInput = z.infer<typeof SubstituteTrainerSchema>;

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
