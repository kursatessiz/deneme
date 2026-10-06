import { z } from 'zod';
import { vmsg } from './validation-key';

/**
 * Check-in kiosk and QR (W17): schemas shared by the API and the mobile app.
 * No turnstile/door integration -- these only mark a Booking ATTENDED.
 */

// ---------------------------------------------------------------------------
// Static branch/studio QR point (member scans a poster)
// ---------------------------------------------------------------------------

export const CreateCheckInPointSchema = z.object({
  branchId: z.string().uuid(),
  name: z.string().trim().min(2, vmsg('validation.pointNameLeast2Characters')).max(100),
});
export type CreateCheckInPointInput = z.infer<typeof CreateCheckInPointSchema>;

/** Opaque point token pasted into a URL/QR; validated loosely, checked against a stored hash. */
export const CheckInPointTokenSchema = z
  .string()
  .trim()
  .min(32, vmsg('validation.invalidQrCode'))
  .max(200, vmsg('validation.invalidQrCode'));

export const ScanCheckInPointSchema = z.object({
  token: CheckInPointTokenSchema,
});
export type ScanCheckInPointInput = z.infer<typeof ScanCheckInPointSchema>;

// ---------------------------------------------------------------------------
// Dynamic member QR (staff/reception or kiosk scans it)
// ---------------------------------------------------------------------------

/** Signed, short-lived token; opaque to callers, verified server-side only. */
export const DynamicQrTokenSchema = z.string().trim().min(20, vmsg('validation.invalidQrCode')).max(2000, vmsg('validation.invalidQrCode'));

export const StaffCheckInMemberQrSchema = z.object({
  token: DynamicQrTokenSchema,
  /** Disambiguates when the member has more than one checkin-eligible booking today. */
  scheduleId: z.string().uuid().optional(),
});
export type StaffCheckInMemberQrInput = z.infer<typeof StaffCheckInMemberQrSchema>;

export const KioskCheckInSchema = z.object({
  token: DynamicQrTokenSchema,
  scheduleId: z.string().uuid().optional(),
});
export type KioskCheckInInput = z.infer<typeof KioskCheckInSchema>;

// ---------------------------------------------------------------------------
// Kiosk pairing
// ---------------------------------------------------------------------------

export const CreateKioskDeviceSchema = z.object({
  branchId: z.string().uuid(),
  name: z.string().trim().min(2, vmsg('validation.deviceNameLeast2Characters')).max(100),
});
export type CreateKioskDeviceInput = z.infer<typeof CreateKioskDeviceSchema>;

/** Human-typed on the tablet: short, upper-case, unambiguous alphabet. */
export const PairingCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-HJ-NP-Z2-9]{8}$/, vmsg('validation.pairingCode8Characters'));

export const PairKioskDeviceSchema = z.object({
  pairingCode: PairingCodeSchema,
});
export type PairKioskDeviceInput = z.infer<typeof PairKioskDeviceSchema>;

// ---------------------------------------------------------------------------
// Studio check-in window setting
// ---------------------------------------------------------------------------

export const UpdateCheckInWindowSchema = z.object({
  beforeMinutes: z.number().int().min(0).max(180),
  afterMinutes: z.number().int().min(0).max(180),
});
export type UpdateCheckInWindowInput = z.infer<typeof UpdateCheckInWindowSchema>;
