import { z } from 'zod';

/**
 * W20 aggregator/marketplace partner integrations (ClassPass, Urban Sports
 * Club, Wellhub/Gympass and local Turkish equivalents). Real contracts and
 * credentials are not available yet, so every provider except MOCK is a
 * placeholder adapter until a studio signs with that partner; see
 * docs/PARTNERS.md for what the owner needs to provide to go live.
 */

export const PARTNER_PROVIDERS = ['MOCK', 'CLASSPASS', 'URBAN_SPORTS', 'WELLHUB', 'OTHER'] as const;
export type PartnerProviderName = (typeof PARTNER_PROVIDERS)[number];

export const PARTNER_CONNECTION_STATUSES = ['ACTIVE', 'PAUSED', 'DISABLED'] as const;
export type PartnerConnectionStatusName = (typeof PARTNER_CONNECTION_STATUSES)[number];

/** Decimal amounts are always passed as strings; never parsed as JS numbers. */
const decimalString = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,2})?$/, 'Tutar 0.00 formatında bir metin olmalıdır');

/**
 * Stored on PartnerConnection.config (plain Json, never secret): which
 * service types and branches the partner may book into, how many spots per
 * session it may take, the payout owed per attended visit, and how long
 * before a session its unused spots are released back to the general pool.
 */
export const PartnerConnectionConfigSchema = z
  .object({
    serviceTypeIds: z.array(z.string().uuid()).default([]),
    branchIds: z.array(z.string().uuid()).default([]),
    spotsPerSession: z.number().int().min(1).max(100).default(1),
    payoutRatePerVisit: decimalString.default('0.00'),
    releaseHoursBeforeStart: z.number().int().min(0).max(168).default(24),
    /// When true, a partner cancellation never counts as a late cancellation
    /// against the guest under the studio's own policy: the partner's own
    /// cancellation terms apply instead (see docs/PARTNERS.md).
    followsPartnerCancellationPolicy: z.boolean().default(true),
  })
  .strict();
export type PartnerConnectionConfig = z.infer<typeof PartnerConnectionConfigSchema>;

export const DEFAULT_PARTNER_CONNECTION_CONFIG: PartnerConnectionConfig = {
  serviceTypeIds: [],
  branchIds: [],
  spotsPerSession: 1,
  payoutRatePerVisit: '0.00',
  releaseHoursBeforeStart: 24,
  followsPartnerCancellationPolicy: true,
};

export function parsePartnerConnectionConfig(raw: unknown): PartnerConnectionConfig {
  const result = PartnerConnectionConfigSchema.safeParse(raw);
  return result.success ? result.data : DEFAULT_PARTNER_CONNECTION_CONFIG;
}

/** Credentials entered by the owner, never returned by any endpoint once stored (write-only). */
export const PartnerConnectionCredentialsSchema = z
  .object({
    apiKey: z.string().trim().min(1).max(500).optional(),
    apiSecret: z.string().trim().min(1).max(500).optional(),
    webhookSecret: z.string().trim().min(1).max(500),
    partnerAccountId: z.string().trim().min(1).max(200).optional(),
  })
  .strict();
export type PartnerConnectionCredentials = z.infer<typeof PartnerConnectionCredentialsSchema>;

export const CreatePartnerConnectionSchema = z
  .object({
    provider: z.enum(PARTNER_PROVIDERS),
    label: z.string().trim().min(1).max(80),
    credentials: PartnerConnectionCredentialsSchema,
    config: PartnerConnectionConfigSchema.partial().optional(),
  })
  .strict();
export type CreatePartnerConnectionInput = z.infer<typeof CreatePartnerConnectionSchema>;

export const UpdatePartnerConnectionSchema = z
  .object({
    label: z.string().trim().min(1).max(80).optional(),
    status: z.enum(PARTNER_CONNECTION_STATUSES).optional(),
    credentials: PartnerConnectionCredentialsSchema.optional(),
    config: PartnerConnectionConfigSchema.partial().optional(),
  })
  .strict();
export type UpdatePartnerConnectionInput = z.infer<typeof UpdatePartnerConnectionSchema>;

// ---------------------------------------------------------------------------
// Inbound webhook payload (partner reservation events)
// ---------------------------------------------------------------------------

export const PARTNER_WEBHOOK_EVENT_TYPES = [
  'RESERVATION_CREATED',
  'RESERVATION_CANCELLED',
  'CHECK_IN',
] as const;
export type PartnerWebhookEventType = (typeof PARTNER_WEBHOOK_EVENT_TYPES)[number];

export const PartnerWebhookPayloadSchema = z
  .object({
    eventId: z.string().trim().min(1).max(120),
    eventType: z.enum(PARTNER_WEBHOOK_EVENT_TYPES),
    timestamp: z.string().datetime(),
    externalReservationId: z.string().trim().min(1).max(120),
    scheduleExternalId: z.string().trim().min(1).max(120).optional(),
    scheduleId: z.string().uuid().optional(),
    guest: z
      .object({
        phone: z.string().trim().max(20).optional(),
        fullName: z.string().trim().min(1).max(120),
        externalGuestId: z.string().trim().max(120).optional(),
      })
      .strict()
      .optional(),
    /// Present only on RESERVATION_CANCELLED; true when the partner's own
    /// policy exempts the guest from the studio's late-cancellation penalty.
    cancelledWithinPartnerPolicy: z.boolean().optional(),
  })
  .strict();
export type PartnerWebhookPayload = z.infer<typeof PartnerWebhookPayloadSchema>;

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export interface PartnerVisitsReportRow {
  provider: PartnerProviderName;
  connectionLabel: string;
  month: string;
  visits: number;
  noShows: number;
  /** Decimal string: attended visits * payoutRatePerVisit. */
  expectedPayout: string;
}

export const PartnerReportRangeSchema = z
  .object({
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    format: z.enum(['json', 'csv']).default('json'),
  })
  .strict();
export type PartnerReportRange = z.infer<typeof PartnerReportRangeSchema>;
