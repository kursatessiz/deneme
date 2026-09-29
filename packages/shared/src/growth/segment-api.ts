import { z } from 'zod';
import type { LifecycleStage } from './conversions';
import { SEGMENT_FIELDS, SegmentGroupSchema } from './segments';
import type { BuiltInSegmentField, SegmentFieldKind, SegmentGroup } from './segments';

/**
 * Segment API contracts (G2a, docs/KAMPANYA_VE_AKISLAR.md). A DYNAMIC
 * segment is a stored rule set (the section 3.5 DSL) whose membership the
 * API recomputes in the background; a STATIC segment is a fixed list of
 * contacts that staff add and remove by hand (optionally seeded once from
 * rules).
 */

export const SEGMENT_KINDS = ['DYNAMIC', 'STATIC'] as const;
export type SegmentKind = (typeof SEGMENT_KINDS)[number];

/**
 * Built-in fields the evaluator cannot answer yet. The shared validator
 * accepts them (the DSL is stable), the API rejects them with this reason.
 */
export const UNAVAILABLE_SEGMENT_FIELDS: Partial<Record<BuiltInSegmentField, string>> = {
  'loyalty.pointsBalance': 'Sadakat puanı alanı sadakat modülüyle (G3a) etkinleşecek',
};

/** Field groups for the segment builder UI; labels are i18n keys segments.field.<field>. */
export const SEGMENT_FIELD_GROUPS: readonly { key: string; fields: readonly BuiltInSegmentField[] }[] = [
  {
    key: 'contact',
    fields: [
      'contact.lifecycleStage',
      'contact.tags',
      'contact.locale',
      'contact.countryCode',
      'contact.createdAt',
      'contact.birthdayInDays',
      'contact.ownerId',
      'contact.homeBranchId',
    ],
  },
  { key: 'consent', fields: ['consent.commercialAllowed'] },
  {
    key: 'activity',
    fields: ['activity.lastAttendedDaysAgo', 'activity.attendedLast30Days', 'activity.attendedTotal', 'activity.noShowsLast30Days'],
  },
  { key: 'package', fields: ['package.hasActive', 'package.expiresInDays', 'package.remainingUnits'] },
  { key: 'payment', fields: ['payment.totalSpent', 'payment.lastPaidDaysAgo'] },
  { key: 'attribution', fields: ['attribution.firstSource', 'attribution.firstCampaignId', 'attribution.lastSource'] },
  { key: 'churn', fields: ['churn.riskLevel'] },
];

export function segmentFieldKind(field: string, customFieldKinds: Readonly<Record<string, SegmentFieldKind>> = {}): SegmentFieldKind | null {
  if (field.startsWith('custom.')) return customFieldKinds[field.slice('custom.'.length)] ?? null;
  return (SEGMENT_FIELDS as Record<string, SegmentFieldKind>)[field] ?? null;
}

const NameSchema = z.string().trim().min(1, 'Ad giriniz').max(120);

export const CreateSegmentSchema = z
  .object({
    name: NameSchema,
    description: z.string().trim().max(500).optional(),
    kind: z.enum(SEGMENT_KINDS).default('DYNAMIC'),
    rules: SegmentGroupSchema.optional(),
    /** STATIC only: take the rule result once as the initial member list. */
    seedFromRules: z.boolean().optional(),
  })
  .strict()
  .refine((v) => v.kind === 'STATIC' || v.rules !== undefined, { message: 'Dinamik segment için kural giriniz', path: ['rules'] });
export type CreateSegmentInput = z.infer<typeof CreateSegmentSchema>;

export const UpdateSegmentSchema = z
  .object({
    name: NameSchema.optional(),
    description: z.string().trim().max(500).nullable().optional(),
    rules: SegmentGroupSchema.optional(),
  })
  .strict();
export type UpdateSegmentInput = z.infer<typeof UpdateSegmentSchema>;

export const SegmentPreviewSchema = z.object({ rules: SegmentGroupSchema }).strict();
export type SegmentPreviewInput = z.infer<typeof SegmentPreviewSchema>;

export const SegmentMembersSchema = z
  .object({
    add: z.array(z.string().uuid()).max(500).default([]),
    remove: z.array(z.string().uuid()).max(500).default([]),
  })
  .strict();
export type SegmentMembersInput = z.infer<typeof SegmentMembersSchema>;

export const SegmentContactsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();
export type SegmentContactsQuery = z.infer<typeof SegmentContactsQuerySchema>;

export interface SegmentDTO {
  id: string;
  name: string;
  description: string | null;
  kind: SegmentKind;
  rules: SegmentGroup | null;
  cachedCount: number;
  refreshedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SegmentContactSampleDTO {
  id: string;
  fullName: string;
  lifecycleStage: LifecycleStage;
  tags: string[];
}

export interface SegmentPreviewDTO {
  count: number;
  sample: SegmentContactSampleDTO[];
}

export interface SegmentContactsDTO {
  items: SegmentContactSampleDTO[];
  total: number;
  page: number;
  limit: number;
}

/** Custom fields the builder can offer (tenant ContactFieldDefinition rows). */
export interface SegmentFieldCatalogueDTO {
  groups: { key: string; fields: { field: string; kind: SegmentFieldKind; available: boolean }[] }[];
  custom: { field: string; kind: SegmentFieldKind; label: Record<string, string>; options: string[] }[];
}
