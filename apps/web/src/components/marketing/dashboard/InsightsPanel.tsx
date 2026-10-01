'use client';

import { useEffect, useMemo, useState } from 'react';
import { insightMetricLabel, formatInsightChange, formatInsightValue, type InsightListDTO, type MarketingInsightDTO } from '@platform/shared';
import { bffFetch, BffError } from '@/lib/session/client';
import { useLocale, useT } from '@/components/i18n/I18nProvider';
import { Section } from '@/components/settings/ui';
import { usePlatformSession } from '../PlatformSession';
import { Table, Thead, Tbody, Tr, Th, Td } from '@/components/ui';

const HISTORY_LIMIT = 8;


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
        <p className="whitespace-pre-line">{insight.summary}</p>
        {insight.actions.length > 0 && (
          <div className="space-y-2">
            <h4 className="ui-strong ui-small">
              {t('marketingInsights.actions.title')}
            </h4>
            <ol className="space-y-2 list-decimal pl-5">
              {insight.actions.map((a, i) => (
                <li key={i}>
                  <span className="ui-strong">{a.title}</span>
                  <span className="ui-text-muted">: {a.detail}</span>
                  <span className="block ui-caption">
                    {t('marketingInsights.actions.basis', { metric: metricLabelOf.get(a.kpiKey) ?? a.kpiKey })}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        )}
        <div className="space-y-2">
          <h4 className="ui-strong ui-small">
            {t('marketingInsights.metrics.title')}
          </h4>
          <div className="overflow-x-auto">
            <Table>
              <Thead>
                <Tr>
                  <Th scope="col">
                    {t('marketingInsights.metrics.metric')}
                  </Th>
                  <Th scope="col" className="text-right">
                    {t('marketingInsights.metrics.thisWeek')}
                  </Th>
                  <Th scope="col" className="text-right">
                    {t('marketingInsights.metrics.previousWeek')}
                  </Th>
                  <Th scope="col" className="text-right">
                    {t('marketingInsights.metrics.change')}
                  </Th>
                </Tr>
              </Thead>
              <Tbody>
                {insight.kpis.metrics
                  .filter((m) => m.current !== null || m.previous !== null)
                  .map((m) => (
                    <Tr key={m.key}>
                      <Th scope="row">
                        {insightMetricLabel(m, t)}
                      </Th>
                      <Td className="text-right tabular-nums">{formatInsightValue(m, m.current, locale, hidden)}</Td>
                      <Td className="text-right tabular-nums">{formatInsightValue(m, m.previous, locale, hidden)}</Td>
                      <Td className="text-right tabular-nums">{formatInsightChange(m.changeRatio, locale) ?? t('funnels.noValue')}</Td>
                    </Tr>
                  ))}
              </Tbody>
            </Table>
          </div>
        </div>
      </div>
    );
  }

  const [latest, ...earlier] = items ?? [];
  return (
    <Section title={t('marketingInsights.title')} description={latest ? period(latest) : t('marketingInsights.subtitle')}>
      {error && (
        <p role="alert" className="ui-text-error">
          {error}
        </p>
      )}
      {!error && items === null && (
        <p className="ui-text-muted">
          {t('marketingInsights.loading')}
        </p>
      )}
      {!error && items !== null && !latest && (
        <p className="ui-text-muted">
          {t('marketingInsights.empty')}
        </p>
      )}
      {latest && body(latest)}
      {earlier.length > 0 && (
        <div className="space-y-2">
          <h4 className="ui-strong ui-small">
            {t('marketingInsights.earlier')}
          </h4>
          {earlier.map((insight) => (
            <details key={insight.id} className="pt-2 ui-rule">
              <summary className="cursor-pointer">{period(insight)}</summary>
              <div className="pt-3">{body(insight)}</div>
            </details>
          ))}
        </div>
      )}
    </Section>
  );
}
