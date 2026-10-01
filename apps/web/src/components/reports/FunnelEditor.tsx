'use client';

import { useState } from 'react';
import { CONVERSION_EVENT_TYPES, FUNNEL_MAX_STEPS, FUNNEL_MAX_WINDOW_DAYS, FUNNEL_MIN_STEPS } from '@platform/shared';
import type { ConversionEventType, FunnelSummaryDTO, MessageKey } from '@platform/shared';
import { useDashboardSession } from '@/components/session/DashboardSessionProvider';
import { useT } from '@/components/i18n/I18nProvider';
import { bffFetch, BffError } from '@/lib/session/client';
import { Modal } from '@/components/common/Modal';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { FieldGroup } from '@/components/ui/FieldGroup';
import { Button } from '@/components/ui/Button';

/** Creates or edits a tenant funnel: a name, 2-6 distinct event types in order and an optional step-to-step window. */
export function FunnelEditor({
  funnel,
  onClose,
  onSaved,
}: {
  funnel: FunnelSummaryDTO | null;
  onClose: () => void;
  onSaved: (saved: FunnelSummaryDTO) => void;
}) {
  const t = useT();
  const { activeStudioId } = useDashboardSession();
  const [name, setName] = useState(funnel?.name ?? '');
  const [steps, setSteps] = useState<ConversionEventType[]>(() =>
    funnel ? (funnel.steps.filter((s) => s !== 'visit') as ConversionEventType[]) : ['lead', 'purchase'],
  );
  const [windowDays, setWindowDays] = useState(funnel?.windowDays === null || funnel?.windowDays === undefined ? '' : String(funnel.windowDays));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const windowValue = windowDays.trim() === '' ? null : Number(windowDays);
  const windowValid = windowValue === null || (Number.isInteger(windowValue) && windowValue >= 1 && windowValue <= FUNNEL_MAX_WINDOW_DAYS);
  const valid =
    name.trim().length > 0 && steps.length >= FUNNEL_MIN_STEPS && steps.length <= FUNNEL_MAX_STEPS && new Set(steps).size === steps.length && windowValid;

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
      <form onSubmit={submit} className="grid gap-4">
        <FieldGroup label={t('funnels.editor.name')}>
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} className="w-full" />
        </FieldGroup>

        <fieldset className="grid gap-2">
          <legend className="ui-caption ui-strong">{t('funnels.editor.steps')}</legend>
          {steps.map((step, index) => (
            <div key={index} className="flex items-center gap-2">
              <Select
                value={step}
                onChange={(e) => setStep(index, e.target.value as ConversionEventType)}
                aria-label={t('funnels.editor.stepN', { n: index + 1 })}
                className="flex-1"
              >
                {CONVERSION_EVENT_TYPES.map((type) => (
                  <option key={type} value={type} disabled={type !== step && steps.includes(type)}>
                    {t(`funnels.step.${type}` as MessageKey)}
                  </option>
                ))}
              </Select>
              <Button variant="link" tone="muted" size="sm" onClick={() => move(index, -1)} disabled={index === 0} aria-label={t('funnels.editor.moveUp')}>
                {t('funnels.editor.moveUp')}
              </Button>
              <Button
                variant="link"
                tone="muted"
                size="sm"
                onClick={() => move(index, 1)}
                disabled={index === steps.length - 1}
                aria-label={t('funnels.editor.moveDown')}
              >
                {t('funnels.editor.moveDown')}
              </Button>
              <Button
                variant="link"
                tone="muted"
                size="sm"
                onClick={() => setSteps(steps.filter((_, i) => i !== index))}
                disabled={steps.length <= FUNNEL_MIN_STEPS}
                aria-label={t('funnels.editor.removeStep')}
              >
                {t('funnels.editor.removeStep')}
              </Button>
            </div>
          ))}
          <Button variant="outline" tone="surface" size="sm" onClick={addStep} disabled={steps.length >= FUNNEL_MAX_STEPS} className="justify-self-start">
            {t('funnels.editor.addStep')}
          </Button>
        </fieldset>

        <FieldGroup label={t('funnels.editor.window')} hint={t('funnels.editor.windowHint')}>
          <Input type="number" min={1} max={FUNNEL_MAX_WINDOW_DAYS} value={windowDays} onChange={(e) => setWindowDays(e.target.value)} className="w-32" />
        </FieldGroup>

        {error && (
          <p role="alert" className="ui-caption ui-text-error">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" tone="surface" onClick={onClose}>
            {t('funnels.editor.cancel')}
          </Button>
          <Button type="submit" disabled={submitting || !valid}>
            {t('funnels.editor.save')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
