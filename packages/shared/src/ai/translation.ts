import { z } from 'zod';
import { hasOwn } from '../i18n/own';
import { TRANSLATION_MAX_LENGTH, validatePackMessages } from '../i18n/pack';
import { placeholdersOf, pluralBaseOf } from '../i18n/translator';
import type { AiErrorCode } from './api';
import { vmsg } from '../validation-key';

/**
 * Automatic translation of the UI catalogue (G3b, docs/YAPAY_ZEKA.md).
 * The Turkish base is the source; English, when it has a value, is sent as
 * a second reference. Pure helpers here decide which keys a job covers
 * (missing only, some namespaces, or everything), group plural keys so the
 * model writes every form the target language needs, split the work into
 * batches and validate every returned value before it is saved.
 */

// -- plural forms -------------------------------------------------------------

export const PLURAL_CATEGORIES = ['zero', 'one', 'two', 'few', 'many', 'other'] as const;
export type PluralCategory = (typeof PLURAL_CATEGORIES)[number];

/** CLDR plural categories of a locale in canonical order, e.g. ru -> one, few, many, other. */
export function pluralCategoriesFor(locale: string): PluralCategory[] {
  let categories: readonly string[];
  try {
    categories = new Intl.PluralRules(locale).resolvedOptions().pluralCategories;
  } catch {
    categories = ['one', 'other'];
  }
  const set = new Set(categories);
  set.add('other');
  return PLURAL_CATEGORIES.filter((c) => set.has(c));
}

/** Plural groups of a catalogue: "x" -> { one: "...", other: "..." } for every "x.other" present. */
export function pluralGroupsOf(base: Readonly<Record<string, string>>): Map<string, Partial<Record<PluralCategory, string>>> {
  const groups = new Map<string, Partial<Record<PluralCategory, string>>>();
  for (const key of Object.keys(base)) {
    const group = pluralBaseOf(key);
    if (!group || !hasOwn(base, `${group}.other`)) continue;
    const category = key.slice(group.length + 1) as PluralCategory;
    const forms = groups.get(group) ?? {};
    forms[category] = base[key];
    groups.set(group, forms);
  }
  return groups;
}

/**
 * A plural form the base (Turkish) does not have but the target language
 * needs, e.g. "common.itemCount.few" for Russian. Stored like any other
 * override so the translator's `${key}.${category}` lookup finds it.
 */
export function isPluralExtensionKey(key: string, locale: string, base: Readonly<Record<string, string>>): boolean {
  if (hasOwn(base, key)) return false;
  const group = pluralBaseOf(key);
  if (!group || !hasOwn(base, `${group}.other`)) return false;
  const category = key.slice(group.length + 1) as PluralCategory;
  return pluralCategoriesFor(locale).includes(category);
}

/**
 * The base catalogue as seen by one language: every base key plus the
 * plural extension keys it needs (e.g. ".few" for Russian), each extension
 * mapped to its group's ".other" source. Used for completion, the CMS
 * editor, pack export/import and placeholder checks of that language.
 */
export function baseWithPluralExtensions(base: Readonly<Record<string, string>>, locale: string): Readonly<Record<string, string>> {
  const categories = pluralCategoriesFor(locale);
  const extended: Record<string, string> = { ...base };
  for (const [group, forms] of pluralGroupsOf(base)) {
    for (const category of categories) {
      if (forms[category] === undefined) extended[`${group}.${category}`] = forms.other ?? '';
    }
  }
  return extended;
}

/** Source text a plural extension key is checked against: its own base form, else ".other". */
export function sourceForKey(key: string, base: Readonly<Record<string, string>>): string | undefined {
  if (hasOwn(base, key)) return base[key];
  const group = pluralBaseOf(key);
  if (group && hasOwn(base, `${group}.other`)) return base[`${group}.other`];
  return undefined;
}

// -- units of work -------------------------------------------------------------

export interface SingleTranslationUnit {
  kind: 'single';
  /** Job item id: the message key. */
  id: string;
  key: string;
  source: string;
  reference: string | null;
  placeholders: string[];
}

export interface PluralTranslationUnit {
  kind: 'plural';
  /** Job item id: "<group>.*". */
  id: string;
  group: string;
  /** Forms to write: the base's own forms plus every category the target needs. */
  categories: PluralCategory[];
  sourceForms: Partial<Record<PluralCategory, string>>;
  referenceForms: Partial<Record<PluralCategory, string>> | null;
  placeholders: string[];
}

export type TranslationUnit = SingleTranslationUnit | PluralTranslationUnit;

export const PLURAL_UNIT_SUFFIX = '.*';

export function pluralUnitId(group: string): string {
  return `${group}${PLURAL_UNIT_SUFFIX}`;
}

function inNamespaces(key: string, namespaces: readonly string[]): boolean {
  if (namespaces.length === 0) return true;
  return namespaces.some((ns) => key === ns || key.startsWith(`${ns}.`));
}

function present(messages: Readonly<Record<string, string>>, key: string): boolean {
  return hasOwn(messages, key) && messages[key].trim() !== '';
}

export interface BuildUnitsInput {
  /** Turkish base catalogue. */
  base: Readonly<Record<string, string>>;
  /** Effective English messages used as a second reference; null when translating English itself. */
  reference: Readonly<Record<string, string>> | null;
  /** Effective messages of the target language (bundled + overrides). */
  current: Readonly<Record<string, string>>;
  locale: string;
  /** Key prefixes; empty means every namespace. */
  namespaces: readonly string[];
  /** Re-translate keys that already have a value. */
  overwrite: boolean;
}

/** The units a job covers, sorted by id so batches are stable across runs. */
export function buildTranslationUnits(input: BuildUnitsInput): TranslationUnit[] {
  const { base, reference, current, locale, namespaces, overwrite } = input;
  const groups = pluralGroupsOf(base);
  const targetCategories = pluralCategoriesFor(locale);
  const units: TranslationUnit[] = [];

  for (const [group, sourceForms] of groups) {
    if (!inNamespaces(group, namespaces)) continue;
    const own = PLURAL_CATEGORIES.filter((c) => sourceForms[c] !== undefined);
    const categories = PLURAL_CATEGORIES.filter((c) => own.includes(c) || targetCategories.includes(c));
    const missing = categories.some((c) => !present(current, `${group}.${c}`));
    if (!overwrite && !missing) continue;
    let referenceForms: Partial<Record<PluralCategory, string>> | null = null;
    if (reference) {
      const forms: Partial<Record<PluralCategory, string>> = {};
      for (const c of PLURAL_CATEGORIES) if (present(reference, `${group}.${c}`)) forms[c] = reference[`${group}.${c}`];
      referenceForms = Object.keys(forms).length > 0 ? forms : null;
    }
    units.push({
      kind: 'plural',
      id: pluralUnitId(group),
      group,
      categories,
      sourceForms,
      referenceForms,
      placeholders: placeholdersOf(sourceForms.other ?? ''),
    });
  }

  for (const key of Object.keys(base)) {
    const group = pluralBaseOf(key);
    if (group && groups.has(group)) continue;
    if (!inNamespaces(key, namespaces)) continue;
    if (!overwrite && present(current, key)) continue;
    units.push({
      kind: 'single',
      id: key,
      key,
      source: base[key],
      reference: reference && present(reference, key) ? reference[key] : null,
      placeholders: placeholdersOf(base[key]),
    });
  }

  return units.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Splits `items` into consecutive batches of at most `size`. */
export function chunkBatches<T>(items: readonly T[], size: number): T[][] {
  if (!Number.isInteger(size) || size < 1) throw new Error('chunk size must be a positive integer');
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size));
  return batches;
}

// -- validation ----------------------------------------------------------------

/** A tag cannot contain another '<', which also keeps the match linear on hostile input. */
const HTML_TAG = /<\/?[a-zA-Z!][^<>]*>/;

export function containsHtml(value: string): boolean {
  return HTML_TAG.test(value);
}

export type TranslationRejection = 'EMPTY' | 'PLACEHOLDER_MISMATCH' | 'HTML' | 'TOO_LONG';

/**
 * Checks one machine-translated value against its Turkish source with the
 * same placeholder rule the CMS and pack uploads use (validatePackMessages),
 * and refuses markup: values are rendered as plain text only.
 */
export function validateTranslatedValue(source: string, value: string): TranslationRejection | null {
  if (value.trim() === '') return 'EMPTY';
  if (value.length > TRANSLATION_MAX_LENGTH) return 'TOO_LONG';
  if (containsHtml(value) && !containsHtml(source)) return 'HTML';
  const { placeholderMismatches, accepted } = validatePackMessages({ k: value }, { k: source });
  if (placeholderMismatches.length > 0 || !hasOwn(accepted, 'k')) return 'PLACEHOLDER_MISMATCH';
  return null;
}

// -- jobs ------------------------------------------------------------------------

export const MessageNamespaceSchema = z.string().trim().min(1).max(60).regex(/^[a-zA-Z][a-zA-Z0-9_]*$/);

export const StartTranslationJobSchema = z
  .object({
    /** Empty or absent: every namespace. */
    namespaces: z.array(MessageNamespaceSchema).max(100).default([]),
    /** Re-translate keys that already have a value (manual edits included). */
    overwrite: z.boolean().default(false),
    /** Must be true when overwrite is true: the CMS asks for confirmation first. */
    confirmOverwrite: z.boolean().optional(),
  })
  .strict()
  .refine((v) => !v.overwrite || v.confirmOverwrite === true, {
    message: vmsg('validation.confirmationRequiredOverwriteEverything'),
    path: ['confirmOverwrite'],
  });
export type StartTranslationJobInput = z.infer<typeof StartTranslationJobSchema>;

export const TRANSLATION_JOB_STATUSES = ['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED'] as const;
export type TranslationJobStatus = (typeof TRANSLATION_JOB_STATUSES)[number];

export function isActiveTranslationJob(status: TranslationJobStatus): boolean {
  return status === 'QUEUED' || status === 'RUNNING';
}

export interface TranslationJobFailureDTO {
  key: string;
  errorCode: TranslationRejection | AiErrorCode | 'MISSING_IN_OUTPUT';
}

export interface TranslationJobDTO {
  id: string;
  locale: string;
  status: TranslationJobStatus;
  namespaces: string[];
  overwrite: boolean;
  total: number;
  done: number;
  failed: number;
  skipped: number;
  model: string | null;
  lastErrorCode: AiErrorCode | null;
  costMicroUsd: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  cancelRequested: boolean;
  /** Up to 50 failed keys with the reason. */
  failures: TranslationJobFailureDTO[];
}

// -- glossary ----------------------------------------------------------------------

export const GlossaryTermSchema = z
  .object({
    term: z.string().trim().min(1).max(120),
    /** Null keeps the term unchanged in the translation (product and brand names). */
    translation: z.string().trim().min(1).max(200).nullable(),
    note: z.string().trim().max(300).nullable().optional(),
  })
  .strict();
export type GlossaryTermInput = z.infer<typeof GlossaryTermSchema>;

export interface GlossaryTermDTO {
  id: string;
  locale: string;
  term: string;
  translation: string | null;
  note: string | null;
  updatedAt: string;
}

// -- review ------------------------------------------------------------------------

export const TRANSLATION_SOURCES = ['MANUAL', 'UPLOAD', 'AI'] as const;
export type TranslationSource = (typeof TRANSLATION_SOURCES)[number];

/** POST /admin/i18n/languages/:code/review: approve machine translations. */
export const ReviewTranslationsSchema = z
  .object({
    /** Keys to approve; absent approves every unreviewed AI value of the language. */
    keys: z.array(z.string().min(1).max(210)).max(5000).optional(),
  })
  .strict();
export type ReviewTranslationsInput = z.infer<typeof ReviewTranslationsSchema>;
