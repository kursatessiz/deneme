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
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { FieldGroup } from '@/components/ui/FieldGroup';
import { Input } from '@/components/ui/Input';
import { PageHeader } from '@/components/ui/PageHeader';
import { Select } from '@/components/ui/Select';
import { Table, Tbody, Td, Th, Thead, Tr } from '@/components/ui/Table';

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
    <Card as="section" aria-labelledby={labelledBy}>
      <CardContent>
        <h3 id={labelledBy} className="ui-heading">
          {title}
        </h3>
        {children}
      </CardContent>
    </Card>
  );
}

function Message({ tone, text }: { tone: 'success' | 'error'; text: string }) {
  return (
    <p className={tone === 'error' ? 'ui-caption ui-text-error' : 'ui-caption ui-text-success'} role={tone === 'error' ? 'alert' : 'status'}>
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
      <p data-testid="ai-key-status">
        {settings.configured && settings.keyLast4 ? t('adminAi.key.configured', { last4: settings.keyLast4 }) : t('adminAi.key.none')}
      </p>
      {settings.keySource && (
        <p className="ui-caption">
          {t(`adminAi.key.source.${settings.keySource}`)}
          {settings.keyUpdatedAt && settings.keySource === 'DATABASE' ? ` · ${t('adminAi.key.updatedAt', { date: fmt.date(settings.keyUpdatedAt) })}` : ''}
          {settings.lastTestAt ? ` · ${t('adminAi.test.last', { date: fmt.date(settings.lastTestAt) })}` : ''}
        </p>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <FieldGroup label={t('adminAi.key.label')} className="flex-1 min-w-[16rem]">
          <Input id="ai-api-key" type="password" autoComplete="off" spellCheck={false} value={apiKey} onChange={(e) => setApiKey(e.target.value)} className="ui-mono" />
        </FieldGroup>
        <Button onClick={save} disabled={busy || apiKey.trim().length < 20}>
          {settings.keySource === 'DATABASE' ? t('adminAi.key.replace') : t('adminAi.key.save')}
        </Button>
      </div>
      <p className="ui-caption">{t('adminAi.key.hint')}</p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" tone="surface" size="sm" onClick={test} disabled={busy || !settings.configured}>
          {t('adminAi.test.button')}
        </Button>
        {settings.keySource === 'DATABASE' && !confirmRemove && (
          <Button variant="outline" tone="surface" size="sm" onClick={() => setConfirmRemove(true)} disabled={busy}>
            {t('adminAi.key.remove')}
          </Button>
        )}
      </div>
      {confirmRemove && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="ui-small">{t('adminAi.key.removeConfirm')}</span>
          <Button variant="outline" tone="error" size="sm" onClick={remove} disabled={busy}>
            {t('adminAi.key.remove')}
          </Button>
          <Button variant="outline" tone="surface" size="sm" onClick={() => setConfirmRemove(false)}>
            {t('common.cancel')}
          </Button>
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
      <p className="ui-caption">{t('adminAi.models.hint')}</p>
      <datalist id="ai-known-models">
        {Object.keys(AI_PRICE_TABLE).map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {AI_TASKS.map((task) => (
          <FieldGroup key={task} label={t(`adminAi.task.${task}`)}>
            <Input
              id={`ai-model-${task}`}
              list="ai-known-models"
              value={models[task]}
              onChange={(e) => setModels({ ...models, [task]: e.target.value.trim() })}
              className="ui-mono"
            />
          </FieldGroup>
        ))}
      </div>
      <h4 className="ui-small ui-strong">{t('adminAi.budget.title')}</h4>
      <p className="ui-caption">{t('adminAi.budget.hint')}</p>
      <FieldGroup label={t('adminAi.budget.label')} className="max-w-xs">
        <Input id="ai-default-budget" type="number" min={0} step="0.01" value={budget} onChange={(e) => setBudget(e.target.value)} />
      </FieldGroup>
      <h4 className="ui-small ui-strong">{t('adminAi.marketingBudget.title')}</h4>
      <p className="ui-caption">{t('adminAi.marketingBudget.hint')}</p>
      <FieldGroup label={t('adminAi.marketingBudget.label')} className="max-w-xs">
        <Input id="ai-marketing-budget" type="number" min={0} step="0.01" value={marketingBudget} onChange={(e) => setMarketingBudget(e.target.value)} />
      </FieldGroup>
      <Button className="justify-self-start" onClick={save} disabled={busy}>
        {t('adminAi.save')}
      </Button>
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
    <Tr>
      <Td className="ui-mono">
        {model}
        {overridden && (
          <>
            {' '}
            <Badge>{t('adminAi.prices.overridden')}</Badge>
          </>
        )}
      </Td>
      {PRICE_FIELDS.map((field) => (
        <Td key={field}>
          <Input
            aria-label={`${model} ${t(PRICE_LABELS[field])}`}
            type="number"
            min={0}
            step="0.01"
            value={values[field]}
            onChange={(e) => setValues({ ...values, [field]: e.target.value })}
            className="w-24"
          />
        </Td>
      ))}
      <Td className="text-right whitespace-nowrap">
        <Button
          variant="link"
          size="sm"
          disabled={!dirty || !valid}
          onClick={() => onSave({ inputPerMTok: Number(values.inputPerMTok), outputPerMTok: Number(values.outputPerMTok), cacheWritePerMTok: Number(values.cacheWritePerMTok), cacheReadPerMTok: Number(values.cacheReadPerMTok) })}
        >
          {t('adminI18n.editor.save')}
        </Button>
        {overridden && (
          <Button variant="link" tone="muted" size="sm" onClick={onReset}>
            {t('adminAi.prices.reset')}
          </Button>
        )}
      </Td>
    </Tr>
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
      <p className="ui-caption">{t('adminAi.prices.hint')}</p>
      <div className="overflow-x-auto">
        <Table>
          <Thead>
            <Tr>
              <Th>{t('adminAi.prices.model')}</Th>
              {PRICE_FIELDS.map((f) => (
                <Th key={f}>{t(PRICE_LABELS[f])}</Th>
              ))}
              <Th />
            </Tr>
          </Thead>
          <Tbody>
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
          </Tbody>
        </Table>
      </div>
      {error && <Message tone="error" text={error} />}
    </Section>
  );
}

function TotalsCells({ totals }: { totals: AiUsageTotals }) {
  const fmt = useFormats();
  return (
    <>
      <Td className="text-right">{fmt.number(totals.calls)}</Td>
      <Td className="text-right">{fmt.number(totals.failedCalls)}</Td>
      <Td className="text-right">{fmt.number(totals.inputTokens)}</Td>
      <Td className="text-right">{fmt.number(totals.outputTokens)}</Td>
      <Td className="text-right">{fmt.number(totals.cacheReadTokens)}</Td>
      <Td className="text-right ui-strong">{fmt.usd(totals.costMicroUsd)}</Td>
    </>
  );
}

function TotalsHead({ first }: { first: string }) {
  const t = useT();
  return (
    <Tr>
      <Th>{first}</Th>
      <Th className="text-right">{t('adminAi.usage.calls')}</Th>
      <Th className="text-right">{t('adminAi.usage.failedCalls')}</Th>
      <Th className="text-right">{t('adminAi.usage.inputTokens')}</Th>
      <Th className="text-right">{t('adminAi.usage.outputTokens')}</Th>
      <Th className="text-right">{t('adminAi.usage.cacheReadTokens')}</Th>
      <Th className="text-right">{t('adminAi.usage.cost')}</Th>
    </Tr>
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
    <div className="grid gap-1">
      <span>
        {row.budgetCents !== null ? fmt.cents(row.budgetCents) : '-'}
        {row.budgetSource && <span className="ui-text-muted">{` (${t(`adminAi.usage.limitSource.${row.budgetSource}`)})`}</span>}
      </span>
      {!editing ? (
        <div className="flex gap-2">
          <Button variant="link" size="sm" onClick={() => setEditing(true)}>
            {t('adminAi.usage.setLimit')}
          </Button>
          {row.overrideCents !== null && (
            <Button variant="link" tone="muted" size="sm" onClick={() => save(null)}>
              {t('adminAi.usage.clearLimit')}
            </Button>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-1">
          <Input aria-label={t('adminAi.usage.limitLabel')} type="number" min={0} step="0.01" value={value} onChange={(e) => setValue(e.target.value)} className="w-28" />
          <Button variant="link" size="sm" disabled={value === '' || Number(value) < 0} onClick={() => save(Math.round(Number(value) * 100))}>
            {t('adminI18n.editor.save')}
          </Button>
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
      <label className="inline-flex items-center gap-2" htmlFor="ai-usage-period">
        <span className="ui-small">{t('adminAi.usage.period')}</span>
        <Select id="ai-usage-period" value={months} onChange={(e) => setMonths(Number(e.target.value))} className="w-auto">
          {PERIODS.map((p) => (
            <option key={p} value={p}>
              {t(`adminAi.usage.period.${p}`)}
            </option>
          ))}
        </Select>
      </label>
      {error && <Message tone="error" text={error} />}
      {!data && !error && <LoadingState />}
      {empty && <p className="ui-text-muted">{t('adminAi.usage.empty')}</p>}
      {data && !empty && (
        <div className="grid gap-5 overflow-x-auto">
          <div className="grid gap-1">
            <h4 className="ui-small ui-strong">{t('adminAi.usage.byMonth')}</h4>
            <Table>
              <Thead>
                <TotalsHead first={t('adminAi.usage.month')} />
              </Thead>
              <Tbody>
                {data.byMonth.map((row) => (
                  <Tr key={row.month}>
                    <Td>{row.month}</Td>
                    <TotalsCells totals={row} />
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </div>
          <div className="grid gap-1">
            <h4 className="ui-small ui-strong">{t('adminAi.usage.byTask')}</h4>
            <Table>
              <Thead>
                <TotalsHead first={t('adminAi.usage.task')} />
              </Thead>
              <Tbody>
                {data.byTask.map((row) => (
                  <Tr key={row.task}>
                    <Td>{t(`adminAi.task.${row.task}`)}</Td>
                    <TotalsCells totals={row} />
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </div>
          <div className="grid gap-1">
            <h4 className="ui-small ui-strong">{t('adminAi.usage.byTenant')}</h4>
            <Table>
              <Thead>
                <Tr>
                  <Th>{t('adminAi.usage.tenant')}</Th>
                  <Th className="text-right">{t('adminAi.usage.calls')}</Th>
                  <Th className="text-right">{t('adminAi.usage.cost')}</Th>
                  <Th className="text-right">{t('adminAi.usage.thisMonth')}</Th>
                  <Th>{t('adminAi.usage.limit')}</Th>
                </Tr>
              </Thead>
              <Tbody>
                {data.byTenant.map((row) => (
                  <Tr key={row.studioId ?? 'platform'} className="align-top">
                    <Td>{row.studioId ? (row.studioName ?? row.studioId) : t('adminAi.usage.platform')}</Td>
                    <Td className="text-right">{fmt.number(row.calls)}</Td>
                    <Td className="text-right">{fmt.usd(row.costMicroUsd)}</Td>
                    <Td className="text-right">{fmt.usd(row.currentMonthCostMicroUsd)}</Td>
                    <Td className="ui-small">
                      <TenantLimit row={row} onSaved={load} />
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
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
    <div className="grid gap-6">
      <PageHeader
        title={t('adminAi.title')}
        description={
          <>
            {t('adminAi.subtitle')}
            <br />
            {t(`adminAi.jobMode.${settings.jobMode}`)}
          </>
        }
      />
      <KeySection settings={settings} onChange={setSettings} />
      <ModelsSection settings={settings} onChange={setSettings} />
      <PricesSection settings={settings} onChange={setSettings} />
      <UsageSection />
    </div>
  );
}
