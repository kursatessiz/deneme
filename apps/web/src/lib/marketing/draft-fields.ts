import { MARKETING_FIELD_LIMITS, type GeneratableDraftKind, type MarketingContent, type MessageKey } from '@platform/shared';

/**
 * How the AI studio edits the content of a variant. Every field is edited as
 * a string: lists are one item per line, headings are "## text" or "### text"
 * lines and FAQ pairs are "question :: answer" lines. The conversion is pure
 * so the round trip is unit tested.
 */

export type FieldType = 'text' | 'area' | 'select' | 'list' | 'headings' | 'faq';

export interface FieldSpec {
  name: string;
  type: FieldType;
  labelKey: MessageKey;
  options?: readonly string[];
}

const f = (name: string, type: FieldType, labelKey: MessageKey, options?: readonly string[]): FieldSpec => ({ name, type, labelKey, ...(options ? { options } : {}) });

export const DRAFT_FIELD_SPECS: Readonly<Record<GeneratableDraftKind, readonly FieldSpec[]>> = {
  EMAIL: [f('subject', 'text', 'marketingStudio.field.subject'), f('preheader', 'text', 'marketingStudio.field.preheader'), f('body', 'area', 'marketingStudio.field.body')],
  SMS: [f('text', 'area', 'marketingStudio.field.text')],
  WHATSAPP: [
    f('templateName', 'text', 'marketingStudio.field.templateName'),
    f('category', 'select', 'marketingStudio.field.category', ['MARKETING', 'UTILITY']),
    f('body', 'area', 'marketingStudio.field.body'),
  ],
  AD_META: [f('primaryText', 'area', 'marketingStudio.field.primaryText'), f('headline', 'text', 'marketingStudio.field.headline'), f('description', 'text', 'marketingStudio.field.description')],
  AD_GOOGLE_RSA: [f('headlines', 'list', 'marketingStudio.field.headlines'), f('descriptions', 'list', 'marketingStudio.field.descriptions')],
  AD_LINKEDIN: [f('introText', 'area', 'marketingStudio.field.introText'), f('headline', 'text', 'marketingStudio.field.headline'), f('description', 'text', 'marketingStudio.field.description')],
  LANDING_BLOCK: [
    f('heading', 'text', 'marketingStudio.field.heading'),
    f('subheading', 'area', 'marketingStudio.field.subheading'),
    f('bullets', 'list', 'marketingStudio.field.bullets'),
    f('ctaLabel', 'text', 'marketingStudio.field.ctaLabel'),
  ],
  SUBJECT_LINES: [f('subject', 'text', 'marketingStudio.field.subject'), f('preheader', 'text', 'marketingStudio.field.preheader')],
  CTA_VARIANTS: [f('label', 'text', 'marketingStudio.field.label')],
  SEO_OUTLINE: [
    f('title', 'text', 'marketingStudio.field.seoTitle'),
    f('metaDescription', 'area', 'marketingStudio.field.metaDescription'),
    f('headings', 'headings', 'marketingStudio.field.headings'),
    f('faq', 'faq', 'marketingStudio.field.faq'),
    f('internalLinkIdeas', 'list', 'marketingStudio.field.internalLinkIdeas'),
  ],
};

const lines = (value: string): string[] =>
  value
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '');

/** Content of a variant as edit strings, one per field of the kind. */
export function contentToValues(kind: GeneratableDraftKind, content: MarketingContent): Record<string, string> {
  const out: Record<string, string> = {};
  for (const spec of DRAFT_FIELD_SPECS[kind]) {
    const raw = content[spec.name];
    if (spec.type === 'list') out[spec.name] = Array.isArray(raw) ? raw.map(String).join('\n') : '';
    else if (spec.type === 'headings') {
      out[spec.name] = Array.isArray(raw)
        ? raw.map((h) => `${(h as { level?: number }).level === 3 ? '###' : '##'} ${String((h as { text?: string }).text ?? '')}`).join('\n')
        : '';
    } else if (spec.type === 'faq') {
      out[spec.name] = Array.isArray(raw)
        ? raw.map((q) => `${String((q as { question?: string }).question ?? '')} :: ${String((q as { answer?: string }).answer ?? '')}`).join('\n')
        : '';
    } else out[spec.name] = typeof raw === 'string' ? raw : '';
  }
  return out;
}

/** Edit strings back to the content object the API validates. */
export function valuesToContent(kind: GeneratableDraftKind, values: Record<string, string>): MarketingContent {
  const out: MarketingContent = {};
  for (const spec of DRAFT_FIELD_SPECS[kind]) {
    const value = values[spec.name] ?? '';
    if (spec.type === 'list') out[spec.name] = lines(value);
    else if (spec.type === 'headings') {
      out[spec.name] = lines(value).map((line) => {
        const level = line.startsWith('###') ? 3 : 2;
        return { level, text: line.replace(/^#{2,3}\s*/, '') };
      });
    } else if (spec.type === 'faq') {
      out[spec.name] = lines(value).map((line) => {
        const at = line.indexOf('::');
        return at < 0 ? { question: line, answer: '' } : { question: line.slice(0, at).trim(), answer: line.slice(at + 2).trim() };
      });
    } else out[spec.name] = value.trim();
  }
  return out;
}

/** Character limit of a text field (per line for list fields); undefined when the kind has none. */
export function fieldLimit(kind: GeneratableDraftKind, name: string): number | undefined {
  return MARKETING_FIELD_LIMITS[kind]?.[name];
}
