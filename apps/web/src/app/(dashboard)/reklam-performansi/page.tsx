'use client';

import { useState } from 'react';
import { ATTRIBUTION_GROUP_BY, ATTRIBUTION_MODELS } from '@platform/shared';
import type { AttributionGroupBy, AttributionModel, AttributionReportDTO } from '@platform/shared';
import { useDashboardSession } from '@/components/session/DashboardSessionProvider';
import { useT } from '@/components/i18n/I18nProvider';
import { useBff } from '@/lib/session/use-bff';
import { LoadingState, EmptyState, ErrorState } from '@/components/common/DataState';
import { PageGuard } from '@/components/common/PageGuard';
import { DateRangeFilter } from '@/components/common/DateRangeFilter';

const selectStyle: React.CSSProperties = {
  borderRadius: 'var(--radius-input)',
  border: '1px solid var(--color-border)',
  backgroundColor: 'var(--color-surface)',
  color: 'var(--color-text-primary)',
};

function money(rec: Record<string, string>): string {
  const entries = Object.entries(rec);
  if (entries.length === 0) return '—';
  return entries.map(([currency, amount]) => `${amount} ${currency}`).join(', ');
}

function ratio(rec: Record<string, number | null>): string {
  const entries = Object.entries(rec).filter(([, v]) => v !== null);
  if (entries.length === 0) return '—';
  return entries.map(([currency, v]) => `${(v as number).toFixed(2)} ${currency}`).join(', ');
}

function ReportTable({ report }: { report: AttributionReportDTO }) {
  const t = useT();
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr style={{ color: 'var(--color-text-secondary)' }}>
            <th className="text-left py-2 pr-4">{t(`ads.report.groupBy.${report.groupBy}` as never)}</th>
            <th className="text-right py-2 pr-4">{t('ads.report.spend')}</th>
            <th className="text-right py-2 pr-4">{t('ads.report.leads')}</th>
            <th className="text-right py-2 pr-4">{t('ads.report.purchases')}</th>
            <th className="text-right py-2 pr-4">{t('ads.report.revenue')}</th>
            <th className="text-right py-2 pr-4">{t('ads.report.cpl')}</th>
            <th className="text-right py-2 pr-4">{t('ads.report.cac')}</th>
            <th className="text-right py-2">{t('ads.report.roas')}</th>
          </tr>
        </thead>
        <tbody>
          {report.rows.map((row) => (
            <tr key={row.key} className="border-t" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-primary)' }}>
              <td className="py-2 pr-4">{row.key}</td>
              <td className="text-right py-2 pr-4">{money(row.spend)}</td>
              <td className="text-right py-2 pr-4">{row.conversions.lead ?? 0}</td>
              <td className="text-right py-2 pr-4">{row.conversions.purchase ?? 0}</td>
              <td className="text-right py-2 pr-4">{money(row.revenue)}</td>
              <td className="text-right py-2 pr-4">{ratio(row.cpl)}</td>
              <td className="text-right py-2 pr-4">{ratio(row.cac)}</td>
              <td className="text-right py-2">{ratio(row.roas)}</td>
            </tr>
          ))}
          <tr className="border-t font-semibold" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-primary)' }}>
            <td className="py-2 pr-4">{t('ads.report.totals')}</td>
            <td className="text-right py-2 pr-4">{money(report.totals.spend)}</td>
            <td className="text-right py-2 pr-4">{report.totals.conversions.lead ?? 0}</td>
            <td className="text-right py-2 pr-4">{report.totals.conversions.purchase ?? 0}</td>
            <td className="text-right py-2 pr-4">{money(report.totals.revenue)}</td>
            <td className="text-right py-2 pr-4">{ratio(report.totals.cpl)}</td>
            <td className="text-right py-2 pr-4">{ratio(report.totals.cac)}</td>
            <td className="text-right py-2">{ratio(report.totals.roas)}</td>
          </tr>
        </tbody>
      </table>
      <p className="text-xs mt-3" style={{ color: 'var(--color-text-muted)' }}>
        {t('ads.report.untaggedPaidTraffic')}: {report.untaggedPaidTouchpoints}
      </p>
    </div>
  );
}

function AdsReport() {
  const t = useT();
  const { activeStudioId } = useDashboardSession();
  const [model, setModel] = useState<AttributionModel>('LAST_TOUCH');
  const [groupBy, setGroupBy] = useState<AttributionGroupBy>('source');
  const [from, setFrom] = useState<Date | null>(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
  const [to, setTo] = useState<Date | null>(new Date());

  const path =
    activeStudioId && from && to
      ? `crm/studios/${activeStudioId}/attribution?model=${model}&groupBy=${groupBy}&from=${from.toISOString()}&to=${to.toISOString()}`
      : null;
  const { data, loading, error } = useBff<AttributionReportDTO>(path, activeStudioId);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--color-text-primary)' }}>
          {t('ads.report.title')}
        </h2>
        <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
          {t('ads.report.description')}
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <span className="text-xs font-medium block mb-1" style={{ color: 'var(--color-text-secondary)' }}>
            {t('ads.report.model')}
          </span>
          <select value={model} onChange={(e) => setModel(e.target.value as AttributionModel)} className="px-3 py-2 text-sm" style={selectStyle}>
            {ATTRIBUTION_MODELS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
        <div>
          <span className="text-xs font-medium block mb-1" style={{ color: 'var(--color-text-secondary)' }}>
            {t('ads.report.groupBy')}
          </span>
          <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as AttributionGroupBy)} className="px-3 py-2 text-sm" style={selectStyle}>
            {ATTRIBUTION_GROUP_BY.map((g) => (
              <option key={g} value={g}>
                {t(`ads.report.groupBy.${g}` as never)}
              </option>
            ))}
          </select>
        </div>
        <DateRangeFilter
          from={from}
          to={to}
          onChange={(range) => {
            setFrom(range.from);
            setTo(range.to);
          }}
        />
      </div>

      {loading && <LoadingState />}
      {error && <ErrorState message={error} />}
      {!loading && !error && data && data.rows.length === 0 && <EmptyState title={t('ads.report.empty')} />}
      {!loading && !error && data && data.rows.length > 0 && <ReportTable report={data} />}
    </div>
  );
}

export default function AdsReportPage() {
  return (
    <PageGuard required={['ads.view']}>
      <AdsReport />
    </PageGuard>
  );
}
