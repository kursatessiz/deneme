'use client';

import type { RenewalReportDTO } from '@platform/shared';
import { formatPercent as formatPercentShared } from '@/lib/money';
import { useLocale, useT } from '@/components/i18n/I18nProvider';
import { LoadingState, ErrorState } from '@/components/common/DataState';
import { StatTile } from './Bar';

type RenewalReport = RenewalReportDTO;

export function RenewalReport({ report, loading, error }: { report: RenewalReport | null; loading: boolean; error: string | null }) {
  const t = useT();
  const locale = useLocale();
  const formatPercent = (ratio: number | null | undefined, fractionDigits?: number) => formatPercentShared(ratio, locale, fractionDigits);
  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} />;
  if (!report) return null;

  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <StatTile label={t('reports.renewal.expired')} value={String(report.expiredPackages)} />
        <StatTile label={t('reports.renewal.renewed')} value={String(report.renewedPackages)} />
        <StatTile label={t('reports.renewal.rate')} value={formatPercent(report.renewalRate, 1)} />
      </div>
      <div className="h-2.5 overflow-hidden max-w-md ui-panel">
        <div className="h-full ui-bar-fill" style={{ width: `${Math.min(100, report.renewalRate * 100)}%` }} />
      </div>
    </div>
  );
}
