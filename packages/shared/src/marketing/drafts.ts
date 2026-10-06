import { z } from 'zod';
import { LocaleCodeSchema } from '../i18n/locales';
import { SegmentGroupSchema, type SegmentGroup } from '../growth/segments';
import type { MarketingCheckIssue } from './checks';
import type { CampaignAbMetric, CampaignAbTestInput } from '../growth/campaign-ab';
import { vmsg } from '../validation-key';
import { validationBaseMessage } from '../validation-messages';

/**
 * AI studio drafts (docs/PAZARLAMA_MODULU.md 4.3). Every model output is a
 * MarketingDraft with one or more variants; a draft is editable, has a
 * status (DRAFT, REVIEWED, ARCHIVED) and is never sent or published by the
 * studio. The content of a variant is validated per draft kind.
 */

export const MARKETING_DRAFT_STATUSES = ['DRAFT', 'REVIEWED', 'ARCHIVED'] as const;
export type MarketingDraftStatus = (typeof MARKETING_DRAFT_STATUSES)[number];

/** Kinds the brief generator can write (one model call per kind and language). */
export const GENERATABLE_DRAFT_KINDS = [
  'EMAIL',
  'SMS',
  'WHATSAPP',
  'AD_META',
  'AD_GOOGLE_RSA',
  'AD_LINKEDIN',
  'LANDING_BLOCK',
  'SUBJECT_LINES',
  'CTA_VARIANTS',
  'SEO_OUTLINE',
] as const;
export type GeneratableDraftKind = (typeof GENERATABLE_DRAFT_KINDS)[number];

/** Every kind a MarketingDraft can hold; the last two come from the analysis and research features. */
export const MARKETING_DRAFT_KINDS = [...GENERATABLE_DRAFT_KINDS, 'SEGMENT_SUGGESTION', 'RESEARCH_NOTE'] as const;
export type MarketingDraftKind = (typeof MARKETING_DRAFT_KINDS)[number];

/** Kinds that "Kampanyaya aktar" can turn into a campaign draft. */
export const CAMPAIGN_EXPORTABLE_KINDS = ['EMAIL', 'SMS', 'WHATSAPP'] as const satisfies readonly MarketingDraftKind[];
export type CampaignExportableKind = (typeof CAMPAIGN_EXPORTABLE_KINDS)[number];

/** Placeholders the campaign engine fills at send time; nothing else may appear in braces. */
export const MARKETING_ALLOWED_PLACEHOLDERS = ['firstName', 'studioName'] as const;

/**
 * Stable `code` values the marketing endpoints send next to a Turkish
 * `message` (besides the AI_* codes of the AI core); clients show
 * `t('marketingStudio.error.<code>')`.
 */
export const MARKETING_STUDIO_ERROR_CODES = [
  'BRAND_KIT_REQUIRED',
  'FACT_KEY_EXISTS',
  'SEGMENT_DATA_TOO_SMALL',
  'DRAFT_HAS_BLOCKING_ISSUES',
  'DRAFT_KIND_NOT_EXPORTABLE',
  'DRAFT_KIND_NOT_EDITABLE',
  'DRAFT_ARCHIVED',
  'DRAFT_VARIANT_LIMIT',
  'MARKETING_AI_RATE_LIMITED',
  'CALENDAR_ITEM_LOCKED',
  'CALENDAR_DRAFT_NOT_FOUND',
  'CALENDAR_CAMPAIGN_NOT_FOUND',
  'CALENDAR_OWNER_NOT_FOUND',
] as const;
export type MarketingStudioErrorCode = (typeof MARKETING_STUDIO_ERROR_CODES)[number];

export function isMarketingStudioErrorCode(value: unknown): value is MarketingStudioErrorCode {
  return typeof value === 'string' && (MARKETING_STUDIO_ERROR_CODES as readonly string[]).includes(value);
}

export const MAX_VARIANTS = 5;
export const MAX_GENERATIONS_PER_REQUEST = 12;

// -- content per kind ----------------------------------------------------------

const Text = (max: number) => z.string().trim().max(max);
const NonEmpty = (max: number) => z.string().trim().min(1).max(max);

/** Structural schemas with generous ceilings; the platform limits live in MARKETING_FIELD_LIMITS and are reported as check issues. */
export const EmailContentSchema = z.object({ subject: NonEmpty(300), preheader: Text(300).default(''), body: NonEmpty(10_000) }).strict();
export const SmsContentSchema = z.object({ text: NonEmpty(1_000) }).strict();
export const WhatsappContentSchema = z
  .object({
    /** Suggested Meta template name (snake_case); the approved name is recorded on the message template. */
    templateName: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9_]{2,59}$/, vmsg('validation.templateNameConsistLowercaseLettersDigits')),
    category: z.enum(['MARKETING', 'UTILITY']).default('MARKETING'),
    body: NonEmpty(4_000),
  })
  .strict();
export const AdMetaContentSchema = z.object({ primaryText: NonEmpty(2_200), headline: NonEmpty(200), description: Text(200).default('') }).strict();
export const AdGoogleRsaContentSchema = z
  .object({ headlines: z.array(NonEmpty(100)).min(1).max(15), descriptions: z.array(NonEmpty(300)).min(1).max(4) })
  .strict();
export const AdLinkedinContentSchema = z.object({ introText: NonEmpty(1_000), headline: NonEmpty(300), description: Text(300).default('') }).strict();
export const LandingBlockContentSchema = z
  .object({ heading: NonEmpty(200), subheading: Text(500).default(''), bullets: z.array(NonEmpty(300)).max(8).default([]), ctaLabel: NonEmpty(100) })
  .strict();
export const SubjectLineContentSchema = z.object({ subject: NonEmpty(300), preheader: Text(300).default('') }).strict();
export const CtaContentSchema = z.object({ label: NonEmpty(100) }).strict();
export const SeoOutlineContentSchema = z
  .object({
    title: NonEmpty(200),
    metaDescription: NonEmpty(500),
    headings: z.array(z.object({ level: z.union([z.literal(2), z.literal(3)]), text: NonEmpty(200) }).strict()).min(1).max(30),
    faq: z.array(z.object({ question: NonEmpty(300), answer: NonEmpty(1_000) }).strict()).max(10).default([]),
    internalLinkIdeas: z.array(NonEmpty(200)).max(10).default([]),
  })
  .strict();
export const SegmentSuggestionContentSchema = z
  .object({
    name: NonEmpty(120),
    rationale: NonEmpty(600),
    rules: SegmentGroupSchema,
    /** Number of matching contacts, or null when fewer than MARKETING_MIN_CELL match. */
    approxCount: z.number().int().min(0).nullable(),
  })
  .strict();
export const ResearchSourceSchema = z
  .object({ id: z.string().trim().regex(/^S\d{1,2}$/), title: NonEmpty(200), url: z.string().trim().url().max(500).nullable().default(null) })
  .strict();
export const ResearchNoteContentSchema = z
  .object({
    question: NonEmpty(500),
    summary: NonEmpty(3_000),
    /** Every point cites a pasted source and quotes it verbatim. */
    points: z.array(z.object({ claim: NonEmpty(600), sourceId: z.string().regex(/^S\d{1,2}$/), quote: NonEmpty(600) }).strict()).min(1).max(20),
    sources: z.array(ResearchSourceSchema).min(1).max(6),
    mode: z.literal('CITED_NOTES').default('CITED_NOTES'),
  })
  .strict();

export const MARKETING_CONTENT_SCHEMAS = {
  EMAIL: EmailContentSchema,
  SMS: SmsContentSchema,
  WHATSAPP: WhatsappContentSchema,
  AD_META: AdMetaContentSchema,
  AD_GOOGLE_RSA: AdGoogleRsaContentSchema,
  AD_LINKEDIN: AdLinkedinContentSchema,
  LANDING_BLOCK: LandingBlockContentSchema,
  SUBJECT_LINES: SubjectLineContentSchema,
  CTA_VARIANTS: CtaContentSchema,
  SEO_OUTLINE: SeoOutlineContentSchema,
  SEGMENT_SUGGESTION: SegmentSuggestionContentSchema,
  RESEARCH_NOTE: ResearchNoteContentSchema,
} as const satisfies Record<MarketingDraftKind, z.ZodTypeAny>;

export type EmailContent = z.infer<typeof EmailContentSchema>;
export type SmsContent = z.infer<typeof SmsContentSchema>;
export type WhatsappContent = z.infer<typeof WhatsappContentSchema>;
export type SegmentSuggestionContent = z.infer<typeof SegmentSuggestionContentSchema>;
export type ResearchNoteContent = z.infer<typeof ResearchNoteContentSchema>;
export type MarketingContent = Record<string, unknown>;

/** Validates variant content for a kind; the parsed value has defaults applied. */
export function parseMarketingContent(kind: MarketingDraftKind, raw: unknown): { ok: true; content: MarketingContent } | { ok: false; issues: string[] } {
  const parsed = MARKETING_CONTENT_SCHEMAS[kind].safeParse(raw);
  if (parsed.success) return { ok: true, content: parsed.data as MarketingContent };
  return { ok: false, issues: parsed.error.issues.map((i) => `${i.path.join('.') || 'content'}: ${validationBaseMessage(i.message)}`) };
}

// -- requests --------------------------------------------------------------------

export const MarketingBriefSchema = z
  .object({
    goal: NonEmpty(1_000),
    offer: Text(500).optional(),
    /** Key of an ICP defined in the brand kit. */
    icpKey: z.string().trim().max(40).optional(),
    /** Business sector for the SEO outline and landing blocks. */
    sector: Text(80).optional(),
    notes: Text(1_000).optional(),
  })
  .strict();
export type MarketingBrief = z.infer<typeof MarketingBriefSchema>;

export const GenerateDraftsSchema = z
  .object({
    brief: MarketingBriefSchema,
    locales: z.array(LocaleCodeSchema).min(1).max(4),
    kinds: z.array(z.enum(GENERATABLE_DRAFT_KINDS)).min(1).max(GENERATABLE_DRAFT_KINDS.length),
    variantCount: z.number().int().min(1).max(MAX_VARIANTS).default(3),
  })
  .strict()
  .refine((v) => new Set(v.locales).size === v.locales.length && new Set(v.kinds).size === v.kinds.length, { message: vmsg('validation.duplicateLanguageOrType') })
  .refine((v) => v.locales.length * v.kinds.length <= MAX_GENERATIONS_PER_REQUEST, { message: vmsg('validation.most12GenerationsMadeInOne') });
export type GenerateDraftsInput = z.infer<typeof GenerateDraftsSchema>;

export const AddVariantsSchema = z.object({ count: z.number().int().min(1).max(MAX_VARIANTS).default(3) }).strict();
export type AddVariantsInput = z.infer<typeof AddVariantsSchema>;

export const UpdateDraftSchema = z
  .object({
    title: NonEmpty(160).optional(),
    status: z.enum(MARKETING_DRAFT_STATUSES).optional(),
    notes: Text(2_000).nullable().optional(),
  })
  .strict();
export type UpdateDraftInput = z.infer<typeof UpdateDraftSchema>;

export const UpdateVariantSchema = z.object({ content: z.record(z.string(), z.unknown()) }).strict();
export type UpdateVariantInput = z.infer<typeof UpdateVariantSchema>;

/**
 * A/B setup: stored on the draft; "export to campaign" turns it into the
 * campaign's A/B test and variants (M3c, see abSetupToCampaignAbTest).
 */
export const AB_TEST_METRICS = ['CLICK', 'CONVERSION'] as const;
export const AbTestSetupSchema = z
  .object({
    enabled: z.boolean(),
    /** Share of the audience that receives the test, in percent. */
    testSharePercent: z.number().int().min(5).max(50).default(20),
    metric: z.enum(AB_TEST_METRICS).default('CLICK'),
    waitHours: z.number().int().min(1).max(168).default(24),
    variantIds: z.array(z.string().uuid()).min(2).max(MAX_VARIANTS),
  })
  .strict();
export type AbTestSetupInput = z.infer<typeof AbTestSetupSchema>;

/** Draft metric (CLICK, CONVERSION) to the campaign metric. */
const DRAFT_METRIC_TO_CAMPAIGN: Record<(typeof AB_TEST_METRICS)[number], CampaignAbMetric> = { CLICK: 'CLICK_RATE', CONVERSION: 'CONVERSION' };

/** The campaign A/B setup a draft's stored setup stands for (percent share, hours to minutes). */
export function abSetupToCampaignAbTest(setup: Pick<AbTestSetupInput, 'testSharePercent' | 'metric' | 'waitHours'>): CampaignAbTestInput {
  return { testShare: setup.testSharePercent, metric: DRAFT_METRIC_TO_CAMPAIGN[setup.metric], waitMinutes: setup.waitHours * 60 };
}

export const ExportToCampaignSchema = z
  .object({
    variantId: z.string().uuid(),
    segmentId: z.string().uuid(),
    name: z.string().trim().min(1).max(120).optional(),
    /** Omitted: the stored A/B setup of the draft (when enabled) becomes the campaign's test; false exports the single variant only. */
    withAbTest: z.boolean().optional(),
  })
  .strict();
export type ExportToCampaignInput = z.infer<typeof ExportToCampaignSchema>;

export const SuggestSegmentsSchema = z
  .object({
    goal: NonEmpty(600),
    locale: LocaleCodeSchema.optional(),
    count: z.number().int().min(1).max(5).default(3),
  })
  .strict();
export type SuggestSegmentsInput = z.infer<typeof SuggestSegmentsSchema>;

export const RESEARCH_MAX_SOURCES = 6;
export const RESEARCH_MAX_SOURCE_CHARS = 8_000;
export const RESEARCH_MAX_TOTAL_CHARS = 24_000;

export const ResearchRequestSchema = z
  .object({
    question: NonEmpty(500),
    locale: LocaleCodeSchema.optional(),
    sources: z
      .array(
        z
          .object({
            title: NonEmpty(200),
            url: z.string().trim().url().max(500).optional(),
            text: NonEmpty(RESEARCH_MAX_SOURCE_CHARS),
          })
          .strict(),
      )
      .min(1)
      .max(RESEARCH_MAX_SOURCES),
  })
  .strict()
  .refine((v) => v.sources.reduce((sum, s) => sum + s.text.length, 0) <= RESEARCH_MAX_TOTAL_CHARS, { message: vmsg('validation.sourceTextsAreTooLongIn'), path: ['sources'] });
export type ResearchRequestInput = z.infer<typeof ResearchRequestSchema>;

export const DraftListQuerySchema = z
  .object({
    kind: z.enum(MARKETING_DRAFT_KINDS).optional(),
    status: z.enum(MARKETING_DRAFT_STATUSES).optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(30),
  })
  .strict();
export type DraftListQuery = z.infer<typeof DraftListQuerySchema>;

// -- responses -------------------------------------------------------------------

export interface MarketingDraftVariantDTO {
  id: string;
  key: string;
  position: number;
  content: MarketingContent;
  issues: MarketingCheckIssue[];
  editedAt: string | null;
}

export interface AbTestSetupDTO {
  enabled: boolean;
  testSharePercent: number;
  metric: (typeof AB_TEST_METRICS)[number];
  waitHours: number;
  variantIds: string[];
}

export interface MarketingDraftDTO {
  id: string;
  kind: MarketingDraftKind;
  locale: string;
  title: string;
  status: MarketingDraftStatus;
  brief: MarketingBrief | null;
  notes: string | null;
  factKeys: string[];
  brandKitVersion: number | null;
  abTest: AbTestSetupDTO | null;
  exportedCampaignId: string | null;
  variants: MarketingDraftVariantDTO[];
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MarketingDraftListDTO {
  items: MarketingDraftDTO[];
  total: number;
  page: number;
  limit: number;
}

export interface GenerateDraftsResultDTO {
  drafts: MarketingDraftDTO[];
  /** Generations that failed for a reason other than the budget (the budget aborts the whole request). */
  failures: Array<{ kind: GeneratableDraftKind; locale: string; code: string }>;
}

export interface SegmentInsightDimensionDTO {
  key: 'lifecycleStage' | 'countryCode' | 'locale' | 'firstSource' | 'sourceChannel';
  cells: Array<{ label: string; count: number }>;
  otherCount: number;
}

/** K-anonymous aggregate of the platform tenant's CRM; contains only counts and labels. */
export interface SegmentInsightDTO {
  k: number;
  /** Null when fewer than k contacts exist. */
  totalContacts: number | null;
  dimensions: SegmentInsightDimensionDTO[];
}

export interface SegmentSuggestionResultDTO {
  draft: MarketingDraftDTO;
  insight: SegmentInsightDTO;
}

export interface ExportToCampaignResultDTO {
  campaignId: string;
  templateKey: string;
  /** Always DRAFT: the studio never schedules or sends. */
  campaignStatus: 'DRAFT';
  /** M3c: the stored A/B setup and variants were carried into the campaign. */
  abTest: boolean;
}

export interface MarketingAiStatusDTO {
  configured: boolean;
  budgetCents: number;
  usedMicroUsd: number;
  limitReached: boolean;
}

export type { SegmentGroup };

/** Placeholder names in braces, e.g. `{firstName}`. */
export function bracePlaceholders(text: string): string[] {
  const names = new Set<string>();
  for (const match of text.matchAll(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g)) names.add(match[1]);
  return [...names];
}
