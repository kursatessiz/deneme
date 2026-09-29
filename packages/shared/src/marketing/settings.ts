import { z } from 'zod';
import { CurrencyCodeSchema } from '../growth/regions';
import { SegmentGroupSchema, type SegmentGroup } from '../growth/segments';
import { DEFAULT_DOUBLE_OPT_IN_REGIONS, DoubleOptInRegionsSchema } from './consent';

/**
 * Marketing settings of the platform tenant (M3b, docs/PAZARLAMA_MODULU.md
 * 6.2, 7.4), edited by the super admin at /admin/pazarlama-ayarlari. In
 * M3b only the approval fields (self-approval thresholds and the request
 * TTL) have behaviour; caps, auto-pause thresholds, MQL/SQL rules and the
 * weekly summary are stored for M3a/M3d. M3e adds the consent policy: the
 * regions whose form consents need double opt-in and the TR merchant
 * exemption switch.
 */

export const MARKETING_SETTINGS_DEFAULTS = {
  selfApproveEmailMax: 1000,
  selfApproveSmsMax: 100,
  selfApproveSmsCredits: 100,
  requireApprovalForSocial: false,
  dailyEmailCap: null,
  dailySmsCreditCap: null,
  monthlyAdSpendCaps: {},
  aiDailyCapCents: null,
  bounceAutoPausePct: 2,
  complaintAutoPausePct: 0.08,
  mqlRule: null,
  sqlRule: null,
  weeklySummaryEnabled: false,
  weeklySummaryRecipients: [],
  approvalTtlHours: 72,
  doubleOptInRegions: DEFAULT_DOUBLE_OPT_IN_REGIONS,
  trMerchantExemptionEnabled: false,
} as const;

export interface MarketingSettingsDTO {
  selfApproveEmailMax: number;
  selfApproveSmsMax: number;
  selfApproveSmsCredits: number;
  requireApprovalForSocial: boolean;
  dailyEmailCap: number | null;
  dailySmsCreditCap: number | null;
  /** ISO 4217 currency -> decimal string; currencies are never summed together. */
  monthlyAdSpendCaps: Record<string, string>;
  aiDailyCapCents: number | null;
  /** Percent, e.g. 2 means 2 %. */
  bounceAutoPausePct: number;
  complaintAutoPausePct: number;
  mqlRule: SegmentGroup | null;
  sqlRule: SegmentGroup | null;
  weeklySummaryEnabled: boolean;
  weeklySummaryRecipients: string[];
  approvalTtlHours: number;
  /** Compliance region codes (EU, UK, ...) or ISO countries whose form consents need double opt-in. */
  doubleOptInRegions: string[];
  /** TR merchant exemption: business contacts may be messaged without prior consent (registered with the registry). */
  trMerchantExemptionEnabled: boolean;
  updatedByUserId: string | null;
  /** Null while the defaults are in use (no row yet). */
  updatedAt: string | null;
}

/** A positive money amount with at most two decimals, as text (never a float). */
export const MoneyAmountSchema = z.string().trim().regex(/^\d{1,12}(\.\d{1,2})?$/, 'Geçersiz tutar');

const count = (max: number) => z.number().int().min(0).max(max);
const percent = z.number().min(0).max(100);

export const UpdateMarketingSettingsSchema = z
  .object({
    selfApproveEmailMax: count(10_000_000).optional(),
    selfApproveSmsMax: count(10_000_000).optional(),
    selfApproveSmsCredits: count(100_000_000).optional(),
    requireApprovalForSocial: z.boolean().optional(),
    dailyEmailCap: count(100_000_000).nullable().optional(),
    dailySmsCreditCap: count(100_000_000).nullable().optional(),
    monthlyAdSpendCaps: z
      .record(CurrencyCodeSchema, MoneyAmountSchema)
      .refine((v) => Object.keys(v).length <= 20, { message: 'En fazla 20 para birimi' })
      .optional(),
    aiDailyCapCents: count(100_000_000).nullable().optional(),
    bounceAutoPausePct: percent.optional(),
    complaintAutoPausePct: percent.optional(),
    mqlRule: SegmentGroupSchema.nullable().optional(),
    sqlRule: SegmentGroupSchema.nullable().optional(),
    weeklySummaryEnabled: z.boolean().optional(),
    weeklySummaryRecipients: z.array(z.string().uuid()).max(20).optional(),
    approvalTtlHours: z.number().int().min(1).max(24 * 30).optional(),
    doubleOptInRegions: DoubleOptInRegionsSchema.optional(),
    trMerchantExemptionEnabled: z.boolean().optional(),
  })
  .strict();
export type UpdateMarketingSettingsInput = z.infer<typeof UpdateMarketingSettingsSchema>;

/** A platform-level account that can receive the weekly summary (settings screen picker). */
export interface MarketingSettingsRecipientDTO {
  userId: string;
  name: string;
  isSuperAdmin: boolean;
}

export interface MarketingSettingsViewDTO {
  settings: MarketingSettingsDTO;
  recipients: MarketingSettingsRecipientDTO[];
}
