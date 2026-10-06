'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import {
  JOURNEY_EVENT_TRIGGERS,
  JourneyDefinitionSchema,
  MESSAGE_CHANNELS_V2,
  SEGMENT_FIELD_GROUPS,
  SEGMENT_FIELDS,
  UNAVAILABLE_JOURNEY_STEP_TYPES,
  UNAVAILABLE_SEGMENT_FIELDS,
  validateJourneyGraph,
  translateValidationMessage,
} from '@platform/shared';
import type {
  JourneyDefinition,
  JourneyDetailDTO,
  JourneyEnrollmentDTO,
  JourneyEventTrigger,
  JourneyStep,
  JourneyTrigger,
  MessageTemplateListDTO,
  SegmentDTO,
  SegmentFieldCatalogueDTO,
  SegmentFieldKind,
  SegmentGroup,
} from '@platform/shared';
import { useDashboardSession } from '@/components/session/DashboardSessionProvider';
import { useT } from '@/components/i18n/I18nProvider';
import { PermissionButton } from '@/components/common/PermissionButton';
import { Badge } from '@/components/common/Badge';
import { ErrorState, LoadingState } from '@/components/common/DataState';
import { bffFetch } from '@/lib/session/client';
import { hasAnyPermission } from '@/lib/nav';
import { EMPTY_RULES, SegmentBuilder } from './SegmentBuilder';
import { Field, Muted, Notice, PageHeader, Panel, errorMessage, useDateFormat } from './ui';
import { useAreaHref } from '@/components/session/AreaBase';
import { Input, Select } from '@/components/ui';
import { Button } from '@/components/ui/Button';

type StepType = JourneyStep['type'];
const STEP_TYPES: StepType[] = ['wait', 'send', 'branch', 'update_contact', 'create_task', 'award_points'];

/** Built-in fields only, for users who cannot read the tenant's custom field catalogue. */
const FALLBACK_CATALOGUE: SegmentFieldCatalogueDTO = {
  groups: SEGMENT_FIELD_GROUPS.map((g) => ({
    key: g.key,
    fields: g.fields.map((field) => ({ field, kind: SEGMENT_FIELDS[field] as SegmentFieldKind, available: !(field in UNAVAILABLE_SEGMENT_FIELDS) })),
  })),
  custom: [],
};

export const EMPTY_JOURNEY: JourneyDefinition = {
  trigger: { kind: 'event', event: 'lead' },
  entryStepId: 'first_wait',
  steps: { first_wait: { type: 'wait', minutes: 60, next: null } },
  reentry: 'AFTER_EXIT',
};

function newStep(type: StepType): JourneyStep {
  switch (type) {
    case 'wait':
      return { type, minutes: 60, next: null };
    case 'send':
      return { type, allowFallback: true, templateKey: 'WIN_BACK', purpose: 'COMMERCIAL', next: null };
    case 'branch':
      return { type, condition: EMPTY_RULES, ifTrue: null, ifFalse: null };
    case 'update_contact':
      return { type, addTags: [], removeTags: [], setFields: {}, next: null };
    case 'create_task':
      return { type, titleKey: '', assignTo: 'CONTACT_OWNER', dueInMinutes: 60 * 24, next: null };
    case 'award_points':
      return { type, points: 1, reasonKey: '', next: null };
  }
}

function withoutReferences(steps: Record<string, JourneyStep>, removed: string): Record<string, JourneyStep> {
  const clear = (id: string | null) => (id === removed ? null : id);
  return Object.fromEntries(
    Object.entries(steps)
      .filter(([id]) => id !== removed)
      .map(([id, s]) => [id, s.type === 'branch' ? { ...s, ifTrue: clear(s.ifTrue), ifFalse: clear(s.ifFalse) } : { ...s, next: clear(s.next) }]),
  );
}

const list = (raw: string) =>
  raw
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);

function NextSelect({ label, value, options, onChange, id }: { label: string; value: string | null; options: string[]; onChange: (v: string | null) => void; id: string }) {
  const t = useT();
  return (
    <Field label={label} htmlFor={id}>
      <Select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">{t('journeys.step.end')}</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </Select>
    </Field>
  );
}

function StepEditor({
  id,
  step,
  otherIds,
  catalogue,
  templateKeys,
  isEntry,
  onChange,
  onRemove,
  onMakeEntry,
  locked,
}: {
  id: string;
  step: JourneyStep;
  otherIds: string[];
  catalogue: SegmentFieldCatalogueDTO;
  templateKeys: string[] | null;
  isEntry: boolean;
  onChange: (next: JourneyStep) => void;
  onRemove: () => void;
  onMakeEntry: () => void;
  locked: boolean;
}) {
  const t = useT();
  const f = (name: string) => `step-${id}-${name}`;
  let body: React.ReactNode = null;
  switch (step.type) {
    case 'wait':
      body = (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Field label={t('journeys.step.minutes')} htmlFor={f('minutes')}>
            <Input
              id={f('minutes')}
              type="number"
              min={1}
              value={step.minutes ?? ''}
              onChange={(e) => onChange({ ...step, minutes: e.target.value ? Number(e.target.value) : undefined, untilLocalTime: e.target.value ? undefined : step.untilLocalTime })}
            />
          </Field>
          <Field label={t('journeys.step.untilLocalTime')} htmlFor={f('until')}>
            <Input
              id={f('until')}
              type="time"
              value={step.untilLocalTime ?? ''}
              onChange={(e) => onChange({ ...step, untilLocalTime: e.target.value || undefined, minutes: e.target.value ? undefined : step.minutes })}
            />
          </Field>
          <NextSelect id={f('next')} label={t('journeys.step.next')} value={step.next} options={otherIds} onChange={(next) => onChange({ ...step, next })} />
        </div>
      );
      break;
    case 'send':
      body = (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label={t('journeys.step.channel')} htmlFor={f('channel')}>
            <Select
              id={f('channel')}
              value={step.channel ?? ''}
              onChange={(e) => onChange({ ...step, channel: (e.target.value || undefined) as typeof step.channel })}
            >
              <option value="">{t('journeys.step.channelDefault')}</option>
              {MESSAGE_CHANNELS_V2.map((c) => (
                <option key={c} value={c}>
                  {t(`messaging.channel.${c}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('journeys.step.templateKey')} htmlFor={f('template')}>
            {templateKeys ? (
              <Select id={f('template')} value={step.templateKey ?? ''} onChange={(e) => onChange({ ...step, templateKey: e.target.value, templateId: undefined })}>
                {!templateKeys.includes(step.templateKey ?? '') && <option value={step.templateKey ?? ''}>{step.templateKey ?? ''}</option>}
                {templateKeys.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </Select>
            ) : (
              <Input
                id={f('template')}
                value={step.templateKey ?? ''}
                onChange={(e) => onChange({ ...step, templateKey: e.target.value.toUpperCase(), templateId: undefined })}
              />
            )}
          </Field>
          <Field label={t('journeys.step.purpose')} htmlFor={f('purpose')}>
            <Select id={f('purpose')} value={step.purpose} onChange={(e) => onChange({ ...step, purpose: e.target.value === 'TRANSACTIONAL' ? 'TRANSACTIONAL' : 'COMMERCIAL' })}>
              <option value="COMMERCIAL">{t('journeys.step.purpose.COMMERCIAL')}</option>
              <option value="TRANSACTIONAL">{t('journeys.step.purpose.TRANSACTIONAL')}</option>
            </Select>
          </Field>
          <NextSelect id={f('next')} label={t('journeys.step.next')} value={step.next} options={otherIds} onChange={(next) => onChange({ ...step, next })} />
        </div>
      );
      break;
    case 'branch':
      body = (
        <div className="space-y-3">
          <SegmentBuilder value={step.condition} onChange={(condition) => onChange({ ...step, condition })} catalogue={catalogue} />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <NextSelect id={f('true')} label={t('journeys.step.ifTrue')} value={step.ifTrue} options={otherIds} onChange={(ifTrue) => onChange({ ...step, ifTrue })} />
            <NextSelect id={f('false')} label={t('journeys.step.ifFalse')} value={step.ifFalse} options={otherIds} onChange={(ifFalse) => onChange({ ...step, ifFalse })} />
          </div>
        </div>
      );
      break;
    case 'update_contact':
      body = (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Field label={t('journeys.step.addTags')} htmlFor={f('add')}>
            <Input id={f('add')} defaultValue={step.addTags.join(', ')} onBlur={(e) => onChange({ ...step, addTags: list(e.target.value) })} />
          </Field>
          <Field label={t('journeys.step.removeTags')} htmlFor={f('remove')}>
            <Input id={f('remove')} defaultValue={step.removeTags.join(', ')} onBlur={(e) => onChange({ ...step, removeTags: list(e.target.value) })} />
          </Field>
          <NextSelect id={f('next')} label={t('journeys.step.next')} value={step.next} options={otherIds} onChange={(next) => onChange({ ...step, next })} />
        </div>
      );
      break;
    case 'create_task':
      body = (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Field label={t('journeys.step.taskTitle')} htmlFor={f('title')}>
            <Input
              id={f('title')}
              value={step.titleKey.startsWith('journeys.task.') ? t(step.titleKey) : step.titleKey}
              onChange={(e) => onChange({ ...step, titleKey: e.target.value })}
            />
          </Field>
          <Field label={t('journeys.step.dueInMinutes')} htmlFor={f('due')}>
            <Input id={f('due')} type="number" min={0} value={step.dueInMinutes} onChange={(e) => onChange({ ...step, dueInMinutes: Number(e.target.value) || 0 })} />
          </Field>
          <NextSelect id={f('next')} label={t('journeys.step.next')} value={step.next} options={otherIds} onChange={(next) => onChange({ ...step, next })} />
        </div>
      );
      break;
    case 'award_points':
      body = (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Field label={t('journeys.step.points')} htmlFor={f('points')}>
            <Input
              id={f('points')}
              type="number"
              min={1}
              value={step.points}
              onChange={(e) => onChange({ ...step, points: Math.max(1, Math.round(Number(e.target.value) || 1)) })}
            />
          </Field>
          <Field label={t('journeys.step.pointsReason')} htmlFor={f('reason')}>
            <Input id={f('reason')} value={step.reasonKey} maxLength={200} onChange={(e) => onChange({ ...step, reasonKey: e.target.value })} />
          </Field>
          <NextSelect id={f('next')} label={t('journeys.step.next')} value={step.next} options={otherIds} onChange={(next) => onChange({ ...step, next })} />
        </div>
      );
      break;
  }

  return (
    <li className="ui-panel p-3 space-y-3" data-testid="journey-step">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="ui-strong">
            {t(`journeys.step.${step.type}`)}
          </span>
          <code className="ui-caption">
            {id}
          </code>
          {isEntry && <Badge tone="info">{t('journeys.step.entry')}</Badge>}
        </div>
        {!locked && (
          <div className="flex gap-3">
            {!isEntry && (
              <Button variant="link" tone="muted" size="sm" type="button" onClick={onMakeEntry}>
                {t('journeys.step.entry')}
              </Button>
            )}
            <Button variant="link" tone="muted" size="sm" type="button" onClick={onRemove}>
              {t('journeys.step.remove')}
            </Button>
          </div>
        )}
      </div>
      <fieldset disabled={locked} className="space-y-3">
        {body}
      </fieldset>
    </li>
  );
}

/** Journey editor: trigger, a vertical list of steps (with branches), goal, re-entry, activation and statistics. */
export function JourneyEditor({ journeyId }: { journeyId?: string }) {
  const { activeStudioId, permissions, isOwner } = useDashboardSession();
  const t = useT();
  const areaHref = useAreaHref();
  const fmt = useDateFormat();
  const router = useRouter();
  const canManage = hasAnyPermission(['journeys.manage'], permissions, isOwner);
  const [journey, setJourney] = useState<JourneyDetailDTO | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [def, setDef] = useState<JourneyDefinition>(EMPTY_JOURNEY);
  const [catalogue, setCatalogue] = useState<SegmentFieldCatalogueDTO>(FALLBACK_CATALOGUE);
  const [segments, setSegments] = useState<SegmentDTO[]>([]);
  const [templateKeys, setTemplateKeys] = useState<string[] | null>(null);
  const [enrollments, setEnrollments] = useState<JourneyEnrollmentDTO[]>([]);
  const [newType, setNewType] = useState<StepType>('send');
  const [issues, setIssues] = useState<string[]>([]);
  const [notice, setNotice] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const base = `studios/${activeStudioId}/journeys`;

  const load = useCallback(async () => {
    if (!journeyId || !activeStudioId) return;
    try {
      const j = await bffFetch<JourneyDetailDTO>(`${base}/${journeyId}`, { studioId: activeStudioId });
      setJourney(j);
      setName(j.name);
      setDescription(j.description ?? '');
      setDef(j.definition);
      const e = await bffFetch<{ items: JourneyEnrollmentDTO[] }>(`${base}/${journeyId}/enrollments?limit=50`, { studioId: activeStudioId });
      setEnrollments(e.items);
    } catch (err) {
      setError(errorMessage(err, t('common.error.generic')));
    }
  }, [activeStudioId, base, journeyId, t]);

  useEffect(() => {
    if (!activeStudioId) return;
    bffFetch<SegmentFieldCatalogueDTO>(`studios/${activeStudioId}/segments/fields`, { studioId: activeStudioId })
      .then(setCatalogue)
      .catch(() => setCatalogue(FALLBACK_CATALOGUE));
    bffFetch<{ items: SegmentDTO[] }>(`studios/${activeStudioId}/segments`, { studioId: activeStudioId })
      .then((res) => setSegments(res.items))
      .catch(() => setSegments([]));
    bffFetch<MessageTemplateListDTO>(`studios/${activeStudioId}/messaging/templates`, { studioId: activeStudioId })
      .then((res) => setTemplateKeys([...new Set(res.items.map((i) => i.key))].sort()))
      .catch(() => setTemplateKeys(null));
    load();
  }, [activeStudioId, load]);

  const locked = !canManage || journey?.status === 'ACTIVE' || journey?.status === 'ARCHIVED';
  const stepIds = Object.keys(def.steps);

  function setTrigger(trigger: JourneyTrigger) {
    setDef({ ...def, trigger });
  }

  function addStep() {
    let n = 1;
    while (def.steps[`${newType}_${n}`]) n += 1;
    const id = `${newType}_${n}`;
    setDef({ ...def, steps: { ...def.steps, [id]: newStep(newType) } });
  }

  function validate(): JourneyDefinition | null {
    const parsed = JourneyDefinitionSchema.safeParse(def);
    if (!parsed.success) {
      setIssues(parsed.error.issues.map((i) => `${i.path.join('.')}: ${translateValidationMessage(i.message, t)}`));
      return null;
    }
    const graph = validateJourneyGraph(parsed.data);
    setIssues(graph.map((issue) => translateValidationMessage(issue, t)));
    return graph.length ? null : parsed.data;
  }

  async function save() {
    setNotice(null);
    const definition = validate();
    if (!definition) {
      setNotice({ tone: 'error', text: t('journeys.validation') });
      return;
    }
    try {
      if (journey) {
        const updated = await bffFetch<JourneyDetailDTO>(`${base}/${journey.id}`, {
          method: 'PATCH',
          studioId: activeStudioId,
          body: { name, description: description || null, definition },
        });
        setJourney({ ...journey, ...updated });
        setNotice({ tone: 'success', text: t('journeys.saved') });
      } else {
        const created = await bffFetch<JourneyDetailDTO>(base, { method: 'POST', studioId: activeStudioId, body: { name, ...(description ? { description } : {}), definition } });
        router.push(areaHref(`/akislar/${created.id}`));
      }
    } catch (err) {
      setNotice({ tone: 'error', text: errorMessage(err, t('common.error.generic')) });
    }
  }

  async function lifecycle(action: 'activate' | 'pause' | 'archive') {
    if (!journey) return;
    setNotice(null);
    try {
      await bffFetch(`${base}/${journey.id}/${action}`, { method: 'POST', studioId: activeStudioId });
      await load();
    } catch (err) {
      setNotice({ tone: 'error', text: errorMessage(err, t('common.error.generic')) });
    }
  }

  if (error) return <ErrorState message={error} />;
  if (journeyId && !journey) return <LoadingState />;

  const trigger = def.trigger;
  const event = trigger.kind === 'event' ? trigger.event : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title={journey ? journey.name : t('journeys.new')}
        subtitle={t('journeys.subtitle')}
        actions={
          <>
            {journey && <Badge tone={journey.status === 'ACTIVE' ? 'success' : 'neutral'}>{t(`journeys.status.${journey.status}`)}</Badge>}
            {journey?.legacyRuleType && <Badge tone="info">{t('journeys.legacyBadge')}</Badge>}
            {journey && journey.status !== 'ACTIVE' && journey.status !== 'ARCHIVED' && (
              <PermissionButton required={['journeys.manage']} variant="primary" onClick={() => lifecycle('activate')}>
                {t('journeys.action.activate')}
              </PermissionButton>
            )}
            {journey?.status === 'ACTIVE' && (
              <PermissionButton required={['journeys.manage']} onClick={() => lifecycle('pause')}>
                {t('journeys.action.pause')}
              </PermissionButton>
            )}
            {journey && journey.status !== 'ARCHIVED' && (
              <PermissionButton required={['journeys.manage']} variant="danger" onClick={() => lifecycle('archive')}>
                {t('journeys.action.archive')}
              </PermissionButton>
            )}
            <Link href={areaHref('/akislar')} className="pui-link pui-surface ui-caption">
              {t('journeys.title')}
            </Link>
          </>
        }
      />
      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
      {journey?.status === 'ACTIVE' && <Muted>{t('journeys.editLocked')}</Muted>}
      {issues.length > 0 && (
        <ul role="alert" className="space-y-0.5 ui-text-error ui-small">
          {issues.map((i) => (
            <li key={i}>{i}</li>
          ))}
        </ul>
      )}

      <Panel>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label={t('journeys.field.name')} htmlFor="journey-name">
            <Input id="journey-name" value={name} onChange={(e) => setName(e.target.value)} disabled={!canManage || journey?.status === 'ARCHIVED'} />
          </Field>
          <Field label={t('journeys.field.description')} htmlFor="journey-description">
            <Input id="journey-description" value={description} onChange={(e) => setDescription(e.target.value)} disabled={!canManage || journey?.status === 'ARCHIVED'} />
          </Field>
        </div>
      </Panel>

      <Panel title={t('journeys.section.trigger')} labelledBy="journey-trigger">
        <fieldset disabled={locked} className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Field label={t('journeys.section.trigger')} htmlFor="trigger-kind">
            <Select
              id="trigger-kind"
              value={trigger.kind}
              onChange={(e) =>
                setTrigger(e.target.value === 'segment_entered' ? { kind: 'segment_entered', segmentId: segments[0]?.id ?? '' } : { kind: 'event', event: 'lead' })
              }
            >
              <option value="event">{t('journeys.trigger.kind.event')}</option>
              <option value="segment_entered">{t('journeys.trigger.kind.segment_entered')}</option>
            </Select>
          </Field>
          {trigger.kind === 'segment_entered' ? (
            <Field label={t('journeys.trigger.segment')} htmlFor="trigger-segment">
              <Select id="trigger-segment" value={trigger.segmentId} onChange={(e) => setTrigger({ kind: 'segment_entered', segmentId: e.target.value })}>
                {!segments.some((s) => s.id === trigger.segmentId) && <option value={trigger.segmentId}>{trigger.segmentId}</option>}
                {segments.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : (
            <>
              <Field label={t('journeys.trigger.event')} htmlFor="trigger-event">
                <Select
                  id="trigger-event"
                  value={trigger.event}
                  onChange={(e) => {
                    const next = e.target.value as JourneyEventTrigger;
                    setTrigger({
                      kind: 'event',
                      event: next,
                      ...(trigger.filter ? { filter: trigger.filter } : {}),
                      ...(next === 'booking_upcoming' ? { leadMinutes: 120 } : {}),
                      ...(next === 'package_expiring' ? { daysBefore: 7 } : {}),
                      ...(next === 'birthday' ? { daysBefore: 0 } : {}),
                    });
                  }}
                >
                  {JOURNEY_EVENT_TRIGGERS.map((ev) => (
                    <option key={ev} value={ev}>
                      {t(`journeys.event.${ev}`)}
                    </option>
                  ))}
                </Select>
              </Field>
              {event === 'booking_upcoming' && (
                <Field label={t('journeys.trigger.leadMinutes')} htmlFor="trigger-lead">
                  <Input id="trigger-lead" type="number" min={15} value={trigger.leadMinutes ?? ''} onChange={(e) => setTrigger({ ...trigger, leadMinutes: Number(e.target.value) || undefined })} />
                </Field>
              )}
              {(event === 'package_expiring' || event === 'birthday') && (
                <Field label={t('journeys.trigger.daysBefore')} htmlFor="trigger-days">
                  <Input id="trigger-days" type="number" min={0} value={trigger.daysBefore ?? ''} onChange={(e) => setTrigger({ ...trigger, daysBefore: e.target.value === '' ? undefined : Number(e.target.value) })} />
                </Field>
              )}
              {event === 'package_expiring' && (
                <Field label={t('journeys.trigger.remainingUnitsAtMost')} htmlFor="trigger-units">
                  <Input
                    id="trigger-units"
                    type="number"
                    min={0}
                    value={trigger.remainingUnitsAtMost ?? ''}
                    onChange={(e) => setTrigger({ ...trigger, remainingUnitsAtMost: e.target.value === '' ? undefined : Number(e.target.value) })}
                  />
                </Field>
              )}
            </>
          )}
        </fieldset>
        {trigger.kind === 'event' && (
          <fieldset disabled={locked} className="space-y-2">
            <label className="inline-flex items-center gap-2 ui-small">
              <input
                type="checkbox"
                checked={Boolean(trigger.filter)}
                onChange={(e) => {
                  if (e.target.checked) {
                    setTrigger({ ...trigger, filter: EMPTY_RULES });
                  } else {
                    const { filter: _removed, ...rest } = trigger;
                    void _removed;
                    setTrigger(rest);
                  }
                }}
              />
              {t('journeys.trigger.filter')}
            </label>
            {trigger.filter && <SegmentBuilder value={trigger.filter} onChange={(filter) => setTrigger({ ...trigger, filter })} catalogue={catalogue} />}
          </fieldset>
        )}
      </Panel>

      <Panel title={t('journeys.section.steps')} labelledBy="journey-steps">
        <ol className="space-y-3" aria-label={t('journeys.section.steps')}>
          {stepIds.map((id) => (
            <StepEditor
              key={id}
              id={id}
              step={def.steps[id]}
              otherIds={stepIds.filter((s) => s !== id)}
              catalogue={catalogue}
              templateKeys={templateKeys}
              isEntry={def.entryStepId === id}
              locked={locked}
              onChange={(next) => setDef({ ...def, steps: { ...def.steps, [id]: next } })}
              onRemove={() => {
                const steps = withoutReferences(def.steps, id);
                setDef({ ...def, steps, entryStepId: def.entryStepId === id ? (Object.keys(steps)[0] ?? '') : def.entryStepId });
              }}
              onMakeEntry={() => setDef({ ...def, entryStepId: id })}
            />
          ))}
        </ol>
        {!locked && (
          <div className="flex flex-wrap items-end gap-2">
            <Field label={t('journeys.step.add')} htmlFor="new-step-type">
              <Select id="new-step-type" value={newType} onChange={(e) => setNewType(e.target.value as StepType)}>
                {STEP_TYPES.filter((s) => !(s in UNAVAILABLE_JOURNEY_STEP_TYPES)).map((s) => (
                  <option key={s} value={s}>
                    {t(`journeys.step.${s}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Button variant="outline" tone="surface" size="sm" type="button" onClick={addStep}>
              {t('journeys.step.add')}
            </Button>
          </div>
        )}
      </Panel>

      <Panel title={t('journeys.section.goal')} labelledBy="journey-goal">
        <fieldset disabled={locked} className="space-y-2">
          <label className="inline-flex items-center gap-2 ui-small">
            <input
              type="checkbox"
              checked={Boolean(def.goal)}
              onChange={(e) => {
                if (e.target.checked) setDef({ ...def, goal: EMPTY_RULES });
                else {
                  const { goal: _removed, ...rest } = def;
                  void _removed;
                  setDef(rest);
                }
              }}
            />
            {t('journeys.section.goal')}
          </label>
          {def.goal && <SegmentBuilder value={def.goal} onChange={(goal: SegmentGroup) => setDef({ ...def, goal })} catalogue={catalogue} />}
        </fieldset>
        <Field label={t('journeys.section.reentry')} htmlFor="journey-reentry">
          <Select
            id="journey-reentry"
            value={def.reentry}
            disabled={locked}
            onChange={(e) => setDef({ ...def, reentry: e.target.value as JourneyDefinition['reentry'] })}
          >
            {(['NEVER', 'AFTER_EXIT', 'ALWAYS'] as const).map((r) => (
              <option key={r} value={r}>
                {t(`journeys.reentry.${r}`)}
              </option>
            ))}
          </Select>
        </Field>
      </Panel>

      {canManage && journey?.status !== 'ARCHIVED' && (
        <PermissionButton required={['journeys.manage']} variant="primary" onClick={save} disabled={!name.trim()}>
          {t('journeys.action.save')}
        </PermissionButton>
      )}

      {journey && (
        <Panel title={t('journeys.section.stats')} labelledBy="journey-stats">
          <div className="flex flex-wrap gap-2">
            {Object.entries(journey.stats.enrollments)
              .filter(([, n]) => n > 0)
              .map(([status, n]) => (
                <Badge key={status}>{`${t(`journeys.enrollment.${status}`)}: ${fmt.number(n)}`}</Badge>
              ))}
          </div>
          {Object.keys(journey.stats.steps).length > 0 && (
            <ul className="space-y-0.5 ui-caption">
              {Object.entries(journey.stats.steps).map(([stepId, s]) => (
                <li key={stepId}>{`${stepId}: ${t('journeys.stats.done')} ${fmt.number(s.done)}, ${t('journeys.stats.skipped')} ${fmt.number(s.skipped)}, ${t('journeys.stats.failed')} ${fmt.number(s.failed)}`}</li>
              ))}
            </ul>
          )}
          {enrollments.length > 0 && (
            <div className="space-y-1">
              <p className="ui-strong ui-caption">
                {t('journeys.section.enrollments')}
              </p>
              <ul className="ui-divide">
                {enrollments.map((e) => (
                  <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                    <Link href={areaHref(`/kisiler/${encodeURIComponent(e.contactId)}`)} className="pui-link pui-surface">
                      {e.fullName}
                    </Link>
                    <span className="flex items-center gap-2">
                      <Muted>{e.currentStepId ?? fmt.dateTime(e.completedAt)}</Muted>
                      <Badge>{t(`journeys.enrollment.${e.status}`)}</Badge>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Panel>
      )}
    </div>
  );
}
