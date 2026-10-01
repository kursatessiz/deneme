'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import {
  DASHBOARD_MAX_RANGE_DAYS,
  DASHBOARD_PERIOD_PRESET_DAYS,
  EMAIL_BOUNCE_WARNING_RATE,
  EMAIL_COMPLAINT_WARNING_RATE,
  formatMoney,
  funnelStepMessageKey,
  pickDurationUnit,
  type CurrencyComparison,
  type CurrencyRatio,
  type DashboardChannelRow,
  type MarketingDashboardDTO,
  type MessageKey,
  type Money,
} from '@platform/shared';
import { bffFetch, BffError } from '@/lib/session/client';
import { useLocale, useT } from '@/components/i18n/I18nProvider';
import { ErrorState, LoadingState } from '@/components/common/DataState';
import { Section, SettingsHeader } from '@/components/settings/ui';
import { formatPercent } from '@/lib/money';
import { InputField } from '../fields';
import { usePlatformSession } from '../PlatformSession';
import { InsightsPanel } from './InsightsPanel';
import { Checkbox, ChipButton, Table, Thead, Tbody, Tr, Th, Td } from '@/components/ui';

type Preset = (typeof DASHBOARD_PERIOD_PRESET_DAYS)[number] | 'custom';

const DAY_MS = 86_400_000;

const pad = (n: number) => String(n).padStart(2, '0');
const dateOnly = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

/** UTC day boundaries, the same convention as the API's date-only columns: the last `days` days including today. */
function presetRange(days: number, now: Date): { from: string; to: string } {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return { from: dateOnly(new Date(today - (days - 1) * DAY_MS)), to: dateOnly(new Date(today)) };
}

/** From/to of a request for two date-only values (inclusive days), or null when the range is invalid. */
function requestRange(from: string, to: string): { from: string; to: string } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return null;
  const start = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T23:59:59.999Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) return null;
  if ((end.getTime() - start.getTime()) / DAY_MS > DASHBOARD_MAX_RANGE_DAYS) return null;
  return { from: start.toISOString(), to: end.toISOString() };
}

/**
 * Marketing dashboard (/pazarlama, M3a, docs/PAZARLAMA_MODULU.md 3.3): funnel,
 * acquisition cost and return per currency, trial to paid, channel return,
 * channel health. Read-only aggregates; money is formatted per currency with
 * the viewer's locale and never added across currencies. Sections are flat
 * surfaces (no card in a card, no gradients); warnings are always words as
 * well as colour.
 */
export function MarketingDashboard() {
  const t = useT();
  const locale = useLocale();
  const { platformStudioId } = usePlatformSession();
  const [preset, setPreset] = useState<Preset>(30);
  const [customFrom, setCustomFrom] = useState(() => presetRange(30, new Date()).from);
  const [customTo, setCustomTo] = useState(() => presetRange(30, new Date()).to);
  const [compare, setCompare] = useState(false);
  const [data, setData] = useState<MarketingDashboardDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const range = useMemo(() => {
    if (preset === 'custom') return requestRange(customFrom, customTo);
    const r = presetRange(preset, new Date());
    return requestRange(r.from, r.to);
  }, [preset, customFrom, customTo]);

  useEffect(() => {
    if (!range) return;
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams({ from: range.from, to: range.to });
    if (compare) params.set('compare', 'previous');
    bffFetch<MarketingDashboardDTO>(`platform/marketing/dashboard?${params.toString()}`)
      .then((res) => {
        if (cancelled) return;
        setData(res);
        setError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof BffError ? err.message : t('marketingDashboard.loadFailed'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, compare, platformStudioId]);

  const number = useMemo(() => new Intl.NumberFormat(locale), [locale]);
  const decimal = useMemo(() => new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }), [locale]);
  const dayFormat = useMemo(() => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }), [locale]);
  const dateTimeFormat = useMemo(() => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }), [locale]);
  const noValue = t('funnels.noValue');

  const fmtMoney = (m: Money) => formatMoney(m, locale);
  const fmtPercent = (r: number | null, digits = 1) => (r === null ? noValue : formatPercent(r, locale, digits));
  const fmtRoas = (v: number | null) => (v === null ? noValue : t('marketingDashboard.acquisition.roasValue', { value: decimal.format(v) }));
  const fmtDuration = (seconds: number | null) => {
    if (seconds === null) return noValue;
    const { unit, value } = pickDurationUnit(seconds);
    return t(`funnels.duration.${unit}` as MessageKey, { value: new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value) });
  };
  const fmtRange = (from: string, to: string) => t('marketingDashboard.period.range', { from: dayFormat.format(new Date(from)), to: dayFormat.format(new Date(to)) });
  // AI usage is metered in micro US dollars by design (the API's cost fields), so this is the one place a fixed currency is right.
  const fmtUsd = (microUsd: number) => new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(microUsd / 1_000_000);

  const deltaText = (changeRatio: number | null, previousValue: string): string =>
    changeRatio === null ? t('marketingDashboard.compare.noPrevious') : `${changeRatio > 0 ? '+' : changeRatio < 0 ? '-' : ''}${formatPercent(Math.abs(changeRatio), locale, 1)} - ${t('marketingDashboard.compare.previousValue', { value: previousValue })}`;

  // Render helpers (plain functions, not nested components, so React never remounts them).
  function delta(text: string | null) {
    if (text === null) return null;
    return (
      <div className="mt-0.5 ui-caption">
        {text}
      </div>
    );
  }

  function currencyLines(
    label: string,
    values: ReadonlyArray<{ currency: string; text: string }>,
    comparison: readonly CurrencyComparison[] | null,
    comparisonFormat: (currency: string, value: number) => string,
  ) {
    return (
      <div key={label}>
        <div className="ui-strong ui-caption">
          {label}
        </div>
        {values.length === 0 ? (
          <div className="mt-1 ui-text-muted">
            {t('marketingDashboard.acquisition.noValue')}
          </div>
        ) : (
          <ul className="mt-1 space-y-1.5">
            {values.map((v) => {
              const cmp = comparison?.find((c) => c.currency === v.currency) ?? null;
              return (
                <li key={v.currency}>
                  <div className="ui-stat-value">
                    {v.text}
                  </div>
                  {cmp && delta(deltaText(cmp.changeRatio, cmp.previous === null ? noValue : comparisonFormat(v.currency, cmp.previous)))}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    );
  }

  function countTile(label: string, value: number, comparison: { previous: number; changeRatio: number | null } | null) {
    return (
      <div key={label}>
        <div className="ui-strong ui-caption">
          {label}
        </div>
        <div className="mt-1 ui-stat-value">
          {number.format(value)}
        </div>
        {comparison && delta(deltaText(comparison.changeRatio, number.format(comparison.previous)))}
      </div>
    );
  }

  function moneyLines(list: readonly Money[]): Array<{ currency: string; text: string }> {
    return list.map((m) => ({ currency: m.currency, text: fmtMoney(m) }));
  }
  function ratioLines(list: readonly CurrencyRatio[], fmt: (v: number | null) => string): Array<{ currency: string; text: string }> {
    return list.map((r) => ({ currency: r.currency, text: fmt(r.value) }));
  }
  const moneyOf = (currency: string, value: number) => fmtMoney({ currency, amount: value.toFixed(2) });

  function channelTable(title: string, rows: readonly DashboardChannelRow[]) {
    const nameOf = (row: DashboardChannelRow): string => {
      if (row.key === '(direct)') return t('funnels.group.direct');
      if (row.key === '(none)') return t('funnels.group.none');
      return row.label ?? row.key;
    };
    const cell = (list: readonly Money[]) => (list.length === 0 ? noValue : list.map((m) => fmtMoney(m)).join(' / '));
    return (
      <div key={title} className="overflow-x-auto">
        <Table>
          <caption className="text-left pb-2 ui-strong ui-small">
            {title}
          </caption>
          <Thead>
            <Tr className="ui-caption">
              <Th scope="col">
                {t('marketingDashboard.channels.col.name')}
              </Th>
              <Th scope="col" className="text-right">
                {t('marketingDashboard.channels.col.studioPaid')}
              </Th>
              <Th scope="col" className="text-right">
                {t('marketingDashboard.channels.col.spend')}
              </Th>
              <Th scope="col" className="text-right">
                {t('marketingDashboard.channels.col.revenue')}
              </Th>
              <Th scope="col" className="text-right">
                {t('marketingDashboard.channels.col.roas')}
              </Th>
            </Tr>
          </Thead>
          <Tbody>
            {rows.length === 0 ? (
              <Tr>
                <Td colSpan={5} className="ui-caption">
                  {t('marketingDashboard.channels.empty')}
                </Td>
              </Tr>
            ) : (
              rows.map((row) => (
                <Tr key={row.key}>
                  <Td className="break-all">{nameOf(row)}</Td>
                  <Td className="text-right">{decimal.format(row.studioPaid)}</Td>
                  <Td className="text-right">{cell(row.spend)}</Td>
                  <Td className="text-right">{cell(row.revenue)}</Td>
                  <Td className="text-right">{row.roas.length === 0 ? noValue : row.roas.map((r) => `${r.currency} ${fmtRoas(r.value)}`).join(' / ')}</Td>
                </Tr>
              ))
            )}
          </Tbody>
        </Table>
      </div>
    );
  }

  const controls = (
    <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
      <div role="group" aria-label={t('marketingDashboard.period.label')} className="flex flex-wrap gap-2">
        {DASHBOARD_PERIOD_PRESET_DAYS.map((days) => (
          <ChipButton key={days} selected={preset === days} onClick={() => setPreset(days)}>
            {t('marketingDashboard.period.days', { days })}
          </ChipButton>
        ))}
        <ChipButton selected={preset === 'custom'} onClick={() => setPreset('custom')}>
          {t('marketingDashboard.period.custom')}
        </ChipButton>
      </div>
      {preset === 'custom' && (
        <div className="flex flex-wrap items-end gap-3">
          <InputField label={t('marketingDashboard.period.from')} type="date" value={customFrom} onChange={setCustomFrom} />
          <InputField label={t('marketingDashboard.period.to')} type="date" value={customTo} onChange={setCustomTo} />
        </div>
      )}
      <Checkbox label={t('marketingDashboard.compare.toggle')} checked={compare} onChange={(e) => setCompare(e.target.checked)} />
    </div>
  );

  const header = (
    <>
      <SettingsHeader title={t('marketingDashboard.title')} description={t('marketingDashboard.subtitle')} />
      {controls}
      {!range && (
        <p className="ui-text-error ui-small" role="alert">
          {t('marketingDashboard.period.invalid')}
        </p>
      )}
    </>
  );

  if (error && !data) {
    return (
      <div className="space-y-4">
        {header}
        <ErrorState message={error} />
      </div>
    );
  }
  if (!data) {
    return (
      <div className="space-y-4">
        {header}
        {range ? <LoadingState /> : null}
      </div>
    );
  }

  const { current, previous, deltas, mrr, health } = data;
  const funnelFirst = current.funnel.steps[0];
  const funnelLast = current.funnel.steps[current.funnel.steps.length - 1];
  const a = current.acquisition;

  return (
    <div className="space-y-4">
      {header}
      <div className="ui-caption" aria-live="polite">
        {fmtRange(current.from, current.to)}
        {previous && ` - ${t('marketingDashboard.compare.previousRange', { range: fmtRange(previous.from, previous.to) })}`}
        {loading && ` - ${t('marketingDashboard.updating')}`}
      </div>
      {error && (
        <p className="ui-text-error ui-small" role="alert">
          {error}
        </p>
      )}

      <Section title={t('marketingDashboard.funnel.title')} description={t('marketingDashboard.funnel.description')}>
        {funnelFirst && funnelFirst.reached === 0 && (
          <p className="ui-text-muted">
            {t('marketingDashboard.funnel.empty')}
          </p>
        )}
        <ol aria-label={t('marketingDashboard.funnel.title')} className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-x-4 gap-y-5">
          {current.funnel.steps.map((step, k) => {
            const cmp = deltas?.funnel[k]?.reached ?? null;
            return (
              <li key={step.key}>
                <div className="ui-strong ui-caption">
                  {t(funnelStepMessageKey(step.key) as MessageKey)}
                </div>
                <div className="mt-1 ui-stat-value">
                  {number.format(step.reached)}
                </div>
                {k > 0 && (
                  <>
                    <div className="mt-1 ui-caption">
                      {t('marketingDashboard.funnel.fromPrevious', { rate: fmtPercent(step.rateFromPrevious) })}
                    </div>
                    <div className="ui-caption">
                      {t('marketingDashboard.funnel.median', { duration: fmtDuration(step.medianSecondsFromPrevious) })}
                    </div>
                  </>
                )}
                {cmp && delta(deltaText(cmp.changeRatio, number.format(cmp.previous)))}
              </li>
            );
          })}
        </ol>
        {funnelFirst && funnelLast && funnelFirst.reached > 0 && (
          <p className="ui-caption">
            {t('marketingDashboard.funnel.overall', { rate: fmtPercent(funnelLast.rateFromFirst) })}
          </p>
        )}
        <p className="ui-caption">
          {t('marketingDashboard.funnel.stages')}
        </p>
      </Section>

      <Section title={t('marketingDashboard.acquisition.title')} description={t('marketingDashboard.acquisition.description')}>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-6">
          {countTile(t('marketingDashboard.acquisition.leads'), a.leads, deltas?.leads ?? null)}
          {countTile(t('marketingDashboard.acquisition.studioPaid'), a.studioPaid, deltas?.studioPaid ?? null)}
          {currencyLines(t('marketingDashboard.acquisition.spend'), moneyLines(a.spend), deltas?.spend ?? null, moneyOf)}
          {currencyLines(t('marketingDashboard.acquisition.cac'), moneyLines(a.cac), deltas?.cac ?? null, moneyOf)}
          {currencyLines(t('marketingDashboard.acquisition.cpl'), moneyLines(a.cpl), deltas?.cpl ?? null, moneyOf)}
          {currencyLines(t('marketingDashboard.acquisition.revenue'), moneyLines(a.revenue), deltas?.revenue ?? null, moneyOf)}
          {currencyLines(t('marketingDashboard.acquisition.roas'), ratioLines(a.roas, fmtRoas), deltas?.roas ?? null, (_currency, value) => fmtRoas(value))}
        </div>
        {a.spend.length === 0 && (
          <p className="ui-caption">
            {t('marketingDashboard.acquisition.noSpend')}
          </p>
        )}
      </Section>

      <Section title={t('marketingDashboard.trial.title')} description={t('marketingDashboard.trial.description')}>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-6">
          {countTile(t('marketingDashboard.trial.trials'), current.trial.trials, deltas?.trials ?? null)}
          {countTile(t('marketingDashboard.trial.converted'), current.trial.converted, deltas?.converted ?? null)}
          <div>
            <div className="ui-strong ui-caption">
              {t('marketingDashboard.trial.rate')}
            </div>
            <div className="mt-1 ui-stat-value">
              {fmtPercent(current.trial.rate)}
            </div>
            {deltas && (
              delta(
                deltas.trialRateDelta === null
                  ? t('marketingDashboard.compare.noPrevious')
                  : `${deltas.trialRateDelta > 0 ? '+' : deltas.trialRateDelta < 0 ? '-' : ''}${t('marketingDashboard.compare.points', { value: decimal.format(Math.abs(deltas.trialRateDelta) * 100) })}`,
              )
            )}
          </div>
          <div>
            <div className="ui-strong ui-caption">
              {t('marketingDashboard.trial.median')}
            </div>
            <div className="mt-1 ui-stat-value">
              {fmtDuration(current.trial.medianSeconds)}
            </div>
            {previous && delta(t('marketingDashboard.compare.previousValue', { value: fmtDuration(previous.trial.medianSeconds) }))}
          </div>
        </div>
      </Section>

      {mrr && (
        <Section title={t('marketingDashboard.mrr.title')} description={t('marketingDashboard.mrr.description')}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-6">
            <div>
              <div className="ui-strong ui-caption">
                {t('marketingDashboard.mrr.new')}
              </div>
              {mrr.newMrr.length === 0 ? (
                <div className="mt-1 ui-text-muted">
                  {t('marketingDashboard.mrr.none')}
                </div>
              ) : (
                <ul className="mt-1 space-y-1">
                  {mrr.newMrr.map((m) => (
                    <li key={m.currency} className="ui-stat-value">
                      {fmtMoney(m)}
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-1 ui-caption">
                {t('marketingDashboard.mrr.newStudios', { count: mrr.newPayingStudios })}
              </div>
            </div>
            <div>
              <div className="ui-strong ui-caption">
                {t('marketingDashboard.mrr.active')}
              </div>
              {mrr.activeMrr.length === 0 ? (
                <div className="mt-1 ui-text-muted">
                  {t('marketingDashboard.mrr.none')}
                </div>
              ) : (
                <ul className="mt-1 space-y-1">
                  {mrr.activeMrr.map((m) => (
                    <li key={m.currency} className="ui-stat-value">
                      {fmtMoney(m)}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          {mrr.unpricedStudios > 0 && (
            <p className="ui-caption">
              {t('marketingDashboard.mrr.unpriced', { count: mrr.unpricedStudios })}
            </p>
          )}
        </Section>
      )}

      <Section title={t('marketingDashboard.channels.title')} description={t('marketingDashboard.channels.description')}>
        <div className="space-y-6">
          {channelTable(t('marketingDashboard.channels.bySource'), current.channels.bySource)}
          {channelTable(t('marketingDashboard.channels.byCampaign'), current.channels.byCampaign)}
        </div>
      </Section>

      <InsightsPanel />

      <Section title={t('marketingDashboard.health.title')} description={t('marketingDashboard.health.description')}>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-8 gap-y-8">
          <div className="space-y-4">
            <h4 className="ui-strong ui-small">
              {t('marketingDashboard.email.title')}
            </h4>
            {health.email.map((w) => (
              <div key={w.days} className="space-y-1">
                <div className="ui-strong ui-caption">
                  {t('marketingDashboard.health.window', { days: w.days })} - {t('marketingDashboard.email.sent', { count: w.sent })}
                </div>
                <div className="flex flex-wrap gap-x-6 gap-y-1">
                  <span className={w.bounceWarning ? 'ui-text-error ui-strong' : undefined}>
                    {t('marketingDashboard.email.bounce')}: {w.bounceRate === null ? t('marketingDashboard.health.noData') : fmtPercent(w.bounceRate, 2)}
                  </span>
                  <span className={w.complaintWarning ? 'ui-text-error ui-strong' : undefined}>
                    {t('marketingDashboard.email.complaint')}: {w.complaintRate === null ? t('marketingDashboard.health.noData') : fmtPercent(w.complaintRate, 2)}
                  </span>
                </div>
                {w.bounceWarning && (
                  <p role="status" className="flex items-start gap-1.5 ui-text-error ui-small">
                    <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
                    <span>
                      {t('marketingDashboard.health.warning')}: {t('marketingDashboard.email.bounceWarning', { threshold: formatPercent(EMAIL_BOUNCE_WARNING_RATE, locale, 0) })}
                    </span>
                  </p>
                )}
                {w.complaintWarning && (
                  <p role="status" className="flex items-start gap-1.5 ui-text-error ui-small">
                    <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
                    <span>
                      {t('marketingDashboard.health.warning')}: {t('marketingDashboard.email.complaintWarning', { threshold: formatPercent(EMAIL_COMPLAINT_WARNING_RATE, locale, 2) })}
                    </span>
                  </p>
                )}
              </div>
            ))}
          </div>

          <div className="space-y-4">
            <h4 className="ui-strong ui-small">
              {t('marketingDashboard.sms.title')}
            </h4>
            {health.sms.map((w) => (
              <div key={w.days}>
                <span className="ui-strong ui-caption">
                  {t('marketingDashboard.health.window', { days: w.days })}
                </span>
                <div>
                  {w.deliveryRate === null ? t('marketingDashboard.health.noData') : fmtPercent(w.deliveryRate, 1)}
                  <span className="ml-2 ui-caption">
                    {t('marketingDashboard.sms.attempted', { count: w.attempted })}
                  </span>
                </div>
              </div>
            ))}
          </div>

          <div className="space-y-2">
            <h4 className="ui-strong ui-small">
              {t('marketingDashboard.ai.title')}
            </h4>
            {health.ai.budgetCents <= 0 ? (
              <p className="ui-text-muted">
                {t('marketingDashboard.ai.off')}
              </p>
            ) : (
              <>
                <div>{t('marketingDashboard.ai.usage', { used: fmtUsd(health.ai.usedMicroUsd), budget: fmtUsd(health.ai.budgetCents * 10_000) })}</div>
                <div
                  role="progressbar"
                  aria-label={t('marketingDashboard.ai.barLabel')}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.min(100, Math.round((health.ai.usedRatio ?? 0) * 100))}
                  className="h-2.5 overflow-hidden ui-panel"
                >
                  <div
                    className="h-full ui-bar-fill"
                    data-level={health.ai.level}
                    style={{ width: `${Math.min(100, (health.ai.usedRatio ?? 0) * 100)}%` }}
                  />
                </div>
              </>
            )}
            {health.ai.level !== 'ok' && health.ai.budgetCents > 0 && (
              <p role="status" className={`flex items-start gap-1.5 ui-small ${health.ai.level === 'exceeded' ? 'ui-text-error' : 'ui-text-warn'}`}>
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
                <span>{health.ai.level === 'exceeded' ? t('marketingDashboard.ai.exceeded') : t('marketingDashboard.ai.warning')}</span>
              </p>
            )}
          </div>

          <div className="space-y-2">
            <h4 className="ui-strong ui-small">
              {t('marketingDashboard.approvals.title')}
            </h4>
            <p className={health.approvals.available ? undefined : 'ui-text-muted'}>
              {health.approvals.available ? t('marketingDashboard.approvals.pending', { count: health.approvals.pending }) : t('marketingDashboard.approvals.unavailable')}
            </p>
          </div>

          <div className="space-y-2">
            <h4 className="ui-strong ui-small">
              {t('marketingDashboard.caps.title')}
            </h4>
            <p>
              {health.caps.email.cap === null
                ? t('marketingDashboard.caps.emailNoCap', { sent: number.format(health.caps.email.sent) })
                : t('marketingDashboard.caps.email', { sent: number.format(health.caps.email.sent), cap: number.format(health.caps.email.cap) })}
            </p>
            {health.caps.email.source === 'WARMUP' && health.caps.email.warmupDay !== null && (
              <p className="ui-caption">
                {t('marketingDashboard.caps.warmup', { day: health.caps.email.warmupDay })}
              </p>
            )}
            <p>
              {health.caps.sms.cap === null
                ? t('marketingDashboard.caps.smsNoCap', { credits: number.format(health.caps.sms.credits) })
                : t('marketingDashboard.caps.sms', { credits: number.format(health.caps.sms.credits), cap: number.format(health.caps.sms.cap) })}
            </p>
            {health.caps.deferredRecipients > 0 && (
              <p role="status" className="flex items-start gap-1.5 ui-small ui-text-warn">
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
                <span>{t('marketingDashboard.caps.deferred', { count: health.caps.deferredRecipients })}</span>
              </p>
            )}
          </div>

          <div className="space-y-2">
            <h4 className="ui-strong ui-small">
              {t('marketingDashboard.autoPause.title')}
            </h4>
            {health.autoPause.active ? (
              <p role="status" className="flex items-start gap-1.5 ui-text-error ui-strong">
                <AlertTriangle className="w-3.5 h-3.5 mt-1 shrink-0" aria-hidden="true" />
                <span>
                  {t('marketingDashboard.autoPause.active', { count: health.autoPause.pausedCampaigns, reasons: health.autoPause.reasons.map((r) => t(`marketingGuards.reason.${r}`)).join(', ') })}
                </span>
              </p>
            ) : (
              <p className="ui-text-muted">
                {t('marketingDashboard.autoPause.none')}
              </p>
            )}
          </div>

          {health.adSpendCaps.length > 0 && (
            <div className="space-y-2 lg:col-span-2">
              <h4 className="ui-strong ui-small">
                {t('marketingDashboard.adCap.title')}
              </h4>
              <ul className="space-y-1">
                {health.adSpendCaps.map((c) => (
                  <li key={c.currency} className={c.exceeded ? 'ui-text-error ui-strong' : undefined}>
                    {t('marketingDashboard.adCap.line', {
                      spent: fmtMoney({ amount: c.spent, currency: c.currency }),
                      cap: fmtMoney({ amount: c.cap, currency: c.currency }),
                    })}
                    {c.exceeded && (
                      <span className="inline-flex items-center gap-1 ml-2 ui-small">
                        <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />
                        {t('marketingDashboard.adCap.exceeded')}
                      </span>
                    )}
                    <span className="ml-2 ui-caption">
                      {t(c.autoPause ? 'marketingDashboard.adCap.autoPauseOn' : 'marketingDashboard.adCap.autoPauseOff')}
                    </span>
                    {c.pauses.length > 0 && (
                      <div className="mt-1">
                        <p className="ui-strong ui-small">{t('marketingDashboard.adCap.pausedTitle')}</p>
                        <ul className="space-y-0.5">
                          {c.pauses.map((p) => (
                            <li key={`${p.platform}:${p.campaignExternalId}`} className="ui-small">
                              {p.status === 'PAUSED' && p.pausedAt
                                ? t('marketingDashboard.adCap.pausedLine', {
                                    name: p.campaignName,
                                    platform: p.platform,
                                    date: new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(p.pausedAt)),
                                    spent: fmtMoney({ amount: p.spent, currency: p.currency }),
                                    cap: fmtMoney({ amount: p.cap, currency: p.currency }),
                                  })
                                : t('marketingDashboard.adCap.failedLine', { name: p.campaignName, platform: p.platform, attempts: p.attempts, error: p.lastError ?? '-' })}
                              {p.status === 'PAUSED' && <span className="ui-text-muted"> {t('marketingDashboard.adCap.reason')}</span>}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="space-y-2 lg:col-span-2">
            <h4 className="ui-strong ui-small">
              {t('marketingDashboard.connections.title')}
            </h4>
            {health.connections.items.length === 0 ? (
              <p className="ui-text-muted">
                {t('marketingDashboard.connections.none')}
              </p>
            ) : (
              <>
                <p>{t('marketingDashboard.connections.count', { count: health.connections.errorCount })}</p>
                <ul className="ui-divide">
                  {health.connections.items.map((c) => (
                    <li key={c.id} className="py-2">
                      <div className="ui-strong">
                        {c.label} <span className="ui-caption">({c.platform})</span>
                      </div>
                      <div className="mt-0.5 break-words ui-text-error ui-small">
                        {c.lastError}
                      </div>
                      <div className="mt-0.5 ui-caption">
                        {c.lastSyncAt ? t('marketingDashboard.connections.lastSync', { date: dateTimeFormat.format(new Date(c.lastSyncAt)) }) : t('marketingDashboard.connections.neverSynced')}
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}
            <p className={health.connections.failedDeliveries > 0 ? 'ui-text-error' : 'ui-text-muted'}>
              {health.connections.failedDeliveries > 0
                ? t('marketingDashboard.connections.failedDeliveries', { count: health.connections.failedDeliveries })
                : t('marketingDashboard.connections.noFailedDeliveries')}
            </p>
          </div>
        </div>
      </Section>
    </div>
  );
}
