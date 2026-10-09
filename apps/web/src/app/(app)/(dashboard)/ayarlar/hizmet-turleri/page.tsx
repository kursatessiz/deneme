'use client';

import { useState } from 'react';
import { EntitlementKind, HealthActivityType } from '@platform/shared';
import type { CommissionRuleOptionDTO, MeasurementFormOptionDTO, ResourceTypeDTO, ServiceTypeDTO } from '@platform/shared';
import { useDashboardSession } from '@/components/session/DashboardSessionProvider';
import { useT } from '@/components/i18n/I18nProvider';
import { useBff } from '@/lib/session/use-bff';
import { bffFetch, BffError } from '@/lib/session/client';
import { LoadingState, EmptyState, ErrorState } from '@/components/common/DataState';
import { PageGuard } from '@/components/common/PageGuard';
import { hasAnyPermission } from '@/lib/nav';
import { InlineMessage, PrimaryButton, SecondaryButton, SettingsHeader, TextField } from '@/components/settings/ui';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Checkbox } from '@/components/ui/Checkbox';
import { FieldGroup } from '@/components/ui/FieldGroup';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { Switch } from '@/components/ui/Switch';
import { Table, Tbody, Td, Th, Thead, Tr } from '@/components/ui/Table';
import { Textarea } from '@/components/ui/Textarea';
import { useConfirm } from '@/components/ui/Confirm';
import { useToast } from '@/components/ui/ToastHost';
import {
  buildCreateServiceType,
  buildUpdateServiceType,
  diffQualifications,
  emptyServiceTypeForm,
  serviceTypeToForm,
} from '@/lib/settings/service-type-form';
import type { ServiceTypeFieldErrors, ServiceTypeFormValues } from '@/lib/settings/service-type-form';

interface CancellationPolicyOption {
  id: string;
  name: string;
  isActive: boolean;
}

interface TrainerOption {
  id: string;
  firstName: string;
  lastName: string;
}

interface Lookups {
  resourceTypes: ResourceTypeDTO[];
  policies: CancellationPolicyOption[];
  commissionRules: CommissionRuleOptionDTO[];
  forms: MeasurementFormOptionDTO[];
  /** null when the viewer cannot list trainers (no schedule.view). */
  trainers: TrainerOption[] | null;
}

function ServiceTypeDialog({
  row,
  lookups,
  onClose,
  onSaved,
}: {
  row: ServiceTypeDTO | null;
  lookups: Lookups;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const { activeStudioId } = useDashboardSession();
  const [values, setValues] = useState<ServiceTypeFormValues>(() => (row ? serviceTypeToForm(row) : emptyServiceTypeForm()));
  const [errors, setErrors] = useState<ServiceTypeFieldErrors>({});
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const initialTrainerIds = row ? serviceTypeToForm(row).qualifiedTrainerIds : [];

  const set = <K extends keyof ServiceTypeFormValues>(key: K, value: ServiceTypeFormValues[K]) => setValues((v) => ({ ...v, [key]: value }));

  const toggleKind = (kind: EntitlementKind) =>
    set('allowedEntitlementKinds', values.allowedEntitlementKinds.includes(kind) ? values.allowedEntitlementKinds.filter((k) => k !== kind) : [...values.allowedEntitlementKinds, kind]);

  const toggleResource = (id: string) =>
    setValues((v) => {
      const next = { ...v.resourceQuantities };
      if (id in next) delete next[id];
      else next[id] = '1';
      return { ...v, resourceQuantities: next };
    });

  const toggleTrainer = (id: string) =>
    set('qualifiedTrainerIds', values.qualifiedTrainerIds.includes(id) ? values.qualifiedTrainerIds.filter((x) => x !== id) : [...values.qualifiedTrainerIds, id]);

  const save = async () => {
    setFormError(null);
    const numberInvalid = t('serviceTypes.errors.numberInvalid');
    setSaving(true);
    try {
      let serviceTypeId: string;
      if (row) {
        const parsed = buildUpdateServiceType(activeStudioId, values, numberInvalid);
        if (!parsed.success) {
          setErrors(parsed.errors);
          return;
        }
        setErrors({});
        await bffFetch(`catalog/service-types/${row.id}`, { method: 'PATCH', body: parsed.data, studioId: activeStudioId });
        serviceTypeId = row.id;
      } else {
        const parsed = buildCreateServiceType(activeStudioId, values, numberInvalid);
        if (!parsed.success) {
          setErrors(parsed.errors);
          return;
        }
        setErrors({});
        const created = await bffFetch<{ id: string }>('catalog/service-types', { method: 'POST', body: parsed.data, studioId: activeStudioId });
        serviceTypeId = created.id;
      }
      if (lookups.trainers) {
        const { add, remove } = diffQualifications(initialTrainerIds, values.qualifiedTrainerIds);
        try {
          for (const trainerProfileId of add) {
            await bffFetch(`catalog/service-types/${serviceTypeId}/qualifications`, {
              method: 'POST',
              body: { studioId: activeStudioId, trainerProfileId },
              studioId: activeStudioId,
            });
          }
          for (const trainerProfileId of remove) {
            await bffFetch(`catalog/service-types/${serviceTypeId}/qualifications/${trainerProfileId}`, { method: 'DELETE', studioId: activeStudioId });
          }
        } catch (err) {
          toast.error(err instanceof BffError ? err.message : t('serviceTypes.errors.qualificationsFailed'));
        }
      }
      toast.show(t('serviceTypes.saved'));
      onSaved();
    } catch (err) {
      setFormError(err instanceof BffError ? err.message : t('serviceTypes.errors.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const activePolicies = lookups.policies.filter((p) => p.isActive || p.id === values.cancellationPolicyId);

  return (
    <Modal
      open
      wide
      title={row ? t('serviceTypes.editTitle', { name: row.name }) : t('serviceTypes.createTitle')}
      closeLabel={t('common.close')}
      onClose={onClose}
      footer={
        <>
          <SecondaryButton onClick={onClose} disabled={saving}>
            {t('common.cancel')}
          </SecondaryButton>
          <Button onClick={save} disabled={saving}>
            {saving ? t('serviceTypes.saving') : t('common.save')}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <TextField label={t('serviceTypes.field.name')} value={values.name} onChange={(v) => set('name', v)} error={errors.name} />
          <TextField
            label={t('serviceTypes.field.durationMin')}
            type="number"
            value={values.durationMin}
            onChange={(v) => set('durationMin', v)}
            error={errors.durationMin}
          />
          <TextField label={t('serviceTypes.field.capacity')} type="number" value={values.capacity} onChange={(v) => set('capacity', v)} error={errors.capacity} />
          <FieldGroup label={t('serviceTypes.field.minRepeatIntervalDays')} hint={t('serviceTypes.field.minRepeatIntervalDays.hint')} error={errors.minRepeatIntervalDays}>
            <Input
              type="number"
              min={1}
              value={values.minRepeatIntervalDays}
              invalid={!!errors.minRepeatIntervalDays}
              onChange={(e) => set('minRepeatIntervalDays', e.target.value)}
            />
          </FieldGroup>
        </div>

        <FieldGroup label={t('serviceTypes.field.description')} error={errors.description}>
          <Textarea rows={2} value={values.description} invalid={!!errors.description} onChange={(e) => set('description', e.target.value)} />
        </FieldGroup>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FieldGroup label={t('serviceTypes.field.cancellationPolicyId')}>
            <Select value={values.cancellationPolicyId} onChange={(e) => set('cancellationPolicyId', e.target.value)}>
              <option value="">{t('serviceTypes.none')}</option>
              {activePolicies.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </FieldGroup>
          <FieldGroup label={t('serviceTypes.field.commissionRuleId')}>
            <Select value={values.commissionRuleId} onChange={(e) => set('commissionRuleId', e.target.value)}>
              <option value="">{t('serviceTypes.none')}</option>
              {lookups.commissionRules.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
          </FieldGroup>
          <FieldGroup label={t('serviceTypes.field.prerequisiteFormId')}>
            <Select value={values.prerequisiteFormId} onChange={(e) => set('prerequisiteFormId', e.target.value)}>
              <option value="">{t('serviceTypes.none')}</option>
              {lookups.forms.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </Select>
          </FieldGroup>
          <FieldGroup label={t('serviceTypes.field.healthActivityType')} hint={t('serviceTypes.field.healthActivityType.hint')}>
            <Select value={values.healthActivityType} onChange={(e) => set('healthActivityType', e.target.value as HealthActivityType)}>
              {Object.values(HealthActivityType).map((kind) => (
                <option key={kind} value={kind}>
                  {t(`serviceTypes.health.${kind}`)}
                </option>
              ))}
            </Select>
          </FieldGroup>
        </div>

        <fieldset className="grid gap-2">
          <legend className="ui-strong">{t('serviceTypes.field.allowedEntitlementKinds')}</legend>
          <div className="flex flex-wrap gap-4">
            {Object.values(EntitlementKind).map((kind) => (
              <Checkbox
                key={kind}
                label={t(`serviceTypes.entitlement.${kind}`)}
                checked={values.allowedEntitlementKinds.includes(kind)}
                onChange={() => toggleKind(kind)}
              />
            ))}
          </div>
          {errors.allowedEntitlementKinds && <InlineMessage text={errors.allowedEntitlementKinds} tone="error" />}
        </fieldset>

        <fieldset className="grid gap-2">
          <legend className="ui-strong">{t('serviceTypes.field.requiredResourceTypes')}</legend>
          <p className="ui-caption">{t('serviceTypes.field.requiredResourceTypes.hint')}</p>
          {lookups.resourceTypes.length === 0 && <p className="ui-caption">{t('serviceTypes.noResourceTypes')}</p>}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {lookups.resourceTypes.map((rt) => {
              const selected = rt.id in values.resourceQuantities;
              return (
                <div key={rt.id} className="flex items-center gap-3">
                  <Checkbox label={rt.name} checked={selected} onChange={() => toggleResource(rt.id)} />
                  {selected && (
                    <Input
                      type="number"
                      min={1}
                      className="w-20"
                      aria-label={t('serviceTypes.field.resourceQuantity', { name: rt.name })}
                      value={values.resourceQuantities[rt.id]}
                      onChange={(e) => setValues((v) => ({ ...v, resourceQuantities: { ...v.resourceQuantities, [rt.id]: e.target.value } }))}
                    />
                  )}
                </div>
              );
            })}
          </div>
          {errors.requiredResourceTypes && <InlineMessage text={errors.requiredResourceTypes} tone="error" />}
        </fieldset>

        <Switch label={t('serviceTypes.field.requiresQualification')} checked={values.requiresQualification} onCheckedChange={(v) => set('requiresQualification', v)} />

        {lookups.trainers && (
          <fieldset className="grid gap-2">
            <legend className="ui-strong">{t('serviceTypes.field.qualifiedTrainers')}</legend>
            <p className="ui-caption">{t('serviceTypes.field.qualifiedTrainers.hint')}</p>
            {lookups.trainers.length === 0 && <p className="ui-caption">{t('serviceTypes.noTrainers')}</p>}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {lookups.trainers.map((tr) => (
                <Checkbox
                  key={tr.id}
                  label={`${tr.firstName} ${tr.lastName}`}
                  checked={values.qualifiedTrainerIds.includes(tr.id)}
                  onChange={() => toggleTrainer(tr.id)}
                />
              ))}
            </div>
          </fieldset>
        )}

        {formError && <InlineMessage text={formError} tone="error" />}
      </div>
    </Modal>
  );
}

function ServiceTypesSettings() {
  const t = useT();
  const toast = useToast();
  const { confirm } = useConfirm();
  const { activeStudioId, permissions, isOwner } = useDashboardSession();
  const canManage = hasAnyPermission(['catalog.manage'], permissions, isOwner);
  const canListTrainers = hasAnyPermission(['schedule.view'], permissions, isOwner);
  const [refreshKey, setRefreshKey] = useState(0);
  const [editing, setEditing] = useState<ServiceTypeDTO | 'new' | null>(null);

  const serviceTypes = useBff<ServiceTypeDTO[]>(`catalog/service-types/studio/${activeStudioId}`, activeStudioId, refreshKey);
  const resourceTypes = useBff<ResourceTypeDTO[]>(`catalog/resource-types/studio/${activeStudioId}`, activeStudioId);
  const policies = useBff<CancellationPolicyOption[]>(`catalog/cancellation-policies/studio/${activeStudioId}`, activeStudioId);
  const commissionRules = useBff<CommissionRuleOptionDTO[]>(canManage ? `catalog/commission-rules/studio/${activeStudioId}` : null, activeStudioId);
  const forms = useBff<MeasurementFormOptionDTO[]>(canManage ? `catalog/measurement-forms/studio/${activeStudioId}` : null, activeStudioId);
  const trainers = useBff<TrainerOption[]>(canManage && canListTrainers ? `trainers/studio/${activeStudioId}` : null, activeStudioId);

  const resourceName = (id: string) => resourceTypes.data?.find((r) => r.id === id)?.name ?? '';

  const deactivate = async (row: ServiceTypeDTO) => {
    if (!(await confirm({ message: t('serviceTypes.confirmDeactivate', { name: row.name }), danger: true, confirmLabel: t('serviceTypes.deactivate') }))) return;
    try {
      await bffFetch(`catalog/service-types/${row.id}/deactivate`, { method: 'POST', body: { studioId: activeStudioId }, studioId: activeStudioId });
      toast.show(t('serviceTypes.deactivated'));
      setRefreshKey((k) => k + 1);
    } catch (err) {
      toast.error(err instanceof BffError ? err.message : t('serviceTypes.errors.deactivateFailed'));
    }
  };

  const lookupsReady = !canManage || (!resourceTypes.loading && !policies.loading && !commissionRules.loading && !forms.loading && !trainers.loading);
  const lookups: Lookups = {
    resourceTypes: resourceTypes.data ?? [],
    policies: policies.data ?? [],
    commissionRules: commissionRules.data ?? [],
    forms: forms.data ?? [],
    trainers: canManage && canListTrainers && trainers.data ? trainers.data : null,
  };
  const rows = serviceTypes.data ?? [];

  return (
    <div className="grid gap-6">
      <div className="flex items-center justify-between gap-3">
        <SettingsHeader title={t('serviceTypes.title')} description={t('serviceTypes.description')} />
        {canManage && <PrimaryButton onClick={() => setEditing('new')} disabled={!lookupsReady}>{t('serviceTypes.new')}</PrimaryButton>}
      </div>
      {!canManage && <InlineMessage text={t('serviceTypes.readOnly')} />}

      {serviceTypes.loading && <LoadingState />}
      {serviceTypes.error && <ErrorState message={serviceTypes.error} />}
      {!serviceTypes.loading && !serviceTypes.error && rows.length === 0 && (
        <EmptyState title={t('serviceTypes.empty.title')} description={t('serviceTypes.empty.description')} />
      )}
      {rows.length > 0 && (
        <Card className="overflow-x-auto">
          <Table>
            <Thead>
              <Tr>
                <Th>{t('serviceTypes.col.name')}</Th>
                <Th>{t('serviceTypes.col.duration')}</Th>
                <Th>{t('serviceTypes.col.capacity')}</Th>
                <Th>{t('serviceTypes.col.equipment')}</Th>
                <Th>{t('serviceTypes.col.status')}</Th>
                {canManage && <Th>{t('serviceTypes.col.actions')}</Th>}
              </Tr>
            </Thead>
            <Tbody>
              {rows.map((row) => (
                <Tr key={row.id} data-testid="service-type-row">
                  <Td>{row.name}</Td>
                  <Td>{t('serviceTypes.durationValue', { count: row.durationMin })}</Td>
                  <Td>{row.capacity}</Td>
                  <Td>
                    {row.requiredResourceTypes.length === 0
                      ? t('serviceTypes.noEquipment')
                      : row.requiredResourceTypes.map((r) => `${resourceName(r.resourceTypeId)} x${r.quantity}`).join(', ')}
                  </Td>
                  <Td>
                    <Badge variant={row.isActive ? 'solid' : 'soft'} tone={row.isActive ? 'success' : 'muted'}>
                      {row.isActive ? t('serviceTypes.status.active') : t('serviceTypes.status.inactive')}
                    </Badge>
                  </Td>
                  {canManage && (
                    <Td>
                      <div className="flex flex-wrap gap-2">
                        <SecondaryButton onClick={() => setEditing(row)}>{t('serviceTypes.edit')}</SecondaryButton>
                        {row.isActive && (
                          <SecondaryButton danger onClick={() => deactivate(row)}>
                            {t('serviceTypes.deactivate')}
                          </SecondaryButton>
                        )}
                      </div>
                    </Td>
                  )}
                </Tr>
              ))}
            </Tbody>
          </Table>
        </Card>
      )}

      {editing !== null && (
        <ServiceTypeDialog
          key={editing === 'new' ? 'new' : editing.id}
          row={editing === 'new' ? null : editing}
          lookups={lookups}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            setRefreshKey((k) => k + 1);
          }}
        />
      )}
    </div>
  );
}

export default function ServiceTypesSettingsPage() {
  return (
    <PageGuard required={['catalog.view', 'catalog.manage']}>
      <ServiceTypesSettings />
    </PageGuard>
  );
}
