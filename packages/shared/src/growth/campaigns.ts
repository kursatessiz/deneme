import { z } from 'zod';
import { MESSAGE_CHANNELS_V2 } from './journeys';
import type { MessageChannelV2 } from './journeys';
import { CampaignAbTestSchema, CampaignTemplateKeySchema, CampaignVariantsSchema } from './campaign-ab';
import type { CampaignAbPhase, CampaignAbTestInput, CampaignVariantDTO } from './campaign-ab';
import { CAMPAIGN_SEND_TIME_MODES, LOCAL_TIME_PATTERN } from './send-time';
import type { CampaignSendTimeMode } from './send-time';

/**
 * Campaigns (G2a, docs/KAMPANYA_VE_AKISLAR.md): a one-off commercial
 * broadcast of one message template to one segment. Every message goes
 * through the messaging engine, so consent, opt-out, quiet hours and the
 * per-contact frequency cap always apply. Each contact is sent at most once
 * per campaign (CampaignRecipient is unique per campaign and contact, and
 * the engine's idempotency key is derived from it).
 */

/**
 * PENDING_APPROVAL and PAUSED (M3b, docs/PAZARLAMA_MODULU.md 6.1) are only
 * reached by the platform tenant, whose sends need an approval; other
 * tenants move DRAFT -> SCHEDULED -> SENDING -> SENT as before.
 */
export const CAMPAIGN_STATUSES = ['DRAFT', 'SCHEDULED', 'SENDING', 'SENT', 'CANCELLED', 'PENDING_APPROVAL', 'PAUSED'] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const CAMPAIGN_RECIPIENT_STATUSES = ['PENDING', 'SENT', 'SKIPPED', 'FAILED', 'CANCELLED'] as const;
export type CampaignRecipientStatus = (typeof CAMPAIGN_RECIPIENT_STATUSES)[number];

/** Recipients materialised and sent per batch job. */
export const CAMPAIGN_BATCH_SIZE = 200;
/** A recipient held back by quiet hours is retried for this long, then skipped. */
export const CAMPAIGN_QUIET_HOURS_MAX_DEFER_HOURS = 48;

const TemplateKeySchema = CampaignTemplateKeySchema;

const SendTimeLocalSchema = z.string().regex(LOCAL_TIME_PATTERN, 'Saat SS:dd biçiminde olmalı');

export const CreateCampaignSchema = z
  .object({
    name: z.string().trim().min(1, 'Ad giriniz').max(120),
    segmentId: z.string().uuid(),
    /** Omitted: the tenant's channel order. */
    channel: z.enum(MESSAGE_CHANNELS_V2).optional(),
    templateKey: TemplateKeySchema,
    /** M3c: A/B test (needs `variants`). */
    abTest: CampaignAbTestSchema.nullable().optional(),
    variants: CampaignVariantsSchema.optional(),
    /** M3c: when each recipient's message goes out. */
    sendTimeMode: z.enum(CAMPAIGN_SEND_TIME_MODES).optional(),
    sendTimeLocal: SendTimeLocalSchema.nullable().optional(),
  })
  .strict();
export type CreateCampaignInput = z.infer<typeof CreateCampaignSchema>;

export const UpdateCampaignSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    segmentId: z.string().uuid().optional(),
    channel: z.enum(MESSAGE_CHANNELS_V2).nullable().optional(),
    templateKey: TemplateKeySchema.optional(),
    /** M3c: null removes the test and its variants; a value needs `variants` (or the stored ones). */
    abTest: CampaignAbTestSchema.nullable().optional(),
    variants: CampaignVariantsSchema.optional(),
    sendTimeMode: z.enum(CAMPAIGN_SEND_TIME_MODES).optional(),
    sendTimeLocal: SendTimeLocalSchema.nullable().optional(),
  })
  .strict();
export type UpdateCampaignInput = z.infer<typeof UpdateCampaignSchema>;

export const ScheduleCampaignSchema = z
  .object({
    /** Omitted: send now (the next batch job picks it up). */
    scheduledAt: z.string().datetime().optional(),
  })
  .strict();
export type ScheduleCampaignInput = z.infer<typeof ScheduleCampaignSchema>;

export const CampaignRecipientsQuerySchema = z
  .object({
    status: z.enum(CAMPAIGN_RECIPIENT_STATUSES).optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();
export type CampaignRecipientsQuery = z.infer<typeof CampaignRecipientsQuerySchema>;

export interface CampaignStatsDTO {
  audience: number;
  pending: number;
  sent: number;
  skipped: number;
  failed: number;
  delivered: number;
  opened: number;
  clicked: number;
  unsubscribed: number;
  /** Recipients with a conversion event after their message, inside the attribution window. */
  converted: number;
  /** Purchase and subscription value of those conversions, per ISO 4217 currency. */
  revenue: Record<string, string>;
  /** Skip reasons (messaging engine reason codes) with counts. */
  skippedByReason: Record<string, number>;
  /** M3d: recipients held back until the next UTC day because a daily send cap was reached. */
  deferredByCap: number;
  /** M3d: when the earliest of them is due again. */
  deferredUntil: string | null;
}

export interface CampaignDTO {
  id: string;
  name: string;
  segmentId: string;
  segmentName: string | null;
  channel: MessageChannelV2 | null;
  templateKey: string;
  status: CampaignStatus;
  scheduledAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  /** M3b: the approval request the campaign depends on (platform tenant only). */
  approvalRequestId: string | null;
  /** M3c */
  abTest: CampaignAbTestInput | null;
  abPhase: CampaignAbPhase | null;
  variants: CampaignVariantDTO[];
  winnerKey: string | null;
  sendTimeMode: CampaignSendTimeMode;
  sendTimeLocal: string | null;
  /** M3d: why a PAUSED campaign was paused by the system (AUTO_BOUNCE, AUTO_COMPLAINT); null for a manual pause. */
  pauseReason: string | null;
  createdAt: string;
  updatedAt: string;
  stats: CampaignStatsDTO;
}

export interface CampaignRecipientDTO {
  id: string;
  contactId: string;
  fullName: string;
  status: CampaignRecipientStatus;
  reasonCode: string | null;
  channel: MessageChannelV2 | null;
  sentAt: string | null;
  /** M3c: the A/B variant this recipient gets (null: no test, or still held back). */
  variantKey: string | null;
  /** M3c: when the message is due for a recipient scheduled on their own clock. */
  dueAt: string | null;
}

export interface CampaignTestSendResultDTO {
  success: boolean;
  channel: MessageChannelV2 | null;
  reasonCode: string | null;
}
