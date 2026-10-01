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
import { AnchorButton, Card, StatTile, Table, Tbody, Td, Th, Thead, Tr } from '@/components/ui';

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
          <AnchorButton variant="outline" tone="surface" size="sm" href={csvHref('product')}>
            {t('retail.report.csvProduct')}
          </AnchorButton>
          <AnchorButton variant="outline" tone="surface" size="sm" href={csvHref('day')}>
            {t('retail.report.csvDay')}
          </AnchorButton>
        </div>
      </div>
      {loading && <LoadingState />}
      {error && <ErrorState message={error} />}
      {!loading && !error && report && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
            {kpis.map((k) => (
              <StatTile key={k.key} label={t(`retail.report.${k.key}`)} value={k.value} />
            ))}
          </div>
          <p className="ui-caption">{t('retail.report.marginHint')}</p>
          {report.byProduct.length === 0 ? (
            <p className="ui-text-muted">{t('retail.report.empty')}</p>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              <section className="grid gap-2 content-start">
                <h3 className="ui-heading">{t('retail.report.byProduct')}</h3>
                <Card className="overflow-x-auto">
                  <Table>
                    <Thead>
                      <Tr>
                        {(['product', 'quantity', 'refundedQuantity', 'revenue', 'margin'] as const).map((c) => (
                          <Th key={c} className="whitespace-nowrap">
                            {t(`retail.report.col.${c}`)}
                          </Th>
                        ))}
                      </Tr>
                    </Thead>
                    <Tbody>
                      {report.byProduct.map((p) => (
                        <Tr key={p.productId}>
                          <Td>{p.productName}</Td>
                          <Td>{p.quantity}</Td>
                          <Td>{p.refundedQuantity}</Td>
                          <Td className="whitespace-nowrap">{formatMoney(p.revenue)}</Td>
                          <Td className="whitespace-nowrap">{formatMoney(p.margin)}</Td>
                        </Tr>
                      ))}
                    </Tbody>
                  </Table>
                </Card>
              </section>
              <section className="grid gap-2 content-start">
                <h3 className="ui-heading">{t('retail.report.byDay')}</h3>
                <Card className="overflow-x-auto">
                  <Table>
                    <Thead>
                      <Tr>
                        {(['date', 'saleCount', 'gross', 'refunded'] as const).map((c) => (
                          <Th key={c} className="whitespace-nowrap">
                            {t(`retail.report.col.${c}`)}
                          </Th>
                        ))}
                      </Tr>
                    </Thead>
                    <Tbody>
                      {report.byDay.map((d) => (
                        <Tr key={d.date}>
                          <Td>{d.date}</Td>
                          <Td>{d.saleCount}</Td>
                          <Td className="whitespace-nowrap">{formatMoney(d.gross)}</Td>
                          <Td className="whitespace-nowrap">{formatMoney(d.refunded)}</Td>
                        </Tr>
                      ))}
                    </Tbody>
                  </Table>
                </Card>
              </section>
            </div>
          )}
        </>
      )}
    </div>
  );
}
