'use client';

import { useEffect, useId, useState } from 'react';
import { MAX_SEGMENT_DEPTH, SEGMENT_ENUM_VALUES, SEGMENT_OPERATORS, segmentFieldKind } from '@platform/shared';
import type { SegmentCondition, SegmentFieldCatalogueDTO, SegmentFieldKind, SegmentGroup, SegmentPreviewDTO } from '@platform/shared';
import { useLocale, useT } from '@/components/i18n/I18nProvider';
import { Badge } from '@/components/common/Badge';
import { bffFetch, BffError } from '@/lib/session/client';
import { Muted, inputStyle } from './ui';

type Rule = SegmentCondition | SegmentGroup;
type Scalar = string | number | boolean;

const NO_VALUE = new Set(['is_empty', 'is_not_empty', 'is_true', 'is_false']);
const LIST_OPS = new Set(['in', 'not_in', 'has_any', 'has_all', 'has_none']);
const smallInput = 'text-xs px-2 py-1.5 outline-none';

export const DEFAULT_CONDITION: SegmentCondition = { field: 'contact.lifecycleStage', op: 'in', value: ['MEMBER'] };
export const EMPTY_RULES: SegmentGroup = { combinator: 'and', rules: [DEFAULT_CONDITION] };

function isGroup(rule: Rule): rule is SegmentGroup {
  return 'combinator' in rule;
}

/** Sensible first operator and value when the field changes. */
function defaultsFor(field: string, kind: SegmentFieldKind, options: readonly string[]): SegmentCondition {
  const op: string = SEGMENT_OPERATORS[kind][0];
  if (NO_VALUE.has(op)) return { field, op };
  if (kind === 'enum') return { field, op, value: options.slice(0, 1) };
  if (kind === 'tag') return { field, op, value: [] };
  if (op === 'between') return { field, op, value: [0, 1] };
  if (kind === 'number' || kind === 'relative_days') return { field, op, value: 0 };
  if (kind === 'date') return { field, op, value: new Date().toISOString().slice(0, 10) };
  return { field, op, value: '' };
}

function coerce(kind: SegmentFieldKind, op: string, raw: string): Scalar {
  if (kind === 'number' || kind === 'relative_days' || (kind === 'date' && (op === 'in_last_days' || op === 'not_in_last_days'))) {
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  }
  return raw;
}

function ConditionEditor({
  condition,
  catalogue,
  onChange,
  onRemove,
}: {
  condition: SegmentCondition;
  catalogue: SegmentFieldCatalogueDTO;
  onChange: (next: SegmentCondition) => void;
  onRemove: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const id = useId();
  const customKinds = Object.fromEntries(catalogue.custom.map((c) => [c.field.slice('custom.'.length), c.kind]));
  const kind = segmentFieldKind(condition.field, customKinds) ?? 'string';
  const custom = catalogue.custom.find((c) => c.field === condition.field);
  const enumOptions: readonly string[] =
    custom?.options ?? (SEGMENT_ENUM_VALUES as Record<string, readonly string[] | undefined>)[condition.field] ?? [];
  const values = condition.value === undefined ? [] : Array.isArray(condition.value) ? condition.value : [condition.value];

  const enumLabel = (v: string) => {
    if (condition.field === 'contact.lifecycleStage') return t(`crm.lifecycle.${v}`);
    if (condition.field === 'churn.riskLevel') return t(`segments.churn.${v}`);
    return v;
  };
  const fieldLabel = (field: string) => {
    const c = catalogue.custom.find((x) => x.field === field);
    return c ? (c.label[locale] ?? c.label.tr ?? field) : t(`segments.field.${field}`);
  };

  let valueEditor: React.ReactNode = null;
  if (!NO_VALUE.has(condition.op)) {
    if (kind === 'enum') {
      valueEditor = (
        <fieldset className="flex flex-wrap gap-2">
          <legend className="sr-only">{t('segments.builder.value')}</legend>
          {enumOptions.map((opt) => (
            <label key={opt} className="inline-flex items-center gap-1 text-xs" style={{ color: 'var(--color-text-primary)' }}>
              <input
                type="checkbox"
                checked={values.includes(opt)}
                onChange={(e) =>
                  onChange({ ...condition, value: e.target.checked ? [...values, opt].map(String) : values.filter((v) => v !== opt).map(String) })
                }
              />
              {enumLabel(opt)}
            </label>
          ))}
        </fieldset>
      );
    } else if (condition.op === 'between') {
      const inputType = kind === 'date' ? 'date' : 'number';
      valueEditor = (
        <div className="flex gap-2">
          {[0, 1].map((i) => (
            <input
              key={i}
              type={inputType}
              aria-label={i === 0 ? t('segments.builder.from') : t('segments.builder.to')}
              value={String(values[i] ?? '')}
              onChange={(e) => {
                const next = [...values];
                next[i] = coerce(kind, condition.op, e.target.value);
                onChange({ ...condition, value: next as Scalar[] });
              }}
              className={`${smallInput} w-28`}
              style={inputStyle}
            />
          ))}
        </div>
      );
    } else if (LIST_OPS.has(condition.op)) {
      valueEditor = (
        <input
          id={`${id}-value`}
          aria-label={t('segments.builder.valueList')}
          placeholder={t('segments.builder.valueList')}
          defaultValue={values.join(', ')}
          onBlur={(e) =>
            onChange({
              ...condition,
              value: e.target.value
                .split(',')
                .map((v) => v.trim())
                .filter(Boolean)
                .map((v) => coerce(kind, condition.op, v)) as Scalar[],
            })
          }
          className={`${smallInput} flex-1 min-w-[10rem]`}
          style={inputStyle}
        />
      );
    } else {
      const numeric = kind === 'number' || kind === 'relative_days' || condition.op === 'in_last_days' || condition.op === 'not_in_last_days';
      valueEditor = (
        <input
          aria-label={t('segments.builder.value')}
          type={numeric ? 'number' : kind === 'date' ? 'date' : 'text'}
          value={String(values[0] ?? '')}
          onChange={(e) => onChange({ ...condition, value: coerce(kind, condition.op, e.target.value) })}
          className={`${smallInput} w-40`}
          style={inputStyle}
        />
      );
    }
  }

  return (
    <li className="flex flex-wrap items-center gap-2 py-1.5" data-testid="segment-condition">
      <select
        aria-label={t('segments.builder.field')}
        value={condition.field}
        onChange={(e) => {
          const field = e.target.value;
          const nextKind = segmentFieldKind(field, customKinds) ?? 'string';
          const opts = catalogue.custom.find((c) => c.field === field)?.options ?? (SEGMENT_ENUM_VALUES as Record<string, readonly string[] | undefined>)[field] ?? [];
          onChange(defaultsFor(field, nextKind, opts));
        }}
        className={smallInput}
        style={inputStyle}
      >
        {catalogue.groups.map((g) => (
          <optgroup key={g.key} label={t(`segments.group.${g.key}`)}>
            {g.fields.map((f) => (
              <option key={f.field} value={f.field} disabled={!f.available}>
                {f.available ? t(`segments.field.${f.field}`) : `${t(`segments.field.${f.field}`)} (${t('segments.builder.notAvailable')})`}
              </option>
            ))}
          </optgroup>
        ))}
        {catalogue.custom.length > 0 && (
          <optgroup label={t('segments.group.custom')}>
            {catalogue.custom.map((c) => (
              <option key={c.field} value={c.field}>
                {fieldLabel(c.field)}
              </option>
            ))}
          </optgroup>
        )}
      </select>
      <select
        aria-label={t('segments.builder.operator')}
        value={condition.op}
        onChange={(e) => {
          const op = e.target.value;
          const base = defaultsFor(condition.field, kind, enumOptions);
          onChange(NO_VALUE.has(op) ? { field: condition.field, op } : { field: condition.field, op, value: LIST_OPS.has(op) ? (kind === 'enum' ? enumOptions.slice(0, 1) : []) : op === 'between' ? [0, 1] : base.value ?? '' });
        }}
        className={smallInput}
        style={inputStyle}
      >
        {(SEGMENT_OPERATORS[kind] as readonly string[]).map((op) => (
          <option key={op} value={op}>
            {t(`segments.op.${op}`)}
          </option>
        ))}
      </select>
      {valueEditor}
      <button type="button" onClick={onRemove} className="text-xs underline" style={{ color: 'var(--color-text-muted)' }}>
        {t('segments.builder.removeCondition')}
      </button>
    </li>
  );
}

/** A nested AND/OR rule editor over the shared segment DSL (depth and size limits come from @platform/shared). */
export function SegmentBuilder({
  value,
  onChange,
  catalogue,
  depth = 1,
  onRemove,
}: {
  value: SegmentGroup;
  onChange: (next: SegmentGroup) => void;
  catalogue: SegmentFieldCatalogueDTO;
  depth?: number;
  onRemove?: () => void;
}) {
  const t = useT();
  const setRule = (index: number, rule: Rule | null) => {
    const rules = value.rules.slice();
    if (rule === null) rules.splice(index, 1);
    else rules[index] = rule;
    onChange({ ...value, rules });
  };

  return (
    <div
      role="group"
      aria-label={depth === 1 ? t('segments.builder.title') : t('segments.builder.group')}
      className="space-y-2"
      style={depth > 1 ? { borderLeft: '2px solid var(--color-border)', paddingLeft: '0.75rem' } : undefined}
    >
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label={t('segments.builder.title')}
          value={value.combinator}
          onChange={(e) => onChange({ ...value, combinator: e.target.value === 'or' ? 'or' : 'and' })}
          className={smallInput}
          style={inputStyle}
        >
          <option value="and">{t('segments.builder.match.and')}</option>
          <option value="or">{t('segments.builder.match.or')}</option>
        </select>
        {onRemove && (
          <button type="button" onClick={onRemove} className="text-xs underline" style={{ color: 'var(--color-text-muted)' }}>
            {t('segments.builder.removeGroup')}
          </button>
        )}
      </div>
      <ul>
        {value.rules.map((rule, index) =>
          isGroup(rule) ? (
            <li key={index} className="py-1.5">
              <SegmentBuilder
                value={rule}
                catalogue={catalogue}
                depth={depth + 1}
                onChange={(next) => setRule(index, next)}
                onRemove={value.rules.length > 1 ? () => setRule(index, null) : undefined}
              />
            </li>
          ) : (
            <ConditionEditor
              key={`${index}-${rule.field}`}
              condition={rule}
              catalogue={catalogue}
              onChange={(next) => setRule(index, next)}
              onRemove={() => (value.rules.length > 1 ? setRule(index, null) : undefined)}
            />
          ),
        )}
      </ul>
      <div className="flex gap-3">
        <button type="button" onClick={() => onChange({ ...value, rules: [...value.rules, DEFAULT_CONDITION] })} className="text-xs font-medium underline" style={{ color: 'var(--color-text-secondary)' }}>
          {t('segments.builder.addCondition')}
        </button>
        {depth < MAX_SEGMENT_DEPTH && (
          <button
            type="button"
            onClick={() => onChange({ ...value, rules: [...value.rules, { combinator: 'or', rules: [DEFAULT_CONDITION] }] })}
            className="text-xs font-medium underline"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            {t('segments.builder.addGroup')}
          </button>
        )}
      </div>
    </div>
  );
}

/** Debounced live preview: audience size and a few sample contacts for the current rules. */
export function SegmentPreview({ studioId, rules }: { studioId: string; rules: SegmentGroup }) {
  const t = useT();
  const [preview, setPreview] = useState<SegmentPreviewDTO | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'invalid' | 'error'>('idle');
  const key = JSON.stringify(rules);

  useEffect(() => {
    let cancelled = false;
    setState('loading');
    const id = setTimeout(() => {
      bffFetch<SegmentPreviewDTO>(`studios/${studioId}/segments/preview`, { method: 'POST', studioId, body: { rules: JSON.parse(key) as SegmentGroup } })
        .then((res) => {
          if (cancelled) return;
          setPreview(res);
          setState('idle');
        })
        .catch((err) => {
          if (cancelled) return;
          setState(err instanceof BffError && err.status === 400 ? 'invalid' : 'error');
        });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [studioId, key]);

  return (
    <div aria-live="polite" className="space-y-2" data-testid="segment-preview">
      {state === 'loading' && <Muted>{t('segments.preview.loading')}</Muted>}
      {state === 'invalid' && <Muted>{t('segments.preview.invalid')}</Muted>}
      {state === 'error' && <Muted>{t('common.error.generic')}</Muted>}
      {state === 'idle' && preview && (
        <>
          <p className="text-lg font-semibold" style={{ color: 'var(--color-text-primary)' }}>
            {t('segments.preview.count', { count: preview.count })}
          </p>
          {preview.sample.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
                {t('segments.preview.sample')}
              </p>
              <ul className="space-y-1">
                {preview.sample.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-2 text-sm">
                    <span style={{ color: 'var(--color-text-primary)' }}>{c.fullName}</span>
                    <Badge>{t(`crm.lifecycle.${c.lifecycleStage}`)}</Badge>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
