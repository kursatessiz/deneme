'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  AI_PRICE_TABLE,
  AI_TASKS,
  type AiConnectionTestDTO,
  type AiModelPrice,
  type AiSettingsDTO,
  type AiTask,
  type AiTenantUsageRow,
  type AiUsageDashboardDTO,
  type AiUsageTotals,
} from '@platform/shared';
import { useLocale, useT } from '@/components/i18n/I18nProvider';
import { ErrorState, LoadingState } from '@/components/common/DataState';
import { bffFetch } from '@/lib/session/client';
import { aiErrorText } from '@/lib/ai/errors';

const inputStyle: React.CSSProperties = {
  borderRadius: 'var(--radius-input)',
  border: '1px solid var(--color-border)',
  backgroundColor: 'var(--color-surface)',
  color: 'var(--color-text-primary)',
};
const panelStyle: React.CSSProperties = {
  borderRadius: 'var(--radius-card)',
  border: '1px solid var(--color-border)',
  backgroundColor: 'var(--color-surface)',
};
const primaryButton: React.CSSProperties = {
  borderRadius: 'var(--radius-button)',
  backgroundColor: 'var(--color-primary)',
  color: 'var(--color-on-primary)',
};
const secondaryButton: React.CSSProperties = {
  borderRadius: 'var(--radius-button)',
  border: '1px solid var(--color-border)',
  color: 'var(--color-text-secondary)',
};
const PRICE_FIELDS = ['inputPerMTok', 'outputPerMTok', 'cacheWritePerMTok', 'cacheReadPerMTok'] as const;
const PRICE_LABELS: Record<(typeof PRICE_FIELDS)[number], string> = {
  inputPerMTok: 'adminAi.prices.input',
  outputPerMTok: 'adminAi.prices.output',
  cacheWritePerMTok: 'adminAi.prices.cacheWrite',
  cacheReadPerMTok: 'adminAi.prices.cacheRead',
};
const PERIODS = [3, 6, 12] as const;

function useFormats() {
  const locale = useLocale();
  return {
    usd: (microUsd: number) =>
      new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(microUsd / 1_000_000),
    cents: (cents: number) => new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' }).format(cents / 100),
    number: (n: number) => new Intl.NumberFormat(locale).format(n),
    date: (iso: string) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso)),
  };
}

function Section({ title, children, labelledBy }: { title: string; children: React.ReactNode; labelledBy: string }) {
  return (
    <section aria-labelledby={labelledBy} className="p-5 space-y-3" style={panelStyle}>
      <h3 id={labelledBy} className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
        {title}
      </h3>
      {children}
    </section>
  );
}

function Message({ tone, text }: { tone: 'success' | 'error'; text: string }) {
  return (
    <p className="text-xs" role={tone === 'error' ? 'alert' : 'status'} style={{ color: tone === 'error' ? 'var(--color-danger, #b42318)' : 'var(--color-success, #12a150)' }}>
      {text}
    </p>
  );
}

function KeySection({ settings, onChange }: { settings: AiSettingsDTO; onChange: (next: AiSettingsDTO) => void }) {
  const t = useT();
  const fmt = useFormats();
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      onChange(await bffFetch<AiSettingsDTO>('admin/ai/settings/key', { method: 'PUT', body: { apiKey: apiKey.trim() } }));
      setApiKey('');
      setMessage({ tone: 'success', text: t('adminAi.key.saved') });
    } catch (err) {
      setMessage({ tone: 'error', text: aiErrorText(err, t) });
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setMessage(null);
    try {
      onChange(await bffFetch<AiSettingsDTO>('admin/ai/settings/key', { method: 'DELETE' }));
      setConfirmRemove(false);
      setMessage({ tone: 'success', text: t('adminAi.key.removed') });
    } catch (err) {
      setMessage({ tone: 'error', text: aiErrorText(err, t) });
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    setMessage(null);
    try {
      const result = await bffFetch<AiConnectionTestDTO>('admin/ai/settings/test', { method: 'POST' });
      setMessage(
        result.ok
          ? { tone: 'success', text: t('adminAi.test.ok', { model: result.model }) }
          : { tone: 'error', text: t('adminAi.test.failed', { reason: t(`ai.error.${result.errorCode ?? 'AI_PROVIDER_UNAVAILABLE'}`) }) },
      );
      onChange(await bffFetch<AiSettingsDTO>('admin/ai/settings'));
    } catch (err) {
      setMessage({ tone: 'error', text: aiErrorText(err, t) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title={t('adminAi.key.title')} labelledBy="ai-key">
      <p className="text-sm" data-testid="ai-key-status" style={{ color: 'var(--color-text-primary)' }}>
        {settings.configured && settings.keyLast4 ? t('adminAi.key.configured', { last4: settings.keyLast4 }) : t('adminAi.key.none')}
      </p>
      {settings.keySource && (
        <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
          {t(`adminAi.key.source.${settings.keySource}`)}
          {settings.keyUpdatedAt && settings.keySource === 'DATABASE' ? ` · ${t('adminAi.key.updatedAt', { date: fmt.date(settings.keyUpdatedAt) })}` : ''}
          {settings.lastTestAt ? ` · ${t('adminAi.test.last', { date: fmt.date(settings.lastTestAt) })}` : ''}
        </p>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <label className="block space-y-1 flex-1 min-w-[16rem]" htmlFor="ai-api-key">
          <span className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
            {t('adminAi.key.label')}
          </span>
          <input
            id="ai-api-key"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            className="w-full text-sm px-3 py-2 font-mono"
            style={inputStyle}
          />
        </label>
        <button type="button" onClick={save} disabled={busy || apiKey.trim().length < 20} className="px-4 py-2 text-sm font-medium disabled:opacity-40" style={primaryButton}>
          {settings.keySource === 'DATABASE' ? t('adminAi.key.replace') : t('adminAi.key.save')}
        </button>
      </div>
      <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
        {t('adminAi.key.hint')}
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={test} disabled={busy || !settings.configured} className="px-3 py-1.5 text-xs font-medium disabled:opacity-40" style={secondaryButton}>
          {t('adminAi.test.button')}
        </button>
        {settings.keySource === 'DATABASE' && !confirmRemove && (
          <button type="button" onClick={() => setConfirmRemove(true)} disabled={busy} className="px-3 py-1.5 text-xs font-medium disabled:opacity-40" style={secondaryButton}>
            {t('adminAi.key.remove')}
          </button>
        )}
      </div>
      {confirmRemove && (
        <div className="flex flex-wrap items-center gap-2 text-xs" style={{ color: 'var(--color-text-primary)' }}>
          <span>{t('adminAi.key.removeConfirm')}</span>
          <button type="button" onClick={remove} disabled={busy} className="px-3 py-1.5 font-medium" style={{ ...secondaryButton, color: 'var(--color-danger, #b42318)' }}>
            {t('adminAi.key.remove')}
          </button>
          <button type="button" onClick={() => setConfirmRemove(false)} className="px-3 py-1.5 font-medium" style={secondaryButton}>
            {t('common.cancel')}
          </button>
        </div>
      )}
      {message && <Message tone={message.tone} text={message.text} />}
    </Section>
  );
}

function ModelsSection({ settings, onChange }: { settings: AiSettingsDTO; onChange: (next: AiSettingsDTO) => void }) {
  const t = useT();
  const [models, setModels] = useState<Record<AiTask, string>>(settings.models);
  const [budget, setBudget] = useState(String(settings.defaultMonthlyBudgetCents / 100));
  const [marketingBudget, setMarketingBudget] = useState(String(settings.marketingAiMonthlyBudgetCents / 100));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    setModels(settings.models);
    setBudget(String(settings.defaultMonthlyBudgetCents / 100));
    setMarketingBudget(String(settings.marketingAiMonthlyBudgetCents / 100));
  }, [settings.models, settings.defaultMonthlyBudgetCents, settings.marketingAiMonthlyBudgetCents]);

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      const cents = Math.round(Number(budget) * 100);
      const marketingCents = Math.round(Number(marketingBudget) * 100);
      onChange(
        await bffFetch<AiSettingsDTO>('admin/ai/settings', {
          method: 'PATCH',
          body: {
            models,
            ...(Number.isFinite(cents) && cents >= 0 ? { defaultMonthlyBudgetCents: cents } : {}),
            ...(Number.isFinite(marketingCents) && marketingCents >= 0 ? { marketingAiMonthlyBudgetCents: marketingCents } : {}),
          },
        }),
      );
      setMessage({ tone: 'success', text: t('adminAi.saved') });
    } catch (err) {
      setMessage({ tone: 'error', text: aiErrorText(err, t) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title={t('adminAi.models.title')} labelledBy="ai-models">
      <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
        {t('adminAi.models.hint')}
      </p>
      <datalist id="ai-known-models">
        {Object.keys(AI_PRICE_TABLE).map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {AI_TASKS.map((task) => (
          <label key={task} className="block space-y-1" htmlFor={`ai-model-${task}`}>
            <span className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
              {t(`adminAi.task.${task}`)}
            </span>
            <input
              id={`ai-model-${task}`}
              list="ai-known-models"
              value={models[task]}
              onChange={(e) => setModels({ ...models, [task]: e.target.value.trim() })}
              className="w-full text-sm px-3 py-2 font-mono"
              style={inputStyle}
            />
          </label>
        ))}
      </div>
      <h4 className="text-xs font-semibold pt-2" style={{ color: 'var(--color-text-primary)' }}>
        {t('adminAi.budget.title')}
      </h4>
      <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
        {t('adminAi.budget.hint')}
      </p>
      <label className="block space-y-1 max-w-xs" htmlFor="ai-default-budget">
        <span className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
          {t('adminAi.budget.label')}
        </span>
        <input id="ai-default-budget" type="number" min={0} step="0.01" value={budget} onChange={(e) => setBudget(e.target.value)} className="w-full text-sm px-3 py-2" style={inputStyle} />
      </label>
      <h4 className="text-xs font-semibold pt-2" style={{ color: 'var(--color-text-primary)' }}>
        {t('adminAi.marketingBudget.title')}
      </h4>
      <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
        {t('adminAi.marketingBudget.hint')}
      </p>
      <label className="block space-y-1 max-w-xs" htmlFor="ai-marketing-budget">
        <span className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
          {t('adminAi.marketingBudget.label')}
        </span>
        <input
          id="ai-marketing-budget"
          type="number"
          min={0}
          step="0.01"
          value={marketingBudget}
          onChange={(e) => setMarketingBudget(e.target.value)}
          className="w-full text-sm px-3 py-2"
          style={inputStyle}
        />
      </label>
      <button type="button" onClick={save} disabled={busy} className="px-4 py-2 text-sm font-medium disabled:opacity-40" style={primaryButton}>
        {t('adminAi.save')}
      </button>
      {message && <Message tone={message.tone} text={message.text} />}
    </Section>
  );
}

function PriceRow({ model, price, overridden, onSave, onReset }: { model: string; price: AiModelPrice; overridden: boolean; onSave: (p: AiModelPrice) => void; onReset: () => void }) {
  const t = useT();
  const [values, setValues] = useState<Record<(typeof PRICE_FIELDS)[number], string>>({
    inputPerMTok: String(price.inputPerMTok),
    outputPerMTok: String(price.outputPerMTok),
    cacheWritePerMTok: String(price.cacheWritePerMTok),
    cacheReadPerMTok: String(price.cacheReadPerMTok),
  });
  const dirty = PRICE_FIELDS.some((f) => Number(values[f]) !== price[f]);
  const valid = PRICE_FIELDS.every((f) => values[f] !== '' && Number(values[f]) >= 0);
  return (
    <tr className="border-b last:border-0" style={{ borderColor: 'var(--color-border)' }}>
      <td className="px-3 py-2 font-mono text-xs">
        {model}
        {overridden && (
          <span className="ml-2 text-[10px] px-1.5 py-0.5" style={{ borderRadius: 'var(--radius-chip)', backgroundColor: 'var(--color-surface-muted)', color: 'var(--color-text-secondary)' }}>
            {t('adminAi.prices.overridden')}
          </span>
        )}
      </td>
      {PRICE_FIELDS.map((field) => (
        <td key={field} className="px-2 py-1">
          <input
            aria-label={`${model} ${t(PRICE_LABELS[field])}`}
            type="number"
            min={0}
            step="0.01"
            value={values[field]}
            onChange={(e) => setValues({ ...values, [field]: e.target.value })}
            className="w-20 text-xs px-2 py-1"
            style={inputStyle}
          />
        </td>
      ))}
      <td className="px-3 py-2 text-right whitespace-nowrap">
        <button
          type="button"
          disabled={!dirty || !valid}
          onClick={() => onSave({ inputPerMTok: Number(values.inputPerMTok), outputPerMTok: Number(values.outputPerMTok), cacheWritePerMTok: Number(values.cacheWritePerMTok), cacheReadPerMTok: Number(values.cacheReadPerMTok) })}
          className="text-xs font-medium hover:underline disabled:opacity-40 mr-3"
          style={{ color: 'var(--color-primary)' }}
        >
          {t('adminI18n.editor.save')}
        </button>
        {overridden && (
          <button type="button" onClick={onReset} className="text-xs font-medium hover:underline" style={{ color: 'var(--color-text-muted)' }}>
            {t('adminAi.prices.reset')}
          </button>
        )}
      </td>
    </tr>
  );
}

function PricesSection({ settings, onChange }: { settings: AiSettingsDTO; onChange: (next: AiSettingsDTO) => void }) {
  const t = useT();
  const [error, setError] = useState<string | null>(null);
  const models = [...new Set([...Object.keys(settings.effectivePrices), ...Object.values(settings.models)])].sort();

  async function saveOverrides(next: Record<string, AiModelPrice>) {
    setError(null);
    try {
      onChange(await bffFetch<AiSettingsDTO>('admin/ai/settings', { method: 'PATCH', body: { priceOverrides: next } }));
    } catch (err) {
      setError(aiErrorText(err, t));
    }
  }

  return (
    <Section title={t('adminAi.prices.title')} labelledBy="ai-prices">
      <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
        {t('adminAi.prices.hint')}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b" style={{ borderColor: 'var(--color-border)' }}>
              <th className="px-3 py-2 font-medium text-xs">{t('adminAi.prices.model')}</th>
              {PRICE_FIELDS.map((f) => (
                <th key={f} className="px-2 py-2 font-medium text-xs">
                  {t(PRICE_LABELS[f])}
                </th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {models.map((model) => {
              const price = settings.effectivePrices[model] ?? { inputPerMTok: 0, outputPerMTok: 0, cacheWritePerMTok: 0, cacheReadPerMTok: 0 };
              const overridden = Object.prototype.hasOwnProperty.call(settings.priceOverrides, model);
              return (
                <PriceRow
                  key={`${model}:${JSON.stringify(price)}`}
                  model={model}
                  price={price}
                  overridden={overridden}
                  onSave={(p) => saveOverrides({ ...settings.priceOverrides, [model]: p })}
                  onReset={() => {
                    const next = { ...settings.priceOverrides };
                    delete next[model];
                    void saveOverrides(next);
                  }}
                />
              );
            })}
          </tbody>
        </table>
      </div>
      {error && <Message tone="error" text={error} />}
    </Section>
  );
}

function TotalsCells({ totals }: { totals: AiUsageTotals }) {
  const fmt = useFormats();
  return (
    <>
      <td className="px-3 py-2 text-right">{fmt.number(totals.calls)}</td>
      <td className="px-3 py-2 text-right">{fmt.number(totals.failedCalls)}</td>
      <td className="px-3 py-2 text-right">{fmt.number(totals.inputTokens)}</td>
      <td className="px-3 py-2 text-right">{fmt.number(totals.outputTokens)}</td>
      <td className="px-3 py-2 text-right">{fmt.number(totals.cacheReadTokens)}</td>
      <td className="px-3 py-2 text-right font-medium">{fmt.usd(totals.costMicroUsd)}</td>
    </>
  );
}

function TotalsHead({ first }: { first: string }) {
  const t = useT();
  return (
    <tr className="text-left border-b text-xs" style={{ borderColor: 'var(--color-border)' }}>
      <th className="px-3 py-2 font-medium">{first}</th>
      <th className="px-3 py-2 font-medium text-right">{t('adminAi.usage.calls')}</th>
      <th className="px-3 py-2 font-medium text-right">{t('adminAi.usage.failedCalls')}</th>
      <th className="px-3 py-2 font-medium text-right">{t('adminAi.usage.inputTokens')}</th>
      <th className="px-3 py-2 font-medium text-right">{t('adminAi.usage.outputTokens')}</th>
      <th className="px-3 py-2 font-medium text-right">{t('adminAi.usage.cacheReadTokens')}</th>
      <th className="px-3 py-2 font-medium text-right">{t('adminAi.usage.cost')}</th>
    </tr>
  );
}

function TenantLimit({ row, onSaved }: { row: AiTenantUsageRow; onSaved: () => void }) {
  const t = useT();
  const fmt = useFormats();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(row.overrideCents !== null ? String(row.overrideCents / 100) : '');
  const [error, setError] = useState<string | null>(null);
  if (!row.studioId) return <span>-</span>;

  async function save(monthlyBudgetCents: number | null) {
    setError(null);
    try {
      await bffFetch(`admin/ai/tenants/${row.studioId}/limit`, { method: 'PUT', body: { monthlyBudgetCents } });
      setEditing(false);
      onSaved();
    } catch (err) {
      setError(aiErrorText(err, t));
    }
  }

  return (
    <div className="space-y-1">
      <span>
        {row.budgetCents !== null ? fmt.cents(row.budgetCents) : '-'}
        {row.budgetSource && <span style={{ color: 'var(--color-text-muted)' }}>{` (${t(`adminAi.usage.limitSource.${row.budgetSource}`)})`}</span>}
      </span>
      {!editing ? (
        <div className="flex gap-2">
          <button type="button" onClick={() => setEditing(true)} className="text-xs underline" style={{ color: 'var(--color-primary)' }}>
            {t('adminAi.usage.setLimit')}
          </button>
          {row.overrideCents !== null && (
            <button type="button" onClick={() => save(null)} className="text-xs underline" style={{ color: 'var(--color-text-muted)' }}>
              {t('adminAi.usage.clearLimit')}
            </button>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-1">
          <input
            aria-label={t('adminAi.usage.limitLabel')}
            type="number"
            min={0}
            step="0.01"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="w-24 text-xs px-2 py-1"
            style={inputStyle}
          />
          <button
            type="button"
            disabled={value === '' || Number(value) < 0}
            onClick={() => save(Math.round(Number(value) * 100))}
            className="text-xs font-medium disabled:opacity-40"
            style={{ color: 'var(--color-primary)' }}
          >
            {t('adminI18n.editor.save')}
          </button>
        </div>
      )}
      {error && <Message tone="error" text={error} />}
    </div>
  );
}

function UsageSection() {
  const t = useT();
  const fmt = useFormats();
  const [months, setMonths] = useState<number>(6);
  const [data, setData] = useState<AiUsageDashboardDTO | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    bffFetch<AiUsageDashboardDTO>(`admin/ai/usage?months=${months}`)
      .then((res) => {
        setData(res);
        setError(null);
      })
      .catch((err) => setError(aiErrorText(err, t)));
  }, [months, t]);
  useEffect(load, [load]);

  const empty = data !== null && data.byMonth.every((m) => m.calls === 0);

  return (
    <Section title={t('adminAi.usage.title')} labelledBy="ai-usage">
      <label className="flex items-center gap-2 text-xs" htmlFor="ai-usage-period" style={{ color: 'var(--color-text-secondary)' }}>
        {t('adminAi.usage.period')}
        <select id="ai-usage-period" value={months} onChange={(e) => setMonths(Number(e.target.value))} className="text-sm px-2 py-1" style={inputStyle}>
          {PERIODS.map((p) => (
            <option key={p} value={p}>
              {t(`adminAi.usage.period.${p}`)}
            </option>
          ))}
        </select>
      </label>
      {error && <Message tone="error" text={error} />}
      {!data && !error && <LoadingState />}
      {empty && (
        <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
          {t('adminAi.usage.empty')}
        </p>
      )}
      {data && !empty && (
        <div className="space-y-5 overflow-x-auto">
          <div>
            <h4 className="text-xs font-semibold mb-1">{t('adminAi.usage.byMonth')}</h4>
            <table className="w-full text-sm">
              <thead>
                <TotalsHead first={t('adminAi.usage.month')} />
              </thead>
              <tbody>
                {data.byMonth.map((row) => (
                  <tr key={row.month} className="border-b last:border-0" style={{ borderColor: 'var(--color-border)' }}>
                    <td className="px-3 py-2">{row.month}</td>
                    <TotalsCells totals={row} />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <h4 className="text-xs font-semibold mb-1">{t('adminAi.usage.byTask')}</h4>
            <table className="w-full text-sm">
              <thead>
                <TotalsHead first={t('adminAi.usage.task')} />
              </thead>
              <tbody>
                {data.byTask.map((row) => (
                  <tr key={row.task} className="border-b last:border-0" style={{ borderColor: 'var(--color-border)' }}>
                    <td className="px-3 py-2">{t(`adminAi.task.${row.task}`)}</td>
                    <TotalsCells totals={row} />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <h4 className="text-xs font-semibold mb-1">{t('adminAi.usage.byTenant')}</h4>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b text-xs" style={{ borderColor: 'var(--color-border)' }}>
                  <th className="px-3 py-2 font-medium">{t('adminAi.usage.tenant')}</th>
                  <th className="px-3 py-2 font-medium text-right">{t('adminAi.usage.calls')}</th>
                  <th className="px-3 py-2 font-medium text-right">{t('adminAi.usage.cost')}</th>
                  <th className="px-3 py-2 font-medium text-right">{t('adminAi.usage.thisMonth')}</th>
                  <th className="px-3 py-2 font-medium">{t('adminAi.usage.limit')}</th>
                </tr>
              </thead>
              <tbody>
                {data.byTenant.map((row) => (
                  <tr key={row.studioId ?? 'platform'} className="border-b last:border-0 align-top" style={{ borderColor: 'var(--color-border)' }}>
                    <td className="px-3 py-2">{row.studioId ? (row.studioName ?? row.studioId) : t('adminAi.usage.platform')}</td>
                    <td className="px-3 py-2 text-right">{fmt.number(row.calls)}</td>
                    <td className="px-3 py-2 text-right">{fmt.usd(row.costMicroUsd)}</td>
                    <td className="px-3 py-2 text-right">{fmt.usd(row.currentMonthCostMicroUsd)}</td>
                    <td className="px-3 py-2 text-xs">
                      <TenantLimit row={row} onSaved={load} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Section>
  );
}

/** Super-admin AI screen (G3b, docs/YAPAY_ZEKA.md). */
export default function AdminAiPage() {
  const t = useT();
  const [settings, setSettings] = useState<AiSettingsDTO | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    bffFetch<AiSettingsDTO>('admin/ai/settings')
      .then(setSettings)
      .catch((err) => setError(aiErrorText(err, t)));
  }, [t]);

  if (error) return <ErrorState message={error} />;
  if (!settings) return <LoadingState />;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold">{t('adminAi.title')}</h2>
        <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
          {t('adminAi.subtitle')}
        </p>
        <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
          {t(`adminAi.jobMode.${settings.jobMode}`)}
        </p>
      </div>
      <KeySection settings={settings} onChange={setSettings} />
      <ModelsSection settings={settings} onChange={setSettings} />
      <PricesSection settings={settings} onChange={setSettings} />
      <UsageSection />
    </div>
  );
}
