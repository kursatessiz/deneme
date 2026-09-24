import { z } from 'zod';
import { CommissionType, EntitlementKind, InviteChannel, LeadSource, LeadStage, PaymentMethod } from './enums';
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

export const ChangeSpotSchema = z.object({
  /** The new set of resources held by this booking; replaces the previous set. */
  resourceIds: z.array(z.string().uuid()).min(1, 'En az bir yer seçilmelidir').max(5),
});
export type ChangeSpotInput = z.infer<typeof ChangeSpotSchema>;

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
  /** Grid coordinates for a spot map; both required together, optional overall. */
  layoutX: z.number().int().optional(),
  layoutY: z.number().int().optional(),
  /** Short visible label on a spot map, e.g. "3" or "Kort 2". */
  label: z.string().trim().max(40).optional(),
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
  layoutX: z.number().int().nullable().optional(),
  layoutY: z.number().int().nullable().optional(),
  label: z.string().trim().max(40).nullable().optional(),
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

// ---------------------------------------------------------------------------
// Branches
// ---------------------------------------------------------------------------

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();

export const CreateBranchSchema = z.object({
  studioId: z.string().uuid(),
  name: z.string().trim().min(2, 'Şube adı giriniz').max(100),
  address: optionalText(500),
  phone: optionalText(30),
  email: z.string().trim().email('Geçerli bir e-posta giriniz').max(120).nullable().optional(),
  timezone: optionalText(60),
  sortOrder: z.number().int().min(0).max(999).default(0),
});
export type CreateBranchInput = z.infer<typeof CreateBranchSchema>;

export const UpdateBranchSchema = CreateBranchSchema.omit({ studioId: true })
  .partial()
  .extend({ isActive: z.boolean().optional() });
export type UpdateBranchInput = z.infer<typeof UpdateBranchSchema>;

/** Empty list means the staff member may act on every branch. */
export const SetStaffBranchesSchema = z.object({
  branchIds: z.array(z.string().uuid()).max(100),
});
export type SetStaffBranchesInput = z.infer<typeof SetStaffBranchesSchema>;

export const SetHomeBranchSchema = z.object({
  branchId: z.string().uuid().nullable(),
});
export type SetHomeBranchInput = z.infer<typeof SetHomeBranchSchema>;

/** Reporting window; defaults to the last 30 days, at most one year. */
export const ReportRangeSchema = z
  .object({
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  })
  .transform(({ from, to }) => {
    const end = to ?? new Date();
    const start = from ?? new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
    return { from: start, to: end };
  })
  .refine((r) => r.from < r.to, { message: 'Başlangıç tarihi bitişten önce olmalıdır', path: ['from'] })
  .refine((r) => r.to.getTime() - r.from.getTime() <= 366 * 24 * 60 * 60 * 1000, {
    message: 'Rapor aralığı en fazla bir yıl olabilir',
    path: ['to'],
  });
export type ReportRange = z.infer<typeof ReportRangeSchema>;

// ---------------------------------------------------------------------------
// Leads (W11)
// ---------------------------------------------------------------------------

export const CreateLeadSchema = z.object({
  studioId: z.string().uuid(),
  branchId: z.string().uuid().optional(),
  fullName: z.string().trim().min(2, 'Ad soyad giriniz').max(150),
  phone: PhoneSchema,
  email: z.string().trim().email('Geçersiz e-posta formatı').max(120).optional().or(z.literal('')),
  source: z.nativeEnum(LeadSource).default(LeadSource.OTHER),
  sourceDetail: z.string().trim().max(200).optional(),
  interestServiceTypeId: z.string().uuid().optional(),
  ownerMembershipId: z.string().uuid().optional(),
  nextFollowUpAt: z.string().datetime().optional(),
  utmSource: z.string().trim().max(100).optional(),
  utmMedium: z.string().trim().max(100).optional(),
  utmCampaign: z.string().trim().max(100).optional(),
  notes: z.string().trim().max(2000).optional(),
});
export type CreateLeadInput = z.infer<typeof CreateLeadSchema>;

export const UpdateLeadSchema = CreateLeadSchema.omit({ studioId: true, phone: true })
  .partial()
  .extend({ phone: PhoneSchema.optional() });
export type UpdateLeadInput = z.infer<typeof UpdateLeadSchema>;

export const LeadListQuerySchema = z.object({
  stage: z.nativeEnum(LeadStage).optional(),
  source: z.nativeEnum(LeadSource).optional(),
  ownerMembershipId: z.string().uuid().optional(),
  branchId: z.string().uuid().optional(),
  search: z.string().trim().max(150).optional(),
  overdue: z.coerce.boolean().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type LeadListQuery = z.infer<typeof LeadListQuerySchema>;

export const ChangeLeadStageSchema = z
  .object({
    stage: z.nativeEnum(LeadStage),
    lostReason: z.string().trim().max(500).optional(),
  })
  .refine((v) => v.stage !== LeadStage.LOST || Boolean(v.lostReason), {
    message: 'Kayıp nedeni giriniz',
    path: ['lostReason'],
  });
export type ChangeLeadStageInput = z.infer<typeof ChangeLeadStageSchema>;

export const AssignLeadOwnerSchema = z.object({
  ownerMembershipId: z.string().uuid().nullable(),
});
export type AssignLeadOwnerInput = z.infer<typeof AssignLeadOwnerSchema>;

export const AddLeadActivitySchema = z.object({
  type: z.enum(['NOTE', 'CALL', 'MESSAGE']),
  body: z.string().trim().min(1, 'Not giriniz').max(2000),
});
export type AddLeadActivityInput = z.infer<typeof AddLeadActivitySchema>;

export const ConvertLeadSchema = z.object({
  birthDate: z.string().optional(),
  emergencyContactName: z.string().trim().max(150).optional(),
  emergencyContactPhone: z.string().trim().max(30).optional(),
  notes: z.string().trim().max(2000).optional(),
});
export type ConvertLeadInput = z.infer<typeof ConvertLeadSchema>;

export const BookLeadTrialSchema = z.object({
  scheduleId: z.string().uuid(),
});
export type BookLeadTrialInput = z.infer<typeof BookLeadTrialSchema>;

/** Public, unauthenticated web-form submission (POST /public/studios/:slug/leads). */
export const PublicLeadFormSchema = z.object({
  fullName: z.string().trim().min(2, 'Ad soyad giriniz').max(150),
  phone: PhoneSchema,
  email: z.string().trim().email('Geçersiz e-posta formatı').max(120).optional().or(z.literal('')),
  interest: z.string().trim().max(200).optional(),
  consent: z.literal(true, { errorMap: () => ({ message: 'İletişim izni gereklidir' }) }),
  /**
   * Honeypot: a hidden field real visitors never fill in. Deliberately not
   * constrained to be empty here -- rejecting it at validation would answer
   * a bot with a 400 instead of the same constant 202 as a real submission,
   * which would tell it the field was noticed. The service checks it and
   * silently drops the submission instead.
   */
  website: z.string().max(500).optional().default(''),
});
export type PublicLeadFormInput = z.infer<typeof PublicLeadFormSchema>;
