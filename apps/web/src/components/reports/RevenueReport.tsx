'use client';

import type { RevenueReportDTO } from '@platform/shared';
import { useFormatMoney } from '@/components/session/DashboardSessionProvider';
import { useT } from '@/components/i18n/I18nProvider';
import { LoadingState, EmptyState, ErrorState } from '@/components/common/DataState';
import { Bar, StatTile } from './Bar';
import { Card, CardContent } from '@/components/ui/Card';

type RevenueReport = RevenueReportDTO;

export function RevenueReport({ report, loading, error }: { report: RevenueReport | null; loading: boolean; error: string | null }) {
  const t = useT();
  const formatMoney = useFormatMoney();
  const methodLabel = (m: string) => t(`finance.method.${m}`);
  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} />;
  if (!report) return <EmptyState title={t('reports.empty.title')} />;

  const maxPeriod = Math.max(...report.byPeriod.map((p) => Number(p.amount)), 0.0001);
  const maxMethod = Math.max(...report.byMethod.map((m) => Number(m.amount)), 0.0001);
  const maxPackage = Math.max(...report.byPackage.map((p) => Number(p.amount)), 0.0001);

  return (
    <div className="grid gap-6">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <StatTile label={t('reports.revenue.gross')} value={formatMoney(report.total)} />
        <StatTile label={t('reports.revenue.refund')} value={formatMoney(report.refundTotal)} />
        <StatTile label={t('reports.revenue.net')} value={formatMoney(report.netTotal)} />
      </div>

      <Card>
        <CardContent>
          <h3 className="ui-heading">{t('reports.revenue.byPeriod')}</h3>
          <div className="grid gap-2">
            {report.byPeriod.map((p) => (
              <Bar key={p.period} label={p.period} value={Number(p.amount)} max={maxPeriod} valueLabel={formatMoney(p.amount)} />
            ))}
            {report.byPeriod.length === 0 && <EmptyState title={t('reports.empty.title')} />}
          </div>
        </CardContent>
      </Card>

      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardContent>
            <h3 className="ui-heading">{t('reports.revenue.byMethod')}</h3>
            <div className="grid gap-2">
              {report.byMethod.map((m) => (
                <Bar key={m.paymentMethod} label={methodLabel(m.paymentMethod)} value={Number(m.amount)} max={maxMethod} valueLabel={formatMoney(m.amount)} />
              ))}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <h3 className="ui-heading">{t('reports.revenue.byPackage')}</h3>
            <div className="grid gap-2">
              {report.byPackage.map((p) => (
                <Bar
                  key={p.packageDefinitionId ?? 'none'}
                  label={p.packageDefinitionName}
                  value={Number(p.amount)}
                  max={maxPackage}
                  valueLabel={formatMoney(p.amount)}
                />
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
