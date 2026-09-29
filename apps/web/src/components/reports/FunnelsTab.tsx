'use client';

import { useEffect, useMemo, useState } from 'react';
import { FUNNEL_BREAKDOWNS, compareFunnelSteps, funnelStepMessageKey, pickDurationUnit } from '@platform/shared';
import type { FunnelBreakdown, FunnelReportDTO, FunnelStepStatDTO, FunnelSummaryDTO, MessageKey } from '@platform/shared';
import { useDashboardSession } from '@/components/session/DashboardSessionProvider';
import { useLocale, useT } from '@/components/i18n/I18nProvider';
import { bffFetch, BffError } from '@/lib/session/client';
import { useBff } from '@/lib/session/use-bff';
import { buildReportQuery } from '@/lib/reports/query';
import { formatPercent } from '@/lib/money';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/DataState';
import { PermissionButton } from '@/components/common/PermissionButton';
import { Badge } from '@/components/common/Badge';
import { StatTile } from './Bar';
import { FunnelEditor } from './FunnelEditor';

const selectStyle: React.CSSProperties = {
  borderRadius: 'var(--radius-input)',
  border: '1px solid var(--color-border)',
  backgroundColor: 'var(--color-surface)',
  color: 'var(--color-text-primary)',
};

const READY_MADE_KEYS = {
  'lead-to-member': 'funnels.ready.lead-to-member.name',
  'trial-to-member': 'funnels.ready.trial-to-member.name',
  'visitor-to-member': 'funnels.ready.visitor-to-member.name',
  platform_b2b: 'funnels.ready.platform_b2b.name',
} as const satisfies Record<string, MessageKey>;

interface Props {
  from: Date | null;
  to: Date | null;
  branchId: string;
  compare: boolean;
}

/** The "Huniler" tab on /raporlar (G5d-1, docs/HUNILER.md). Filters (range, branch, compare) come from the page. */
export function FunnelsTab({ from, to, branchId, compare }: Props) {
  const t = useT();
  const locale = useLocale();
  const { activeStudioId } = useDashboardSession();
  const [listKey, setListKey] = useState(0);
  const list = useBff<{ items: FunnelSummaryDTO[] }>(activeStudioId ? `studios/${activeStudioId}/funnels` : null, activeStudioId, listKey);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [breakdown, setBreakdown] = useState<FunnelBreakdown | ''>('');
  const [report, setReport] = useState<FunnelReportDTO | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<FunnelSummaryDTO | 'new' | null>(null);

  const items = useMemo(() => list.data?.items ?? [], [list.data]);
  const selected = items.find((f) => f.id === selectedId) ?? items[0] ?? null;
  const selectedFunnelId = selected?.id ?? null;

  const funnelName = (f: FunnelSummaryDTO): string => (f.kind === 'READY_MADE' && f.slug ? t(READY_MADE_KEYS[f.slug as keyof typeof READY_MADE_KEYS] ?? 'funnels.title') : (f.name ?? ''));
  const stepLabel = (key: string): string => t(funnelStepMessageKey(key) as MessageKey);
  const percent = (ratio: number | null) => (ratio === null ? t('funnels.noValue') : formatPercent(ratio, locale, 1));
  const count = (n: number) => new Intl.NumberFormat(locale).format(n);
  const duration = (seconds: number | null) => {
    if (seconds === null) return t('funnels.noValue');
    const { unit, value } = pickDurationUnit(seconds);
    return t(`funnels.duration.${unit}` as MessageKey, { value: new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value) });
  };
  const groupLabel = (key: string, label: string | null): string => {
    if (key === '(direct)') return t('funnels.group.direct');
    if (key === '(none)') return t('funnels.group.none');
    return label ?? key;
  };

  useEffect(() => {
    if (!activeStudioId || !selectedFunnelId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams(buildReportQuery({ from, to, branchId: branchId || null }));
    if (breakdown) params.set('breakdown', breakdown);
    if (compare) params.set('compare', 'previous');
    bffFetch<FunnelReportDTO>(`studios/${activeStudioId}/funnels/${encodeURIComponent(selectedFunnelId)}/report?${params.toString()}`, { studioId: activeStudioId })
      .then((res) => {
        if (!cancelled) setReport(res);
      })
      .catch((err) => {
        if (!cancelled) {
          setReport(null);
          setError(err instanceof BffError ? err.message : t('funnels.error.loadFailed'));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStudioId, selectedFunnelId, from, to, branchId, breakdown, compare, listKey]);

  async function removeSelected() {
    if (!activeStudioId || !selected || selected.kind !== 'TENANT') return;
    if (!window.confirm(t('funnels.editor.confirmDelete'))) return;
    try {
      await bffFetch(`studios/${activeStudioId}/funnels/${selected.id}`, { method: 'DELETE', studioId: activeStudioId });
      setSelectedId(null);
      setListKey((k) => k + 1);
    } catch (err) {
      window.alert(err instanceof BffError ? err.message : t('funnels.editor.deleteFailed'));
    }
  }

  if (list.loading) return <LoadingState />;
  if (list.error) return <ErrorState message={list.error} />;

  const comparison = report?.previous ? compareFunnelSteps(report.steps, report.previous.steps) : null;
  const first = report?.steps[0];
  const last = report?.steps[report.steps.length - 1];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
          {t('funnels.selector.label')}
          <select value={selected?.id ?? ''} onChange={(e) => setSelectedId(e.target.value)} aria-label={t('funnels.selector.label')} className="text-xs px-2.5 py-1.5" style={selectStyle}>
            <optgroup label={t('funnels.selector.readyMade')}>
              {items
                .filter((f) => f.kind === 'READY_MADE')
                .map((f) => (
                  <option key={f.id} value={f.id}>
                    {funnelName(f)}
                  </option>
                ))}
            </optgroup>
            {items.some((f) => f.kind === 'TENANT') && (
              <optgroup label={t('funnels.selector.tenant')}>
                {items
                  .filter((f) => f.kind === 'TENANT')
                  .map((f) => (
                    <option key={f.id} value={f.id}>
                      {funnelName(f)}
                    </option>
                  ))}
              </optgroup>
            )}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
          {t('funnels.breakdown.label')}
          <select value={breakdown} onChange={(e) => setBreakdown(e.target.value as FunnelBreakdown | '')} aria-label={t('funnels.breakdown.label')} className="text-xs px-2.5 py-1.5" style={selectStyle}>
            <option value="">{t('funnels.breakdown.none')}</option>
            {FUNNEL_BREAKDOWNS.map((b) => (
              <option key={b} value={b}>
                {t(`funnels.breakdown.${b}` as MessageKey)}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-center gap-2 ml-auto">
          <PermissionButton required={['funnels.manage']} onClick={() => setEditing('new')}>
            {t('funnels.editor.new')}
          </PermissionButton>
          {selected?.kind === 'TENANT' && (
            <>
              <PermissionButton required={['funnels.manage']} onClick={() => setEditing(selected)}>
                {t('funnels.editor.edit')}
              </PermissionButton>
              <PermissionButton required={['funnels.manage']} onClick={removeSelected}>
                {t('funnels.editor.delete')}
              </PermissionButton>
            </>
          )}
        </div>
      </div>

      {selected && (
        <div className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
          {selected.kind === 'READY_MADE' && selected.slug && <p>{t(`funnels.ready.${selected.slug}.description` as MessageKey)}</p>}
          <p>{selected.windowDays === null ? t('funnels.window.none') : t('funnels.window.days', { days: selected.windowDays })}</p>
        </div>
      )}

      {loading && !report ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message={error} />
      ) : report && first && last ? (
        first.reached === 0 ? (
          <EmptyState title={t('funnels.empty.title')} description={report.funnel.requiresSiteTracking ? t('funnels.empty.tracking') : t('funnels.empty.description')} />
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <StatTile label={t('funnels.col.entered')} value={count(first.reached)} />
              <StatTile label={t('funnels.col.converted')} value={count(last.reached)} />
              <StatTile label={t('funnels.col.overall')} value={percent(last.rateFromFirst)} />
            </div>

            <ol className="space-y-3" aria-label={t('funnels.title')}>
              {report.steps.map((step, k) => (
                <FunnelStepRow
                  key={step.key}
                  step={step}
                  index={k}
                  label={stepLabel(step.key)}
                  percent={percent}
                  count={count}
                  duration={duration}
                  previous={report.previous?.steps[k] ?? null}
                  change={comparison?.[k] ?? null}
                />
              ))}
            </ol>

            {report.breakdown && (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                  {t('funnels.breakdown.title', { name: t(`funnels.breakdown.${report.breakdown}` as MessageKey) })}
                </h3>
                <div className="overflow-x-auto" style={{ borderRadius: 'var(--radius-card)', border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
                  <table className="w-full text-xs">
                    <thead>
                      <tr style={{ color: 'var(--color-text-secondary)' }}>
                        <th className="text-left font-medium px-3 py-2">{t(`funnels.breakdown.${report.breakdown}` as MessageKey)}</th>
                        {report.steps.map((s) => (
                          <th key={s.key} className="text-right font-medium px-3 py-2">
                            {stepLabel(s.key)}
                          </th>
                        ))}
                        <th className="text-right font-medium px-3 py-2">{t('funnels.col.overall')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.groups.map((g) => (
                        <tr key={g.key} style={{ borderTop: '1px solid var(--color-border)', color: 'var(--color-text-primary)' }}>
                          <td className="px-3 py-2">{groupLabel(g.key, g.label)}</td>
                          {g.steps.map((s) => (
                            <td key={s.key} className="text-right px-3 py-2">
                              {count(s.reached)}
                              <span style={{ color: 'var(--color-text-muted)' }}> ({percent(s.rateFromFirst)})</span>
                            </td>
                          ))}
                          <td className="text-right px-3 py-2 font-medium">{percent(g.steps[g.steps.length - 1]?.rateFromFirst ?? null)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )
      ) : null}

      {editing && (
        <FunnelEditor
          funnel={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            setEditing(null);
            setSelectedId(saved.id);
            setListKey((k) => k + 1);
          }}
        />
      )}
    </div>
  );
}

interface StepRowProps {
  step: FunnelStepStatDTO;
  index: number;
  label: string;
  percent: (ratio: number | null) => string;
  count: (n: number) => string;
  duration: (seconds: number | null) => string;
  previous: FunnelStepStatDTO | null;
  change: ReturnType<typeof compareFunnelSteps>[number] | null;
}

function FunnelStepRow({ step, index, label, percent, count, duration, previous, change }: StepRowProps) {
  const t = useT();
  const width = step.rateFromFirst === null ? 0 : Math.max(0, Math.min(1, step.rateFromFirst)) * 100;
  const tone = change === null || change.reached.direction === 'neutral' ? 'neutral' : change.reached.direction === 'up' ? 'success' : 'danger';
  return (
    <li className="space-y-1">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 text-xs">
        <span className="font-medium" style={{ color: 'var(--color-text-primary)' }}>
          {index + 1}. {label}
        </span>
        <span style={{ color: 'var(--color-text-secondary)' }}>
          {index > 0 && (
            <>
              {t('funnels.col.fromPrevious')}: {percent(step.rateFromPrevious)}
              {' | '}
              {t('funnels.col.median')}: {duration(step.medianSecondsFromPrevious)}
              {' | '}
            </>
          )}
          {t('funnels.col.fromFirst')}: {percent(step.rateFromFirst)}
        </span>
      </div>
      <div className="h-7 overflow-hidden" style={{ backgroundColor: 'var(--color-surface-muted)', borderRadius: 'var(--radius-input)' }}>
        <div
          className="h-full flex items-center px-2 text-xs font-semibold"
          style={{ width: `${width}%`, minWidth: '2.5rem', backgroundColor: 'var(--color-primary)', color: 'var(--color-on-primary)', borderRadius: 'var(--radius-input)' }}
        >
          {count(step.reached)}
        </div>
      </div>
      {previous && change && (
        <div className="flex flex-wrap items-center gap-2 text-xs" style={{ color: 'var(--color-text-muted)' }}>
          <span>{t('funnels.compare.previous', { value: count(previous.reached) })}</span>
          <Badge tone={tone}>{change.reached.changeRatio === null ? t('funnels.compare.noPrevious') : percent(change.reached.changeRatio)}</Badge>
        </div>
      )}
    </li>
  );
}
