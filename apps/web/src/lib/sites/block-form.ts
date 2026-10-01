import { z } from 'zod';
import { BLOCK_SCHEMAS, type BlockFormField, type BlockType, type Translate } from '@platform/shared';

/**
 * Pure helpers of the block form (components/sites/BlockForm.tsx): immutable edits of the block data by path,
 * the inline validation errors derived from the block's Zod schema (mapped to translated messages, never the
 * schema's own text), label keys and the data of a freshly added block. docs/SAYFA_MOTORU.md "Editörler".
 */

export type DataPath = ReadonlyArray<string | number>;

export function getAt(data: unknown, path: DataPath): unknown {
  let current: unknown = data;
  for (const part of path) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string | number, unknown>)[part];
  }
  return current;
}

/** A copy of `data` with `value` at `path`; objects and arrays on the way are created as needed and never mutated. */
export function setAt(data: unknown, path: DataPath, value: unknown): unknown {
  if (path.length === 0) return value;
  const [head, ...rest] = path;
  if (typeof head === 'number') {
    const list = Array.isArray(data) ? [...data] : [];
    list[head] = setAt(list[head], rest, value);
    return list;
  }
  const record = data !== null && typeof data === 'object' && !Array.isArray(data) ? { ...(data as Record<string, unknown>) } : {};
  record[head] = setAt(record[head], rest, value);
  return record;
}

/** A copy of `data` without the key or array element at `path`. */
export function removeAt(data: unknown, path: DataPath): unknown {
  if (path.length === 0) return data;
  const parent = getAt(data, path.slice(0, -1));
  const last = path[path.length - 1];
  if (Array.isArray(parent) && typeof last === 'number') return setAt(data, path.slice(0, -1), parent.filter((_, i) => i !== last));
  if (parent !== null && typeof parent === 'object' && !Array.isArray(parent)) {
    const { [String(last)]: _removed, ...kept } = parent as Record<string, unknown>;
    return setAt(data, path.slice(0, -1), kept);
  }
  return data;
}

function isBlank(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return true;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/**
 * Sets one field of one locale's text. An emptied optional field is removed (so the saved JSON carries no empty
 * strings the schema would reject on links), and a locale whose fields are all empty is removed: that locale then
 * counts as untranslated and the page falls back to the site's default language.
 */
export function setLocaleField(data: unknown, locale: string, path: DataPath, value: unknown, required: boolean): unknown {
  const full: DataPath = ['text', locale, ...path];
  let next = value === '' && !required ? removeAt(data, full) : setAt(data, full, value);
  const text = getAt(next, ['text', locale]);
  if (text !== null && typeof text === 'object' && Object.values(text as Record<string, unknown>).every(isBlank)) next = removeAt(next, ['text', locale]);
  return next;
}

/** A config value, removing an emptied optional one the same way. */
export function setConfigField(data: unknown, path: DataPath, value: unknown, required: boolean): unknown {
  const full: DataPath = ['config', ...path];
  return value === '' && !required ? removeAt(data, full) : setAt(data, full, value);
}

// ---------------------------------------------------------------------------
// Inline validation
// ---------------------------------------------------------------------------

export interface FieldError {
  /** i18n key (namespace `sites`). */
  key: string;
  params?: Record<string, string | number>;
}

export function pathKey(path: DataPath): string {
  return path.join('.');
}

/** Maps one Zod issue to a translated message key; the schema's own (Turkish or English) text is never shown. */
export function describeIssue(issue: z.ZodIssue): FieldError {
  switch (issue.code) {
    case 'invalid_type':
      return issue.received === 'undefined' ? { key: 'sites.editor.blocks.error.required' } : { key: 'sites.editor.blocks.error.invalid' };
    case 'too_small':
      if (issue.type === 'array') return { key: 'sites.editor.blocks.error.tooFew', params: { min: Number(issue.minimum) } };
      return issue.minimum === 1 ? { key: 'sites.editor.blocks.error.required' } : { key: 'sites.editor.blocks.error.tooShort', params: { min: Number(issue.minimum) } };
    case 'too_big':
      return issue.type === 'array' ? { key: 'sites.editor.blocks.error.tooMany', params: { max: Number(issue.maximum) } } : { key: 'sites.editor.blocks.error.tooLong', params: { max: Number(issue.maximum) } };
    case 'invalid_string': {
      if (issue.validation === 'url') return { key: 'sites.editor.blocks.error.invalidUrl' };
      // The regex checks are the https-only image rule and the safe link rule; the field name tells which.
      const last = issue.path[issue.path.length - 1];
      return { key: typeof last === 'string' && /Href$/.test(last) ? 'sites.editor.blocks.error.invalidHref' : 'sites.editor.blocks.error.httpsOnly' };
    }
    case 'invalid_enum_value':
      return { key: 'sites.editor.blocks.error.invalid' };
    default:
      return { key: 'sites.editor.blocks.error.invalid' };
  }
}

/** The first error of every invalid path, keyed by `pathKey`; an empty object when the data is valid. */
export function blockErrors(type: BlockType, data: unknown): Record<string, FieldError> {
  const result = BLOCK_SCHEMAS[type].safeParse(data);
  if (result.success) return {};
  const errors: Record<string, FieldError> = {};
  for (const issue of result.error.issues) {
    const key = pathKey(issue.path);
    if (!(key in errors)) errors[key] = describeIssue(issue);
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

/** Label key of a form field: a repeatable `items` list is named per block type, every other field by its key. */
export function fieldLabelKey(type: BlockType, field: Pick<BlockFormField, 'key' | 'kind'>): string {
  return field.key === 'items' && field.kind === 'repeatable' ? `sites.editor.blocks.items.${type}` : `sites.editor.blocks.field.${field.key}`;
}

export function choiceLabelKey(fieldKey: string, choice: string): string {
  return `sites.editor.blocks.choice.${fieldKey}.${choice}`;
}

// ---------------------------------------------------------------------------
// New blocks
// ---------------------------------------------------------------------------

/** The data of a block that was just added: valid against its schema, with a few translated starter texts in the site's default language. */
export function newBlockData(type: BlockType, locale: string, t: Translate): unknown {
  const text = (fields: Record<string, unknown>) => ({ [locale]: fields });
  switch (type) {
    case 'hero':
      return { config: {}, text: text({ title: t('sites.editor.blocks.template.heading') }) };
    case 'feature_grid':
      return { config: {}, text: text({ title: t('sites.editor.blocks.template.features'), items: [] }) };
    case 'sector_cards':
      return { config: { sectorKeys: [] }, text: text({}) };
    case 'how_it_works':
      return { config: {}, text: text({ title: t('sites.editor.blocks.template.steps'), steps: [] }) };
    case 'pricing':
      return { config: { hidden: false }, text: text({}) };
    case 'testimonials':
    case 'faq':
      return { config: {}, text: text({ items: [] }) };
    case 'stats':
      return { config: {}, text: text({ items: [] }) };
    case 'cta':
      return { config: {}, text: text({ title: t('sites.editor.blocks.template.ctaTitle'), buttonLabel: t('sites.editor.blocks.template.ctaButton'), buttonHref: locale.startsWith('tr') ? '#iletisim' : '#contact' }) };
    case 'lead_form':
      return { config: { fields: ['fullName', 'phone'] }, text: text({ title: t('sites.editor.blocks.template.formTitle'), submitLabel: t('sites.editor.blocks.template.formSubmit') }) };
    case 'booking_widget':
      return { config: {}, text: text({ title: t('sites.editor.blocks.template.bookingTitle'), buttonLabel: t('sites.editor.blocks.template.bookingButton') }) };
    case 'trainers':
      return { config: {}, text: text({ title: t('sites.editor.blocks.template.trainersTitle'), items: [] }) };
    case 'contact':
      return { config: { showAddress: true, showPhone: true, showEmail: true }, text: text({}) };
    case 'legal_text':
      return { config: {}, text: text({ title: t('sites.editor.blocks.template.heading'), body: t('sites.editor.blocks.template.body') }) };
  }
}
