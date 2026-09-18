import { z } from 'zod';
import { UserRole, SessionType, BookingStatus, PaymentMethod, CommissionType } from './enums';

export const LoginSchema = z.object({
  emailOrPhone: z.string().min(3, 'Geçerli bir e-posta veya telefon giriniz'),
  password: z.string().min(6, 'Şifre en az 6 karakter olmalıdır'),
});
export type LoginInput = z.infer<typeof LoginSchema>;

export const CreateMemberSchema = z.object({
  studioId: z.string().uuid(),
  firstName: z.string().min(2, 'Ad en az 2 karakter olmalıdır'),
  lastName: z.string().min(2, 'Soyad en az 2 karakter olmalıdır'),
  phone: z.string().min(10, 'Geçerli bir telefon numarası giriniz (örn: 05xxxxxxxxx)'),
  email: z.string().email('Geçersiz e-posta formatı').optional().or(z.literal('')),
  birthDate: z.string().optional(),
  emergencyContactName: z.string().optional(),
  emergencyContactPhone: z.string().optional(),
  medicalConditions: z.string().optional(), // Fıtık, skolyoz, operasyon geçmişi
  notes: z.string().optional(),
  hasSignedWaiver: z.boolean().default(false),
});
export type CreateMemberInput = z.infer<typeof CreateMemberSchema>;

export const CreatePackageDefinitionSchema = z.object({
  studioId: z.string().uuid(),
  name: z.string().min(3, 'Paket adı zorunludur'),
  sessionType: z.nativeEnum(SessionType),
  totalSessions: z.number().int().positive('Seans sayısı 0 dan büyük olmalıdır'),
  validityDays: z.number().int().positive('Geçerlilik süresi en az 1 gün olmalıdır'),
  price: z.number().nonnegative('Fiyat 0 veya üzeri olmalıdır'),
  freezeDaysAllowed: z.number().int().nonnegative().default(15),
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

export const CreateScheduleSchema = z.object({
  studioId: z.string().uuid(),
  branchId: z.string().uuid().optional(),
  roomId: z.string().uuid().optional(),
  trainerId: z.string().uuid(),
  sessionType: z.nativeEnum(SessionType),
  title: z.string().min(3, 'Ders başlığı giriniz'),
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
  capacity: z.number().int().positive().default(1),
  isRecurring: z.boolean().default(false),
  recurringWeeks: z.number().int().min(1).max(12).optional(),
});
export type CreateScheduleInput = z.infer<typeof CreateScheduleSchema>;

export const BookSessionSchema = z.object({
  studioId: z.string().uuid(),
  scheduleId: z.string().uuid(),
  memberId: z.string().uuid(),
  memberPackageId: z.string().uuid(),
});
export type BookSessionInput = z.infer<typeof BookSessionSchema>;

export const CancelBookingSchema = z.object({
  bookingId: z.string().uuid(),
  cancelledBy: z.enum(['MEMBER', 'STUDIO']),
  reason: z.string().optional(),
});
export type CancelBookingInput = z.infer<typeof CancelBookingSchema>;
