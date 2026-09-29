'use client';

import { useEffect, useState } from 'react';
import type { RetailSalesReportDTO } from '@platform/shared';
import { useDashboardSession, useFormatMoney } from '@/components/session/DashboardSessionProvider';
import { useT } from '@/components/i18n/I18nProvider';
import { bffFetch } from '@/lib/session/client';
import { buildReportQuery } from '@/lib/reports/query';
import { retailErrorMessage } from '@/lib/retail/errors';
import { LoadingState, ErrorState } from '@/components/common/DataState';
import { BranchSelect } from '@/components/common/BranchSelect';
import { DateRangeFilter } from '@/components/common/DateRangeFilter';
import { fieldStyle, headRowStyle, labelStyle, rowStyle, sectionStyle, tableWrapStyle } from './styles';

/** Simple sales report: totals, by product (with margin where a cost is known) and by day, with CSV export. */
export function ReportTab() {
  const t = useT();
  const formatMoney = useFormatMoney();
  const { activeStudioId } = useDashboardSession();
  const [branchId, setBranchId] = useState('');
  const [from, setFrom] = useState<Date | null>(null);
  const [to, setTo] = useState<Date | null>(null);
  const [report, setReport] = useState<RetailSalesReportDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!activeStudioId) return;
    setLoading(true);
    setError(null);
    const qs = buildReportQuery({ from, to, branchId: branchId || null });
    bffFetch<RetailSalesReportDTO>(`studios/${activeStudioId}/retail/reports/sales${qs ? `?${qs}` : ''}`, { studioId: activeStudioId })
      .then(setReport)
      .catch((err) => setError(retailErrorMessage(t, err, 'retail.loadFailed')))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStudioId, branchId, from, to]);

  const csvHref = (view: 'product' | 'day') => {
    const qs = buildReportQuery({ from, to, branchId: branchId || null, format: 'csv' });
    return `/api/bff/studios/${activeStudioId}/retail/reports/sales?${qs}&view=${view}`;
  };

  const kpis = report
    ? [
        { key: 'saleCount', value: String(report.totals.saleCount) },
        { key: 'itemCount', value: String(report.totals.itemCount) },
        { key: 'gross', value: formatMoney(report.totals.gross) },
        { key: 'refunded', value: formatMoney(report.totals.refunded) },
        { key: 'net', value: formatMoney(report.totals.net) },
        { key: 'tax', value: formatMoney(report.totals.tax) },
        { key: 'margin', value: formatMoney(report.totals.margin) },
      ]
    : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <DateRangeFilter
            from={from}
            to={to}
            onChange={({ from: f, to: t2 }) => {
              setFrom(f);
              setTo(t2);
            }}
          />
          <BranchSelect value={branchId} onChange={setBranchId} />
        </div>
        <div className="flex gap-2">
          <a href={csvHref('product')} className="text-xs font-medium px-3 py-1.5" style={{ ...fieldStyle, background: 'var(--color-surface-muted)' }}>
            {t('retail.report.csvProduct')}
          </a>
          <a href={csvHref('day')} className="text-xs font-medium px-3 py-1.5" style={{ ...fieldStyle, background: 'var(--color-surface-muted)' }}>
            {t('retail.report.csvDay')}
          </a>
        </div>
      </div>
      {loading && <LoadingState />}
      {error && <ErrorState message={error} />}
      {!loading && !error && report && (
        <>
          <dl className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
            {kpis.map((k) => (
              <div key={k.key} className="p-3" style={sectionStyle}>
                <dt className="text-[11px]" style={labelStyle}>
                  {t(`retail.report.${k.key}`)}
                </dt>
                <dd className="text-lg font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                  {k.value}
                </dd>
              </div>
            ))}
          </dl>
          <p className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
            {t('retail.report.marginHint')}
          </p>
          {report.byProduct.length === 0 ? (
            <p className="text-sm" style={labelStyle}>
              {t('retail.report.empty')}
            </p>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              <section className="space-y-2">
                <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                  {t('retail.report.byProduct')}
                </h3>
                <div className="border overflow-x-auto" style={tableWrapStyle}>
                  <table className="w-full text-sm">
                    <thead>
                      <tr style={headRowStyle}>
                        {(['product', 'quantity', 'refundedQuantity', 'revenue', 'margin'] as const).map((c) => (
                          <th key={c} className="text-left px-3 py-2 font-medium whitespace-nowrap" style={labelStyle}>
                            {t(`retail.report.col.${c}`)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {report.byProduct.map((p) => (
                        <tr key={p.productId} className="border-t" style={rowStyle}>
                          <td className="px-3 py-2" style={{ color: 'var(--color-text-primary)' }}>
                            {p.productName}
                          </td>
                          <td className="px-3 py-2">{p.quantity}</td>
                          <td className="px-3 py-2">{p.refundedQuantity}</td>
                          <td className="px-3 py-2 whitespace-nowrap">{formatMoney(p.revenue)}</td>
                          <td className="px-3 py-2 whitespace-nowrap">{formatMoney(p.margin)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
              <section className="space-y-2">
                <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                  {t('retail.report.byDay')}
                </h3>
                <div className="border overflow-x-auto" style={tableWrapStyle}>
                  <table className="w-full text-sm">
                    <thead>
                      <tr style={headRowStyle}>
                        {(['date', 'saleCount', 'gross', 'refunded'] as const).map((c) => (
                          <th key={c} className="text-left px-3 py-2 font-medium whitespace-nowrap" style={labelStyle}>
                            {t(`retail.report.col.${c}`)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {report.byDay.map((d) => (
                        <tr key={d.date} className="border-t" style={rowStyle}>
                          <td className="px-3 py-2" style={{ color: 'var(--color-text-primary)' }}>
                            {d.date}
                          </td>
                          <td className="px-3 py-2">{d.saleCount}</td>
                          <td className="px-3 py-2 whitespace-nowrap">{formatMoney(d.gross)}</td>
                          <td className="px-3 py-2 whitespace-nowrap">{formatMoney(d.refunded)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
          )}
        </>
      )}
    </div>
  );
}
