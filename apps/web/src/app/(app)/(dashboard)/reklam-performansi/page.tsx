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
import { Select, Table, Thead, Tbody, Tr, Th, Td } from '@/components/ui';
import { PageHeader } from '@/components/ui/PageHeader';

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
    <div className="space-y-3">
      <div className="pui-card overflow-x-auto">
        <Table>
          <Thead>
            <Tr>
              <Th>{t(`ads.report.groupBy.${report.groupBy}` as never)}</Th>
              <Th className="text-right">{t('ads.report.spend')}</Th>
              <Th className="text-right">{t('ads.report.leads')}</Th>
              <Th className="text-right">{t('ads.report.purchases')}</Th>
              <Th className="text-right">{t('ads.report.revenue')}</Th>
              <Th className="text-right">{t('ads.report.cpl')}</Th>
              <Th className="text-right">{t('ads.report.cac')}</Th>
              <Th className="text-right">{t('ads.report.roas')}</Th>
            </Tr>
          </Thead>
          <Tbody>
            {report.rows.map((row) => (
              <Tr key={row.key}>
                <Td>{row.key}</Td>
                <Td className="text-right">{money(row.spend)}</Td>
                <Td className="text-right">{row.conversions.lead ?? 0}</Td>
                <Td className="text-right">{row.conversions.purchase ?? 0}</Td>
                <Td className="text-right">{money(row.revenue)}</Td>
                <Td className="text-right">{ratio(row.cpl)}</Td>
                <Td className="text-right">{ratio(row.cac)}</Td>
                <Td className="text-right">{ratio(row.roas)}</Td>
              </Tr>
            ))}
            <Tr className="ui-strong">
              <Td>{t('ads.report.totals')}</Td>
              <Td className="text-right">{money(report.totals.spend)}</Td>
              <Td className="text-right">{report.totals.conversions.lead ?? 0}</Td>
              <Td className="text-right">{report.totals.conversions.purchase ?? 0}</Td>
              <Td className="text-right">{money(report.totals.revenue)}</Td>
              <Td className="text-right">{ratio(report.totals.cpl)}</Td>
              <Td className="text-right">{ratio(report.totals.cac)}</Td>
              <Td className="text-right">{ratio(report.totals.roas)}</Td>
            </Tr>
          </Tbody>
        </Table>
      </div>
      <p className="ui-caption">
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
      <PageHeader title={t('ads.report.title')} description={t('ads.report.description')} />

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <span className="block mb-1 ui-strong ui-caption">
            {t('ads.report.model')}
          </span>
          <Select value={model} onChange={(e) => setModel(e.target.value as AttributionModel)}>
            {ATTRIBUTION_MODELS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <span className="block mb-1 ui-strong ui-caption">
            {t('ads.report.groupBy')}
          </span>
          <Select value={groupBy} onChange={(e) => setGroupBy(e.target.value as AttributionGroupBy)}>
            {ATTRIBUTION_GROUP_BY.map((g) => (
              <option key={g} value={g}>
                {t(`ads.report.groupBy.${g}` as never)}
              </option>
            ))}
          </Select>
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
