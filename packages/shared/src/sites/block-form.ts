import { z } from 'zod';
import { BLOCK_SCHEMAS, BLOCK_TYPES, SAFE_HREF_PATTERN, type BlockType } from './blocks';

/**
 * Field-based editing of page engine blocks (docs/SAYFA_MOTORU.md "Editörler"). The editor does not hard-code a
 * form per block type: it derives one from the block's Zod schema in `blocks.ts`, so a field added to a schema
 * appears in the form without touching the editor. This module is the pure derivation (schema -> field spec);
 * the React form that renders a spec lives in apps/web.
 */

export type BlockFormFieldKind =
  /** A short single-line string (up to 200 characters). */
  | 'text'
  /** A longer string, edited in a textarea. */
  | 'textarea'
  /** An https image URL (a block's image fields). */
  | 'url'
  /** A link target: site path, anchor, http(s), mailto or tel (`SAFE_HREF_PATTERN`). */
  | 'href'
  | 'boolean'
  /** A list of free strings (for example the sector keys of `sector_cards`). */
  | 'string_list'
  /** A subset of a fixed list of values (for example the fields of a `lead_form`). */
  | 'choice_list'
  /** A list of objects (FAQ items, features, steps), each edited with `itemFields`. */
  | 'repeatable'
  /** A shape the form does not cover; only the JSON view edits it. */
  | 'unsupported';

export interface BlockFormField {
  key: string;
  kind: BlockFormFieldKind;
  /** False for an optional or defaulted field. */
  required: boolean;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  /** `choice_list`: the allowed values. */
  choices?: readonly string[];
  /** `repeatable`: the fields of one item. */
  itemFields?: BlockFormField[];
  /** The schema's default for a missing value (a boolean switch or a list); absent when the schema has none. */
  defaultValue?: boolean | string[];
}

export interface BlockFormSpec {
  type: BlockType;
  /** Locale-independent settings (`data.config`). */
  config: BlockFormField[];
  /** Fields of one locale's text (`data.text[locale]`). */
  text: BlockFormField[];
}

/** Strings longer than a headline are edited in a textarea. */
const TEXTAREA_MIN_MAX_LENGTH = 201;

interface Unwrapped {
  inner: z.ZodTypeAny;
  optional: boolean;
  defaultValue?: unknown;
}

function typeNameOf(schema: z.ZodTypeAny): string {
  return (schema._def as { typeName: string }).typeName;
}

/** Strips optional, nullable, default and refinement wrappers; whether any of them makes the value optional. */
function unwrap(schema: z.ZodTypeAny): Unwrapped {
  let current = schema;
  let optional = false;
  let defaultValue: unknown;
  for (let depth = 0; depth < 8; depth += 1) {
    const name = typeNameOf(current);
    if (name === 'ZodDefault' && defaultValue === undefined) defaultValue = (current._def as { defaultValue: () => unknown }).defaultValue();
    if (name === 'ZodOptional' || name === 'ZodNullable' || name === 'ZodDefault') {
      optional = true;
      current = (current._def as { innerType: z.ZodTypeAny }).innerType;
    } else if (name === 'ZodEffects') {
      current = (current._def as { schema: z.ZodTypeAny }).schema;
    } else {
      break;
    }
  }
  return { inner: current, optional, defaultValue };
}

interface StringCheck {
  kind: string;
  value?: number;
  regex?: RegExp;
}

function stringField(key: string, schema: z.ZodString, optional: boolean): BlockFormField {
  const checks = (schema._def as { checks: StringCheck[] }).checks;
  const max = checks.find((c) => c.kind === 'max')?.value;
  let kind: BlockFormFieldKind = max !== undefined && max >= TEXTAREA_MIN_MAX_LENGTH ? 'textarea' : 'text';
  if (checks.some((c) => c.kind === 'url')) kind = 'url';
  else if (checks.some((c) => c.kind === 'regex' && c.regex === SAFE_HREF_PATTERN)) kind = 'href';
  return { key, kind, required: !optional, ...(max !== undefined ? { maxLength: max } : {}) };
}

interface ArrayBounds {
  minLength?: { value: number } | null;
  maxLength?: { value: number } | null;
  type: z.ZodTypeAny;
}

function arrayField(key: string, schema: z.ZodTypeAny, optional: boolean): BlockFormField {
  const def = schema._def as ArrayBounds;
  const bounds = {
    ...(def.minLength ? { minItems: def.minLength.value } : {}),
    ...(def.maxLength ? { maxItems: def.maxLength.value } : {}),
  };
  const element = unwrap(def.type).inner;
  const elementName = typeNameOf(element);
  if (elementName === 'ZodString') return { key, kind: 'string_list', required: !optional, ...bounds };
  if (elementName === 'ZodEnum') return { key, kind: 'choice_list', required: !optional, choices: (element._def as { values: readonly string[] }).values, ...bounds };
  if (elementName === 'ZodObject') return { key, kind: 'repeatable', required: !optional, itemFields: objectFields(element as z.ZodObject<z.ZodRawShape>), ...bounds };
  return { key, kind: 'unsupported', required: !optional };
}

function fieldOf(key: string, schema: z.ZodTypeAny): BlockFormField {
  const { inner, optional, defaultValue } = unwrap(schema);
  switch (typeNameOf(inner)) {
    case 'ZodString':
      return stringField(key, inner as z.ZodString, optional);
    case 'ZodBoolean':
      return { key, kind: 'boolean', required: !optional, ...(typeof defaultValue === 'boolean' ? { defaultValue } : {}) };
    case 'ZodArray':
      return { ...arrayField(key, inner, optional), ...(Array.isArray(defaultValue) ? { defaultValue: defaultValue as string[] } : {}) };
    default:
      return { key, kind: 'unsupported', required: !optional };
  }
}

function objectFields(schema: z.ZodObject<z.ZodRawShape>): BlockFormField[] {
  return Object.entries(schema.shape).map(([key, value]) => fieldOf(key, value));
}

/** The form fields of one block type, derived from its schema in `BLOCK_SCHEMAS`. */
export function deriveBlockFormSpec(type: BlockType): BlockFormSpec {
  const shape = (BLOCK_SCHEMAS[type] as unknown as z.ZodObject<z.ZodRawShape>).shape;
  const config = unwrap(shape.config).inner as z.ZodObject<z.ZodRawShape>;
  const text = unwrap(shape.text).inner;
  const textValue = unwrap((text._def as { valueType: z.ZodTypeAny }).valueType).inner as z.ZodObject<z.ZodRawShape>;
  return { type, config: objectFields(config), text: objectFields(textValue) };
}

/** Every block type's spec, for tests and for an editor that wants them all. */
export function deriveAllBlockFormSpecs(): BlockFormSpec[] {
  return BLOCK_TYPES.map((type) => deriveBlockFormSpec(type));
}
