import { z } from 'zod';
import { LIFECYCLE_STAGES } from './conversions';

/**
 * Segment rule language (section 3.5). Rules are data: the API compiles them
 * into parameterised queries, never into raw SQL text. Each condition names a
 * field from SEGMENT_FIELDS; the operator and value types are checked per
 * field kind, so an invalid rule is rejected before it reaches the database.
 */

export const SEGMENT_FIELD_KINDS = ['string', 'number', 'date', 'boolean', 'enum', 'tag', 'relative_days'] as const;
export type SegmentFieldKind = (typeof SEGMENT_FIELD_KINDS)[number];

/** Built-in fields; tenant custom fields are addressed as `custom.<key>`. */
export const SEGMENT_FIELDS = {
  'contact.lifecycleStage': 'enum',
  'contact.locale': 'string',
  'contact.countryCode': 'string',
  'contact.createdAt': 'date',
  'contact.birthdayInDays': 'number',
  'contact.tags': 'tag',
  'contact.ownerId': 'string',
  'contact.homeBranchId': 'string',
  'consent.commercialAllowed': 'boolean',
  'activity.lastAttendedDaysAgo': 'relative_days',
  'activity.attendedLast30Days': 'number',
  'activity.attendedTotal': 'number',
  'activity.noShowsLast30Days': 'number',
  'package.hasActive': 'boolean',
  'package.expiresInDays': 'relative_days',
  'package.remainingUnits': 'number',
  'payment.totalSpent': 'number',
  'payment.lastPaidDaysAgo': 'relative_days',
  'attribution.firstSource': 'string',
  'attribution.firstCampaignId': 'string',
  'attribution.lastSource': 'string',
  'churn.riskLevel': 'enum',
  'loyalty.pointsBalance': 'number',
} as const satisfies Record<string, SegmentFieldKind>;
export type BuiltInSegmentField = keyof typeof SEGMENT_FIELDS;

export const SEGMENT_ENUM_VALUES: Partial<Record<BuiltInSegmentField, readonly string[]>> = {
  'contact.lifecycleStage': LIFECYCLE_STAGES,
  'churn.riskLevel': ['LOW', 'MEDIUM', 'HIGH'],
};

export const SEGMENT_OPERATORS = {
  string: ['eq', 'neq', 'in', 'not_in', 'contains', 'is_empty', 'is_not_empty'],
  number: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between'],
  date: ['before', 'after', 'between', 'in_last_days', 'not_in_last_days'],
  boolean: ['is_true', 'is_false'],
  enum: ['in', 'not_in'],
  tag: ['has_any', 'has_all', 'has_none'],
  relative_days: ['lt', 'lte', 'gt', 'gte', 'between', 'is_empty'],
} as const satisfies Record<SegmentFieldKind, readonly string[]>;
export type SegmentOperator = (typeof SEGMENT_OPERATORS)[SegmentFieldKind][number];

const scalar = z.union([z.string().max(200), z.number().finite(), z.boolean()]);
export const SegmentValueSchema = z.union([scalar, z.array(scalar).max(200)]).optional();

const FIELD = z
  .string()
  .max(80)
  .regex(/^(custom\.[a-zA-Z][a-zA-Z0-9_]{0,39}|[a-z]+\.[a-zA-Z]+)$/);

export const SegmentConditionSchema = z
  .object({
    field: FIELD,
    op: z.string().max(30),
    value: SegmentValueSchema,
  })
  .strict();
export type SegmentCondition = z.infer<typeof SegmentConditionSchema>;

export interface SegmentGroup {
  combinator: 'and' | 'or';
  rules: Array<SegmentCondition | SegmentGroup>;
}

export const MAX_SEGMENT_DEPTH = 3;
export const MAX_SEGMENT_CONDITIONS = 40;

export const SegmentGroupSchema: z.ZodType<SegmentGroup> = z.lazy(() =>
  z
    .object({
      combinator: z.enum(['and', 'or']),
      rules: z.array(z.union([SegmentConditionSchema, SegmentGroupSchema])).min(1).max(20),
    })
    .strict(),
);

export interface SegmentValidationIssue {
  path: string;
  message: string;
}

/**
 * Structural checks the schema cannot express: known field, operator valid
 * for the field kind, value shape, depth and size limits. Custom fields are
 * validated against the tenant's definitions by the API (`customFieldKinds`).
 */
export function validateSegmentRules(
  root: SegmentGroup,
  customFieldKinds: Readonly<Record<string, SegmentFieldKind>> = {},
): SegmentValidationIssue[] {
  const issues: SegmentValidationIssue[] = [];
  let count = 0;
  const walk = (group: SegmentGroup, path: string, depth: number) => {
    if (depth > MAX_SEGMENT_DEPTH) issues.push({ path, message: 'Çok fazla iç içe grup' });
    group.rules.forEach((rule, index) => {
      const here = `${path}.rules[${index}]`;
      if ('combinator' in rule) {
        walk(rule, here, depth + 1);
        return;
      }
      count += 1;
      const kind: SegmentFieldKind | undefined = rule.field.startsWith('custom.')
        ? customFieldKinds[rule.field.slice('custom.'.length)]
        : (SEGMENT_FIELDS as Record<string, SegmentFieldKind>)[rule.field];
      if (!kind) {
        issues.push({ path: here, message: `Bilinmeyen alan: ${rule.field}` });
        return;
      }
      const ops = SEGMENT_OPERATORS[kind] as readonly string[];
      if (!ops.includes(rule.op)) {
        issues.push({ path: here, message: `${rule.field} için geçersiz işlem: ${rule.op}` });
        return;
      }
      const needsNoValue = ['is_empty', 'is_not_empty', 'is_true', 'is_false'].includes(rule.op);
      const needsList = ['in', 'not_in', 'has_any', 'has_all', 'has_none', 'between'].includes(rule.op);
      if (needsNoValue) {
        if (rule.value !== undefined) issues.push({ path: here, message: 'Bu işlem değer almaz' });
        return;
      }
      if (rule.value === undefined) {
        issues.push({ path: here, message: 'Değer gerekli' });
        return;
      }
      if (needsList !== Array.isArray(rule.value)) {
        issues.push({ path: here, message: needsList ? 'Liste değer gerekli' : 'Tek değer gerekli' });
        return;
      }
      if (rule.op === 'between' && (rule.value as unknown[]).length !== 2) {
        issues.push({ path: here, message: 'Aralık iki değer almalı' });
      }
      const allowed = (SEGMENT_ENUM_VALUES as Record<string, readonly string[] | undefined>)[rule.field];
      if (allowed) {
        const values = Array.isArray(rule.value) ? rule.value : [rule.value];
        for (const v of values) {
          if (typeof v !== 'string' || !allowed.includes(v)) {
            issues.push({ path: here, message: `Geçersiz değer: ${String(v)}` });
          }
        }
      }
    });
  };
  walk(root, 'root', 1);
  if (count > MAX_SEGMENT_CONDITIONS) issues.push({ path: 'root', message: 'Çok fazla koşul' });
  return issues;
}
