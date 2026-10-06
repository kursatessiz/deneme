import { z } from 'zod';
import { vmsg } from '../validation-key';

/**
 * Page engine block types (docs/SAYFA_MOTORU.md, docs/BUYUME_VE_GLOBAL_MIMARI.md
 * section 3.9). Every block stores locale-independent `config` and
 * per-locale `text`; a locale missing from `text` falls back to the page's
 * default locale (`resolveBlockText`). Text is always rendered as plain
 * text, never as HTML.
 */

export const BLOCK_TYPES = [
  'hero',
  'feature_grid',
  'sector_cards',
  'how_it_works',
  'pricing',
  'testimonials',
  'faq',
  'stats',
  'cta',
  'lead_form',
  'booking_widget',
  'trainers',
  'contact',
  'legal_text',
] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

export function isBlockType(value: string): value is BlockType {
  return (BLOCK_TYPES as readonly string[]).includes(value);
}

const LocaleCode = z.string().trim().min(2).max(10);
/** A URL from our own upload storage only (never an arbitrary external image URL). */
const StorageUrl = z.string().trim().url().max(2000).regex(/^https:\/\//i, vmsg('validation.onlyHttpsAddress'));
const PlainText = z.string().trim().max(4000);
const ShortText = z.string().trim().max(200);
/**
 * A link target: a site-relative path, an in-page anchor, or an http(s),
 * mailto or tel URL. Anything else (javascript:, data:, protocol-relative
 * //host) is rejected, so authored links can never run script.
 */
export const SAFE_HREF_PATTERN = /^(\/(?!\/)[^\s]*|#[A-Za-z0-9_-]*|https?:\/\/[^\s]+|mailto:[^\s]+|tel:\+?[0-9 ()-]+)$/i;
const Href = z.string().trim().max(500).regex(SAFE_HREF_PATTERN, vmsg('validation.invalidLink'));

function localeMap<T extends z.ZodTypeAny>(shape: T) {
  return z.record(LocaleCode, shape);
}

// ---------------------------------------------------------------------------
// hero
// ---------------------------------------------------------------------------
export const HeroTextSchema = z
  .object({
    eyebrow: ShortText.optional(),
    title: z.string().trim().min(1).max(200),
    subtitle: PlainText.optional(),
    primaryCtaLabel: ShortText.optional(),
    primaryCtaHref: Href.optional(),
    secondaryCtaLabel: ShortText.optional(),
    secondaryCtaHref: Href.optional(),
  })
  .strict();
export const HeroBlockSchema = z
  .object({
    config: z.object({ imageUrl: StorageUrl.optional() }).strict().default({}),
    text: localeMap(HeroTextSchema),
  })
  .strict();
export type HeroBlockData = z.infer<typeof HeroBlockSchema>;

// ---------------------------------------------------------------------------
// feature_grid
// ---------------------------------------------------------------------------
const FeatureItem = z.object({ title: ShortText, description: PlainText }).strict();
export const FeatureGridTextSchema = z
  .object({ title: ShortText.optional(), items: z.array(FeatureItem).max(12) })
  .strict();
export const FeatureGridBlockSchema = z
  .object({ config: z.object({}).strict().default({}), text: localeMap(FeatureGridTextSchema) })
  .strict();
export type FeatureGridBlockData = z.infer<typeof FeatureGridBlockSchema>;

// ---------------------------------------------------------------------------
// sector_cards -- content is generated from BusinessTypeTemplate vocabulary;
// the block only configures which sector keys to show and in what order.
// ---------------------------------------------------------------------------
export const SectorCardsBlockSchema = z
  .object({
    config: z.object({ sectorKeys: z.array(z.string().max(60)).max(24).default([]) }).strict(),
    text: localeMap(z.object({ title: ShortText.optional(), description: PlainText.optional() }).strict()),
  })
  .strict();
export type SectorCardsBlockData = z.infer<typeof SectorCardsBlockSchema>;

// ---------------------------------------------------------------------------
// how_it_works
// ---------------------------------------------------------------------------
const StepItem = z.object({ title: ShortText, description: PlainText }).strict();
export const HowItWorksBlockSchema = z
  .object({
    config: z.object({}).strict().default({}),
    text: localeMap(z.object({ title: ShortText.optional(), steps: z.array(StepItem).max(8) }).strict()),
  })
  .strict();
export type HowItWorksBlockData = z.infer<typeof HowItWorksBlockSchema>;

// ---------------------------------------------------------------------------
// pricing -- reads platform Plans for the platform site, tenant
// PackageDefinitions for tenant sites; `hidden` lets a page omit prices.
// ---------------------------------------------------------------------------
export const PricingBlockSchema = z
  .object({
    config: z.object({ hidden: z.boolean().default(false) }).strict().default({ hidden: false }),
    text: localeMap(z.object({ title: ShortText.optional(), description: PlainText.optional() }).strict()),
  })
  .strict();
export type PricingBlockData = z.infer<typeof PricingBlockSchema>;

// ---------------------------------------------------------------------------
// testimonials -- data, not hard-coded copy
// ---------------------------------------------------------------------------
const TestimonialItem = z
  .object({ quote: PlainText, authorName: ShortText, authorRole: ShortText.optional() })
  .strict();
export const TestimonialsBlockSchema = z
  .object({
    config: z.object({}).strict().default({}),
    text: localeMap(z.object({ title: ShortText.optional(), items: z.array(TestimonialItem).max(12) }).strict()),
  })
  .strict();
export type TestimonialsBlockData = z.infer<typeof TestimonialsBlockSchema>;

// ---------------------------------------------------------------------------
// faq -- renders FAQPage JSON-LD
// ---------------------------------------------------------------------------
const FaqItem = z.object({ question: ShortText, answer: PlainText }).strict();
export const FaqBlockSchema = z
  .object({
    config: z.object({}).strict().default({}),
    text: localeMap(z.object({ title: ShortText.optional(), items: z.array(FaqItem).max(30) }).strict()),
  })
  .strict();
export type FaqBlockData = z.infer<typeof FaqBlockSchema>;

// ---------------------------------------------------------------------------
// stats
// ---------------------------------------------------------------------------
const StatItem = z.object({ label: ShortText, value: ShortText }).strict();
export const StatsBlockSchema = z
  .object({
    config: z.object({}).strict().default({}),
    text: localeMap(z.object({ items: z.array(StatItem).max(8) }).strict()),
  })
  .strict();
export type StatsBlockData = z.infer<typeof StatsBlockSchema>;

// ---------------------------------------------------------------------------
// cta
// ---------------------------------------------------------------------------
export const CtaBlockSchema = z
  .object({
    config: z.object({}).strict().default({}),
    text: localeMap(
      z
        .object({ title: ShortText, description: PlainText.optional(), buttonLabel: ShortText, buttonHref: Href })
        .strict(),
    ),
  })
  .strict();
export type CtaBlockData = z.infer<typeof CtaBlockSchema>;

// ---------------------------------------------------------------------------
// lead_form -- posts to POST /public/studios/:slug/leads (existing endpoint);
// bot protection is the existing honeypot + rate limit + time check.
// ---------------------------------------------------------------------------
export const LEAD_FORM_FIELDS = ['fullName', 'phone', 'email', 'interest'] as const;
export const LeadFormBlockSchema = z
  .object({
    config: z
      .object({
        studioSlug: z.string().trim().max(60).optional(),
        fields: z.array(z.enum(LEAD_FORM_FIELDS)).min(2).default(['fullName', 'phone']),
        /** M3e: show a separate, optional (never pre-ticked) marketing consent box. Off by default. */
        marketingConsent: z.boolean().optional(),
      })
      .strict()
      .default({ fields: ['fullName', 'phone'] }),
    text: localeMap(
      z
        .object({
          title: ShortText.optional(),
          submitLabel: ShortText.optional(),
          consentText: PlainText.optional(),
          /** Wording of the marketing consent box; the bundled default is used when empty. */
          marketingConsentText: PlainText.optional(),
        })
        .strict(),
    ),
  })
  .strict();
export type LeadFormBlockData = z.infer<typeof LeadFormBlockSchema>;

/**
 * Version of the marketing consent wording a visitor saw (M3e): the page
 * language plus a 32-bit FNV-1a hash of the text, so a changed wording
 * gets a new version without anyone maintaining a counter. Stored on the
 * consent row and shown in the confirmation e-mail.
 */
export function leadFormConsentVersion(locale: string, text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  const lang = locale.replace(/[^A-Za-z-]/g, '').slice(0, 10) || 'x';
  return `lf-${lang}-${h.toString(16).padStart(8, '0')}`;
}

// ---------------------------------------------------------------------------
// booking_widget -- tenant sites only; links to the existing public booking flow.
// ---------------------------------------------------------------------------
export const BookingWidgetBlockSchema = z
  .object({
    config: z.object({ studioSlug: z.string().trim().max(60).optional() }).strict().default({}),
    text: localeMap(z.object({ title: ShortText.optional(), buttonLabel: ShortText.optional() }).strict()),
  })
  .strict();
export type BookingWidgetBlockData = z.infer<typeof BookingWidgetBlockSchema>;

// ---------------------------------------------------------------------------
// trainers -- tenant sites only; manually curated (name/photo/bio per locale)
// ---------------------------------------------------------------------------
const TrainerItem = z
  .object({ name: ShortText, photoUrl: StorageUrl.optional(), bio: PlainText.optional() })
  .strict();
export const TrainersBlockSchema = z
  .object({
    config: z.object({}).strict().default({}),
    text: localeMap(z.object({ title: ShortText.optional(), items: z.array(TrainerItem).max(30) }).strict()),
  })
  .strict();
export type TrainersBlockData = z.infer<typeof TrainersBlockSchema>;

// ---------------------------------------------------------------------------
// contact -- reads CompanyInfo (platform) or Studio contact fields (tenant)
// ---------------------------------------------------------------------------
export const ContactBlockSchema = z
  .object({
    config: z
      .object({ showAddress: z.boolean().default(true), showPhone: z.boolean().default(true), showEmail: z.boolean().default(true) })
      .strict()
      .default({ showAddress: true, showPhone: true, showEmail: true }),
    text: localeMap(z.object({ title: ShortText.optional(), description: PlainText.optional() }).strict()),
  })
  .strict();
export type ContactBlockData = z.infer<typeof ContactBlockSchema>;

// ---------------------------------------------------------------------------
// legal_text -- plain text only, rendered as paragraphs split on blank lines
// ---------------------------------------------------------------------------
export const LegalTextBlockSchema = z
  .object({
    config: z.object({}).strict().default({}),
    text: localeMap(z.object({ title: ShortText.optional(), body: z.string().trim().min(1).max(60000) }).strict()),
  })
  .strict();
export type LegalTextBlockData = z.infer<typeof LegalTextBlockSchema>;

// ---------------------------------------------------------------------------
export const BLOCK_SCHEMAS = {
  hero: HeroBlockSchema,
  feature_grid: FeatureGridBlockSchema,
  sector_cards: SectorCardsBlockSchema,
  how_it_works: HowItWorksBlockSchema,
  pricing: PricingBlockSchema,
  testimonials: TestimonialsBlockSchema,
  faq: FaqBlockSchema,
  stats: StatsBlockSchema,
  cta: CtaBlockSchema,
  lead_form: LeadFormBlockSchema,
  booking_widget: BookingWidgetBlockSchema,
  trainers: TrainersBlockSchema,
  contact: ContactBlockSchema,
  legal_text: LegalTextBlockSchema,
} satisfies Record<BlockType, z.ZodTypeAny>;

/** Tenant-only block types; the platform site editor hides these. */
export const TENANT_ONLY_BLOCK_TYPES: readonly BlockType[] = ['booking_widget', 'trainers'];

export function validateBlockData(type: BlockType, data: unknown) {
  return BLOCK_SCHEMAS[type].parse(data);
}

export interface BlockDTO {
  id: string;
  type: BlockType;
  position: number;
  abVariantKey: string | null;
  data: unknown;
}

/**
 * Resolves one block's text for a locale: exact locale, else the site's
 * default locale, else the first locale present. Missing entirely returns
 * null (the block renders nothing for that field rather than throwing).
 */
export function resolveBlockText<T>(text: Record<string, T> | undefined, locale: string, defaultLocale: string): T | null {
  if (!text) return null;
  if (text[locale]) return text[locale];
  if (text[defaultLocale]) return text[defaultLocale];
  const first = Object.keys(text)[0];
  return first ? text[first] : null;
}
