'use client';

import { useFormatMoney } from '@/components/session/DashboardSessionProvider';
import { useLocale, useT } from '@/components/i18n/I18nProvider';
import { formatPercent as formatPercentShared } from '@/lib/money';
import { compareKpi } from '@/lib/reports/compare';
import type { ReportKpi } from '@/lib/reports/kpis';
import { StatTile } from '@/components/ui/StatTile';

const DIRECTION_CLASS: Record<'up' | 'down' | 'neutral', string> = {
  up: 'ui-text-success',
  down: 'ui-text-error',
  neutral: 'ui-text-muted',
};

const DIRECTION_ARROW: Record<'up' | 'down' | 'neutral', string> = {
  up: '↑',
  down: '↓',
  neutral: '→',
};

/**
 * Current-period KPI tiles with the previous-period value and percentage
 * change underneath, for the /raporlar "compare with previous period"
 * toggle. Renders nothing for a tab with no KPIs (cohorts) or before the
 * previous-period report has loaded.
 */
export function CompareStrip({ current, previous }: { current: ReportKpi[]; previous: ReportKpi[] }) {
  const t = useT();
  const locale = useLocale();
  const formatMoney = useFormatMoney();
  const formatPercent = (ratio: number) => formatPercentShared(ratio, locale, 1);

  if (current.length === 0) return null;
  const previousByKey = new Map(previous.map((kpi) => [kpi.key, kpi]));

  const formatValue = (kpi: ReportKpi): string => {
    if (kpi.format === 'money') return formatMoney(kpi.value);
    if (kpi.format === 'percent') return formatPercent(kpi.value);
    return new Intl.NumberFormat(locale).format(Math.round(kpi.value));
  };

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
      {current.map((kpi) => {
        const prev = previousByKey.get(kpi.key);
        const change = prev ? compareKpi(kpi.value, prev.value) : null;
        return (
          <StatTile
            key={kpi.key}
            label={t(kpi.labelKey)}
            value={formatValue(kpi)}
            hint={
              prev && change ? (
                <span className="grid gap-0.5">
                  <span className={`flex items-center gap-1 ${DIRECTION_CLASS[change.direction]}`}>
                    <span>{DIRECTION_ARROW[change.direction]}</span>
                    <span>{change.changeRatio === null ? t('reports.compare.noPrevious') : formatPercent(Math.abs(change.changeRatio))}</span>
                  </span>
                  <span>{t('reports.compare.previous', { value: formatValue(prev) })}</span>
                </span>
              ) : undefined
            }
          />
        );
      })}
    </div>
  );
}
