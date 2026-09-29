'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { BASE_MESSAGES, isActiveTranslationJob, type AiSettingsDTO, type TranslationJobDTO } from '@platform/shared';
import { useLocale, useT } from '@/components/i18n/I18nProvider';
import { bffFetch } from '@/lib/session/client';
import { aiErrorText } from '@/lib/ai/errors';

const POLL_MS = 2000;

const panelStyle: React.CSSProperties = {
  borderRadius: 'var(--radius-card)',
  border: '1px solid var(--color-border)',
  backgroundColor: 'var(--color-surface)',
};
const buttonStyle: React.CSSProperties = {
  borderRadius: 'var(--radius-button)',
  border: '1px solid var(--color-border)',
  color: 'var(--color-text-secondary)',
};

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
    <section aria-labelledby="ai-translate-title" className="p-5 space-y-3" style={panelStyle}>
      <h3 id="ai-translate-title" className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
        {t('adminI18n.ai.title')}
      </h3>
      <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
        {t('adminI18n.ai.hint')}
      </p>
      {configured === false && (
        <p className="text-xs" role="note" style={{ color: 'var(--color-danger, #b42318)' }}>
          {t('adminI18n.ai.notConfigured')}
        </p>
      )}

      {!active && configured && (
        <div className="space-y-3">
          <fieldset className="space-y-1">
            <legend className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
              {t('adminI18n.ai.namespaces')}
            </legend>
            <label className="inline-flex items-center gap-1.5 text-xs mr-3">
              <input type="checkbox" checked={selected.length === 0} onChange={() => setSelected([])} />
              {t('adminI18n.ai.allNamespaces')}
            </label>
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {namespaces.map((ns) => (
                <label key={ns} className="inline-flex items-center gap-1.5 text-xs font-mono">
                  <input type="checkbox" checked={selected.includes(ns)} onChange={() => toggle(ns)} />
                  {ns}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="inline-flex items-center gap-1.5 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
            <input
              type="checkbox"
              checked={overwrite}
              onChange={(e) => {
                setOverwrite(e.target.checked);
                setConfirming(false);
              }}
            />
            {t('adminI18n.ai.overwrite')}
          </label>
          {confirming ? (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span style={{ color: 'var(--color-text-primary)' }}>{t('adminI18n.ai.overwriteConfirm')}</span>
              <button type="button" onClick={start} disabled={busy} className="px-3 py-1.5 font-medium" style={{ ...buttonStyle, color: 'var(--color-danger, #b42318)' }}>
                {t('adminI18n.ai.start')}
              </button>
              <button type="button" onClick={() => setConfirming(false)} className="px-3 py-1.5 font-medium" style={buttonStyle}>
                {t('common.cancel')}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => (overwrite ? setConfirming(true) : void start())}
              disabled={busy}
              className="px-4 py-2 text-sm font-medium disabled:opacity-40"
              style={{ borderRadius: 'var(--radius-button)', backgroundColor: 'var(--color-primary)', color: 'var(--color-on-primary)' }}
            >
              {t('adminI18n.ai.start')}
            </button>
          )}
        </div>
      )}

      {error && (
        <p className="text-xs" role="alert" style={{ color: 'var(--color-danger, #b42318)' }}>
          {error}
        </p>
      )}

      {job && (
        <div className="space-y-2" data-testid="ai-translate-job">
          <p className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>
            {t(`adminI18n.ai.status.${job.status}`)}
          </p>
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            aria-label={t('adminI18n.ai.progress', { done: job.done, total: job.total })}
            className="h-2 w-full overflow-hidden"
            style={{ borderRadius: 'var(--radius-chip)', backgroundColor: 'var(--color-surface-muted)' }}
          >
            <div className="h-full" style={{ width: `${percent}%`, backgroundColor: 'var(--color-primary)' }} />
          </div>
          <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
            {t('adminI18n.ai.progress', { done: job.done, total: job.total })}
            {job.failed > 0 && ` · ${t('adminI18n.ai.failedCount', { count: job.failed })}`}
            {job.skipped > 0 && ` · ${t('adminI18n.ai.skippedCount', { count: job.skipped })}`}
            {` · ${t('adminI18n.ai.cost', { amount: money(job.costMicroUsd) })}`}
          </p>
          {job.lastErrorCode && (
            <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              {t(`ai.error.${job.lastErrorCode}`)}
            </p>
          )}
          {active && (
            <div className="flex items-center gap-3">
              <button type="button" onClick={cancel} disabled={busy} className="px-3 py-1.5 text-xs font-medium disabled:opacity-40" style={buttonStyle}>
                {t('adminI18n.ai.cancel')}
              </button>
              <span className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                {t('adminI18n.ai.backgroundHint')}
              </span>
            </div>
          )}
          {job.failures.length > 0 && (
            <details className="text-xs">
              <summary className="cursor-pointer" style={{ color: 'var(--color-text-secondary)' }}>
                {t('adminI18n.ai.failures')}
              </summary>
              <ul className="mt-1 space-y-0.5 font-mono">
                {job.failures.map((f) => (
                  <li key={f.key}>
                    {f.key}: {f.errorCode.startsWith('AI_') ? t(`ai.error.${f.errorCode}`) : t(`adminI18n.ai.reason.${f.errorCode}`)}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </section>
  );
}
