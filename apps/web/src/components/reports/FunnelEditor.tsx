'use client';

import { useState } from 'react';
import { CONVERSION_EVENT_TYPES, FUNNEL_MAX_STEPS, FUNNEL_MAX_WINDOW_DAYS, FUNNEL_MIN_STEPS } from '@platform/shared';
import type { ConversionEventType, FunnelSummaryDTO, MessageKey } from '@platform/shared';
import { useDashboardSession } from '@/components/session/DashboardSessionProvider';
import { useT } from '@/components/i18n/I18nProvider';
import { bffFetch, BffError } from '@/lib/session/client';
import { Modal } from '@/components/common/Modal';

const fieldStyle: React.CSSProperties = {
  borderRadius: 'var(--radius-input)',
  border: '1px solid var(--color-border)',
  backgroundColor: 'var(--color-surface)',
  color: 'var(--color-text-primary)',
};

const buttonStyle: React.CSSProperties = {
  borderRadius: 'var(--radius-button)',
  border: '1px solid var(--color-border)',
  backgroundColor: 'var(--color-surface-muted)',
  color: 'var(--color-text-primary)',
};

/** Creates or edits a tenant funnel: a name, 2-6 distinct event types in order and an optional step-to-step window. */
export function FunnelEditor({ funnel, onClose, onSaved }: { funnel: FunnelSummaryDTO | null; onClose: () => void; onSaved: (saved: FunnelSummaryDTO) => void }) {
  const t = useT();
  const { activeStudioId } = useDashboardSession();
  const [name, setName] = useState(funnel?.name ?? '');
  const [steps, setSteps] = useState<ConversionEventType[]>(() => (funnel ? (funnel.steps.filter((s) => s !== 'visit') as ConversionEventType[]) : ['lead', 'purchase']));
  const [windowDays, setWindowDays] = useState(funnel?.windowDays === null || funnel?.windowDays === undefined ? '' : String(funnel.windowDays));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const windowValue = windowDays.trim() === '' ? null : Number(windowDays);
  const windowValid = windowValue === null || (Number.isInteger(windowValue) && windowValue >= 1 && windowValue <= FUNNEL_MAX_WINDOW_DAYS);
  const valid = name.trim().length > 0 && steps.length >= FUNNEL_MIN_STEPS && steps.length <= FUNNEL_MAX_STEPS && new Set(steps).size === steps.length && windowValid;

  const setStep = (index: number, value: ConversionEventType) => setSteps((prev) => prev.map((s, i) => (i === index ? value : s)));
  const move = (index: number, delta: number) =>
    setSteps((prev) => {
      const target = index + delta;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  const addStep = () => {
    const unused = CONVERSION_EVENT_TYPES.find((type) => !steps.includes(type));
    if (unused && steps.length < FUNNEL_MAX_STEPS) setSteps([...steps, unused]);
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!activeStudioId || !valid) {
      setError(t('funnels.editor.invalid'));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const body = { name: name.trim(), steps, windowDays: windowValue };
      const saved = funnel
        ? await bffFetch<FunnelSummaryDTO>(`studios/${activeStudioId}/funnels/${funnel.id}`, { method: 'PATCH', studioId: activeStudioId, body })
        : await bffFetch<FunnelSummaryDTO>(`studios/${activeStudioId}/funnels`, { method: 'POST', studioId: activeStudioId, body });
      onSaved(saved);
    } catch (err) {
      setError(err instanceof BffError ? err.message : t('funnels.editor.saveFailed'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={funnel ? t('funnels.editor.edit') : t('funnels.editor.new')} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <label className="block text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
          {t('funnels.editor.name')}
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} className="mt-1 w-full text-sm px-2.5 py-1.5" style={fieldStyle} />
        </label>

        <fieldset className="space-y-2">
          <legend className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
            {t('funnels.editor.steps')}
          </legend>
          {steps.map((step, index) => (
            <div key={index} className="flex items-center gap-2">
              <select
                value={step}
                onChange={(e) => setStep(index, e.target.value as ConversionEventType)}
                aria-label={t('funnels.editor.stepN', { n: index + 1 })}
                className="flex-1 text-sm px-2.5 py-1.5"
                style={fieldStyle}
              >
                {CONVERSION_EVENT_TYPES.map((type) => (
                  <option key={type} value={type} disabled={type !== step && steps.includes(type)}>
                    {t(`funnels.step.${type}` as MessageKey)}
                  </option>
                ))}
              </select>
              <button type="button" onClick={() => move(index, -1)} disabled={index === 0} aria-label={t('funnels.editor.moveUp')} className="text-xs px-2 py-1.5 disabled:opacity-40" style={buttonStyle}>
                {t('funnels.editor.moveUp')}
              </button>
              <button type="button" onClick={() => move(index, 1)} disabled={index === steps.length - 1} aria-label={t('funnels.editor.moveDown')} className="text-xs px-2 py-1.5 disabled:opacity-40" style={buttonStyle}>
                {t('funnels.editor.moveDown')}
              </button>
              <button
                type="button"
                onClick={() => setSteps(steps.filter((_, i) => i !== index))}
                disabled={steps.length <= FUNNEL_MIN_STEPS}
                aria-label={t('funnels.editor.removeStep')}
                className="text-xs px-2 py-1.5 disabled:opacity-40"
                style={buttonStyle}
              >
                {t('funnels.editor.removeStep')}
              </button>
            </div>
          ))}
          <button type="button" onClick={addStep} disabled={steps.length >= FUNNEL_MAX_STEPS} className="text-xs font-medium px-3 py-1.5 disabled:opacity-40" style={buttonStyle}>
            {t('funnels.editor.addStep')}
          </button>
        </fieldset>

        <label className="block text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
          {t('funnels.editor.window')}
          <input
            type="number"
            min={1}
            max={FUNNEL_MAX_WINDOW_DAYS}
            value={windowDays}
            onChange={(e) => setWindowDays(e.target.value)}
            className="mt-1 w-32 text-sm px-2.5 py-1.5 block"
            style={fieldStyle}
          />
          <span className="block mt-1 font-normal" style={{ color: 'var(--color-text-muted)' }}>
            {t('funnels.editor.windowHint')}
          </span>
        </label>

        {error && (
          <p role="alert" className="text-xs" style={{ color: '#b42318' }}>
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="text-xs font-medium px-3.5 py-2" style={buttonStyle}>
            {t('funnels.editor.cancel')}
          </button>
          <button
            type="submit"
            disabled={submitting || !valid}
            className="text-xs font-medium px-3.5 py-2 disabled:opacity-50"
            style={{ borderRadius: 'var(--radius-button)', background: 'var(--gradient-brand)', color: 'var(--color-on-primary)' }}
          >
            {t('funnels.editor.save')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
