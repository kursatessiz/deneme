'use client';

import { useEffect, useMemo, useState } from 'react';
import { insightMetricLabel, formatInsightChange, formatInsightValue, type InsightListDTO, type MarketingInsightDTO } from '@platform/shared';
import { bffFetch, BffError } from '@/lib/session/client';
import { useLocale, useT } from '@/components/i18n/I18nProvider';
import { Section } from '@/components/settings/ui';
import { usePlatformSession } from '../PlatformSession';

const HISTORY_LIMIT = 8;

const muted: React.CSSProperties = { color: 'var(--color-text-muted)' };

/**
 * The weekly marketing summary on the dashboard (M3d, docs/PAZARLAMA_MODULU.md
 * 3.3): the newest summary with its suggested actions and figures against the
 * week before, and the earlier weeks folded away. The API generates it once a
 * week; nothing here calls the model. Numbers are formatted in the viewer's
 * locale, money in its own currency. A flat section, no card in a card.
 */
export function InsightsPanel() {
  const t = useT();
  const locale = useLocale();
  const { platformStudioId } = usePlatformSession();
  const [items, setItems] = useState<MarketingInsightDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    bffFetch<InsightListDTO>(`platform/marketing/insights?limit=${HISTORY_LIMIT}`)
      .then((res) => {
        if (cancelled) return;
        setItems(res.items);
        setError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof BffError ? err.message : t('marketingInsights.loadFailed'));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platformStudioId]);

  const day = useMemo(() => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }), [locale]);
  const period = (insight: MarketingInsightDTO) =>
    t('marketingInsights.period', { from: day.format(new Date(`${insight.periodStart}T00:00:00.000Z`)), to: day.format(new Date(`${insight.periodEnd}T00:00:00.000Z`)) });

  function body(insight: MarketingInsightDTO) {
    const hidden = t('marketingInsights.hidden', { min: insight.kpis.minCell });
    const metricLabelOf = new Map(insight.kpis.metrics.map((m) => [m.key, insightMetricLabel(m, t)]));
    return (
      <div className="space-y-4">
        <p className="text-sm whitespace-pre-line">{insight.summary}</p>
        {insight.actions.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-xs font-semibold" style={{ color: 'var(--color-text-primary)' }}>
              {t('marketingInsights.actions.title')}
            </h4>
            <ol className="space-y-2 list-decimal pl-5">
              {insight.actions.map((a, i) => (
                <li key={i} className="text-sm">
                  <span className="font-medium">{a.title}</span>
                  <span style={{ color: 'var(--color-text-secondary)' }}>: {a.detail}</span>
                  <span className="block text-xs" style={muted}>
                    {t('marketingInsights.actions.basis', { metric: metricLabelOf.get(a.kpiKey) ?? a.kpiKey })}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        )}
        <div className="space-y-2">
          <h4 className="text-xs font-semibold" style={{ color: 'var(--color-text-primary)' }}>
            {t('marketingInsights.metrics.title')}
          </h4>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs" style={muted}>
                  <th scope="col" className="py-1 pr-4 font-medium">
                    {t('marketingInsights.metrics.metric')}
                  </th>
                  <th scope="col" className="py-1 pr-4 font-medium text-right">
                    {t('marketingInsights.metrics.thisWeek')}
                  </th>
                  <th scope="col" className="py-1 pr-4 font-medium text-right">
                    {t('marketingInsights.metrics.previousWeek')}
                  </th>
                  <th scope="col" className="py-1 font-medium text-right">
                    {t('marketingInsights.metrics.change')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {insight.kpis.metrics
                  .filter((m) => m.current !== null || m.previous !== null)
                  .map((m) => (
                    <tr key={m.key} className="border-t" style={{ borderColor: 'var(--color-border)' }}>
                      <th scope="row" className="py-1.5 pr-4 text-left font-normal">
                        {insightMetricLabel(m, t)}
                      </th>
                      <td className="py-1.5 pr-4 text-right tabular-nums">{formatInsightValue(m, m.current, locale, hidden)}</td>
                      <td className="py-1.5 pr-4 text-right tabular-nums">{formatInsightValue(m, m.previous, locale, hidden)}</td>
                      <td className="py-1.5 text-right tabular-nums">{formatInsightChange(m.changeRatio, locale) ?? t('funnels.noValue')}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  const [latest, ...earlier] = items ?? [];
  return (
    <Section title={t('marketingInsights.title')} description={latest ? period(latest) : t('marketingInsights.subtitle')}>
      {error && (
        <p role="alert" className="text-sm" style={{ color: 'var(--color-danger)' }}>
          {error}
        </p>
      )}
      {!error && items === null && (
        <p className="text-sm" style={muted}>
          {t('marketingInsights.loading')}
        </p>
      )}
      {!error && items !== null && !latest && (
        <p className="text-sm" style={muted}>
          {t('marketingInsights.empty')}
        </p>
      )}
      {latest && body(latest)}
      {earlier.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold" style={{ color: 'var(--color-text-primary)' }}>
            {t('marketingInsights.earlier')}
          </h4>
          {earlier.map((insight) => (
            <details key={insight.id} className="border-t pt-2" style={{ borderColor: 'var(--color-border)' }}>
              <summary className="text-sm cursor-pointer">{period(insight)}</summary>
              <div className="pt-3">{body(insight)}</div>
            </details>
          ))}
        </div>
      )}
    </Section>
  );
}
