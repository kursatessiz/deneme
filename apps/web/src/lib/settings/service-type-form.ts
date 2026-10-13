import { CreateServiceTypeSchema, UpdateServiceTypeSchema, EntitlementKind, HealthActivityType } from '@platform/shared';
import type { CreateServiceTypeInput, ServiceTypeDTO, UpdateServiceTypeInput } from '@platform/shared';
import { validationText } from '@/lib/i18n/client-translator';

export interface ServiceTypeFormValues {
  name: string;
  description: string;
  durationMin: string;
  capacity: string;
  minRepeatIntervalDays: string;
  prerequisiteFormId: string;
  cancellationPolicyId: string;
  commissionRuleId: string;
  healthActivityType: HealthActivityType;
  allowedEntitlementKinds: EntitlementKind[];
  requiresQualification: boolean;
  /** resourceTypeId -> quantity (as typed). A key present means the resource type is required. */
  resourceQuantities: Record<string, string>;
  qualifiedTrainerIds: string[];
}

export type ServiceTypeFieldErrors = Partial<Record<string, string>>;

export function emptyServiceTypeForm(): ServiceTypeFormValues {
  return {
    name: '',
    description: '',
    durationMin: '60',
    capacity: '1',
    minRepeatIntervalDays: '',
    prerequisiteFormId: '',
    cancellationPolicyId: '',
    commissionRuleId: '',
    healthActivityType: HealthActivityType.OTHER,
    allowedEntitlementKinds: [EntitlementKind.SESSION_COUNT],
    requiresQualification: false,
    resourceQuantities: {},
    qualifiedTrainerIds: [],
  };
}

export function serviceTypeToForm(row: ServiceTypeDTO): ServiceTypeFormValues {
  return {
    name: row.name,
    description: row.description ?? '',
    durationMin: String(row.durationMin),
    capacity: String(row.capacity),
    minRepeatIntervalDays: row.minRepeatIntervalDays ? String(row.minRepeatIntervalDays) : '',
    prerequisiteFormId: row.prerequisiteFormId ?? '',
    cancellationPolicyId: row.cancellationPolicyId ?? '',
    commissionRuleId: row.commissionRuleId ?? '',
    healthActivityType: row.healthActivityType,
    allowedEntitlementKinds: [...row.allowedEntitlementKinds],
    requiresQualification: row.requiresQualification,
    resourceQuantities: Object.fromEntries(row.requiredResourceTypes.map((r) => [r.resourceTypeId, String(r.quantity)])),
    qualifiedTrainerIds: (row.qualifiedTrainers ?? []).map((q) => q.trainerProfileId),
  };
}

/** Empty -> undefined, non-numeric -> NaN (the schema rejects it and the caller shows `numberInvalid`). */
function num(value: string): number | undefined {
  const trimmed = value.trim();
  if (trimmed === '') return undefined;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : Number.NaN;
}

function resourceList(values: ServiceTypeFormValues): { resourceTypeId: string; quantity: number }[] {
  return Object.entries(values.resourceQuantities).map(([resourceTypeId, qty]) => ({ resourceTypeId, quantity: num(qty) ?? 1 }));
}

type ParseResult<T> = { success: true; data: T } | { success: false; errors: ServiceTypeFieldErrors };

/**
 * Validates the form with the shared schemas. Field errors are keyed by the schema path root
 * (`name`, `durationMin`, ...). Rule messages (`validation.*`) are translated; other zod messages
 * (bad numbers) fall back to `numberInvalid`.
 */
function toErrors(issues: { path: PropertyKey[]; message: string }[], numberInvalid: string): ServiceTypeFieldErrors {
  const errors: ServiceTypeFieldErrors = {};
  for (const issue of issues) {
    const key = String(issue.path[0] ?? 'form');
    if (errors[key]) continue;
    errors[key] = issue.message.startsWith('validation.') ? validationText(issue.message) : numberInvalid;
  }
  return errors;
}

export function buildCreateServiceType(studioId: string, values: ServiceTypeFormValues, numberInvalid: string): ParseResult<CreateServiceTypeInput> {
  const result = CreateServiceTypeSchema.safeParse({
    studioId,
    name: values.name,
    description: values.description.trim() || undefined,
    durationMin: num(values.durationMin),
    capacity: num(values.capacity),
    minRepeatIntervalDays: num(values.minRepeatIntervalDays),
    prerequisiteFormId: values.prerequisiteFormId || undefined,
    allowedEntitlementKinds: values.allowedEntitlementKinds,
    cancellationPolicyId: values.cancellationPolicyId || undefined,
    commissionRuleId: values.commissionRuleId || undefined,
    requiresQualification: values.requiresQualification,
    healthActivityType: values.healthActivityType,
    requiredResourceTypes: resourceList(values),
  });
  if (result.success) return { success: true, data: result.data };
  return { success: false, errors: toErrors(result.error.issues, numberInvalid) };
}

export function buildUpdateServiceType(studioId: string, values: ServiceTypeFormValues, numberInvalid: string): ParseResult<UpdateServiceTypeInput> {
  // CreateServiceTypeSchema carries the user-facing rule messages (name length, entitlement), so run it first.
  const create = buildCreateServiceType(studioId, values, numberInvalid);
  if (!create.success) return create;
  const result = UpdateServiceTypeSchema.safeParse({
    studioId,
    name: values.name,
    description: values.description.trim() || null,
    durationMin: num(values.durationMin),
    capacity: num(values.capacity),
    minRepeatIntervalDays: num(values.minRepeatIntervalDays) ?? null,
    prerequisiteFormId: values.prerequisiteFormId || null,
    allowedEntitlementKinds: values.allowedEntitlementKinds,
    cancellationPolicyId: values.cancellationPolicyId || null,
    commissionRuleId: values.commissionRuleId || null,
    requiresQualification: values.requiresQualification,
    healthActivityType: values.healthActivityType,
    requiredResourceTypes: resourceList(values),
  });
  if (result.success) return { success: true, data: result.data };
  return { success: false, errors: toErrors(result.error.issues, numberInvalid) };
}

/** Trainer ids to add and to remove so the stored qualifications match the form. */
export function diffQualifications(before: string[], after: string[]): { add: string[]; remove: string[] } {
  const b = new Set(before);
  const a = new Set(after);
  return { add: after.filter((id) => !b.has(id)), remove: before.filter((id) => !a.has(id)) };
}
