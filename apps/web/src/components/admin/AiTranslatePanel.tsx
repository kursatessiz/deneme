'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { BASE_MESSAGES, isActiveTranslationJob, type AiSettingsDTO, type TranslationJobDTO } from '@platform/shared';
import { useLocale, useT } from '@/components/i18n/I18nProvider';
import { bffFetch } from '@/lib/session/client';
import { aiErrorText } from '@/lib/ai/errors';
import { Accordion, AccordionItem } from '@/components/ui/Accordion';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { Checkbox } from '@/components/ui/Checkbox';

const POLL_MS = 2000;

/**
 * "Yapay zeka ile çevir" in the language CMS (G3b): pick sections (or all),
 * optionally overwrite existing values after a confirmation, start a
 * background job and follow its progress live; cancel while it runs.
 */
export function AiTranslatePanel({ code, onProgress }: { code: string; onProgress: () => void }) {
  const t = useT();
  const locale = useLocale();
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [job, setJob] = useState<TranslationJobDTO | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [overwrite, setOverwrite] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const namespaces = useMemo(() => [...new Set(Object.keys(BASE_MESSAGES).map((k) => k.split('.')[0]))].sort(), []);

  useEffect(() => {
    bffFetch<AiSettingsDTO>('admin/ai/settings')
      .then((s) => setConfigured(s.configured))
      .catch(() => setConfigured(false));
    bffFetch<{ items: TranslationJobDTO[] }>(`admin/i18n/languages/${encodeURIComponent(code)}/ai-translate/jobs`)
      .then((res) => setJob(res.items[0] ?? null))
      .catch(() => setJob(null));
  }, [code]);

  const active = job !== null && isActiveTranslationJob(job.status);
  const refresh = useCallback(async () => {
    if (!job) return;
    try {
      const next = await bffFetch<TranslationJobDTO>(`admin/ai/translation-jobs/${job.id}`);
      if (next.done !== job.done || next.status !== job.status) onProgress();
      setJob(next);
    } catch {
      // Keep the last known state; the next poll tries again.
    }
  }, [job, onProgress]);

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [active, refresh]);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const created = await bffFetch<TranslationJobDTO>(`admin/i18n/languages/${encodeURIComponent(code)}/ai-translate`, {
        method: 'POST',
        body: { namespaces: selected, overwrite, ...(overwrite ? { confirmOverwrite: true } : {}) },
      });
      setJob(created);
      setConfirming(false);
    } catch (err) {
      setError(aiErrorText(err, t) || t('adminI18n.ai.startError'));
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (!job) return;
    setBusy(true);
    try {
      setJob(await bffFetch<TranslationJobDTO>(`admin/ai/translation-jobs/${job.id}/cancel`, { method: 'POST' }));
      onProgress();
    } catch (err) {
      setError(aiErrorText(err, t));
    } finally {
      setBusy(false);
    }
  }

  const toggle = (ns: string) => setSelected((prev) => (prev.includes(ns) ? prev.filter((n) => n !== ns) : [...prev, ns]));
  const money = (microUsd: number) =>
    new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(microUsd / 1_000_000);
  const percent = job && job.total > 0 ? Math.round(((job.done + job.failed + job.skipped) / job.total) * 100) : 0;

  return (
    <Card as="section" aria-labelledby="ai-translate-title">
      <CardContent>
        <h3 id="ai-translate-title" className="ui-heading">
          {t('adminI18n.ai.title')}
        </h3>
        <p className="ui-caption">{t('adminI18n.ai.hint')}</p>
        {configured === false && (
          <p className="ui-caption ui-text-error" role="note">
            {t('adminI18n.ai.notConfigured')}
          </p>
        )}

        {!active && configured && (
          <div className="grid gap-3">
            <fieldset className="grid gap-1">
              <legend className="ui-small ui-strong">{t('adminI18n.ai.namespaces')}</legend>
              <Checkbox label={t('adminI18n.ai.allNamespaces')} checked={selected.length === 0} onChange={() => setSelected([])} />
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                {namespaces.map((ns) => (
                  <Checkbox key={ns} className="ui-mono" label={ns} checked={selected.includes(ns)} onChange={() => toggle(ns)} />
                ))}
              </div>
            </fieldset>
            <Checkbox
              label={t('adminI18n.ai.overwrite')}
              checked={overwrite}
              onChange={(e) => {
                setOverwrite(e.target.checked);
                setConfirming(false);
              }}
            />
            {confirming ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="ui-small">{t('adminI18n.ai.overwriteConfirm')}</span>
                <Button variant="outline" tone="error" size="sm" onClick={start} disabled={busy}>
                  {t('adminI18n.ai.start')}
                </Button>
                <Button variant="outline" tone="surface" size="sm" onClick={() => setConfirming(false)}>
                  {t('common.cancel')}
                </Button>
              </div>
            ) : (
              <Button className="justify-self-start" onClick={() => (overwrite ? setConfirming(true) : void start())} disabled={busy}>
                {t('adminI18n.ai.start')}
              </Button>
            )}
          </div>
        )}

        {error && (
          <p className="ui-caption ui-text-error" role="alert">
            {error}
          </p>
        )}

        {job && (
          <div className="grid gap-2" data-testid="ai-translate-job">
            <p className="ui-strong">{t(`adminI18n.ai.status.${job.status}`)}</p>
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
              aria-label={t('adminI18n.ai.progress', { done: job.done, total: job.total })}
              className="h-2 w-full overflow-hidden ui-panel"
            >
              <div className="h-full ui-bar-fill" style={{ width: `${percent}%` }} />
            </div>
            <p className="ui-small">
              {t('adminI18n.ai.progress', { done: job.done, total: job.total })}
              {job.failed > 0 && ` · ${t('adminI18n.ai.failedCount', { count: job.failed })}`}
              {job.skipped > 0 && ` · ${t('adminI18n.ai.skippedCount', { count: job.skipped })}`}
              {` · ${t('adminI18n.ai.cost', { amount: money(job.costMicroUsd) })}`}
            </p>
            {job.lastErrorCode && <p className="ui-caption">{t(`ai.error.${job.lastErrorCode}`)}</p>}
            {active && (
              <div className="flex items-center gap-3">
                <Button variant="outline" tone="surface" size="sm" onClick={cancel} disabled={busy}>
                  {t('adminI18n.ai.cancel')}
                </Button>
                <span className="ui-caption">{t('adminI18n.ai.backgroundHint')}</span>
              </div>
            )}
            {job.failures.length > 0 && (
              <Accordion>
                <AccordionItem title={t('adminI18n.ai.failures')}>
                  <ul className="ui-mono grid gap-0.5">
                    {job.failures.map((f) => (
                      <li key={f.key}>
                        {f.key}: {f.errorCode.startsWith('AI_') ? t(`ai.error.${f.errorCode}`) : t(`adminI18n.ai.reason.${f.errorCode}`)}
                      </li>
                    ))}
                  </ul>
                </AccordionItem>
              </Accordion>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
