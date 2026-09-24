'use client';

import type { RevenueReportDTO } from '@platform/shared';
import { formatMoney } from '@/lib/money';
import { LoadingState, EmptyState, ErrorState } from '@/components/common/DataState';
import { Bar, StatTile } from './Bar';

type RevenueReport = RevenueReportDTO;

const METHOD_LABEL: Record<string, string> = {
  CASH: 'Nakit',
  CREDIT_CARD_POS: 'Kredi kartı (POS)',
  BANK_TRANSFER: 'Havale/EFT',
  ONLINE_IYZICO: 'Online (iyzico)',
  ONLINE_PAYTR: 'Online (PayTR)',
};

export function RevenueReport({ report, loading, error }: { report: RevenueReport | null; loading: boolean; error: string | null }) {
  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} />;
  if (!report) return <EmptyState title="Veri yok" />;

  const maxPeriod = Math.max(...report.byPeriod.map((p) => Number(p.amount)), 0.0001);
  const maxMethod = Math.max(...report.byMethod.map((m) => Number(m.amount)), 0.0001);
  const maxPackage = Math.max(...report.byPackage.map((p) => Number(p.amount)), 0.0001);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <StatTile label="Brüt gelir" value={formatMoney(report.total)} />
        <StatTile label="İade" value={formatMoney(report.refundTotal)} />
        <StatTile label="Net gelir" value={formatMoney(report.netTotal)} />
      </div>

      <div>
        <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--color-text-primary)' }}>
          Döneme göre
        </h3>
        <div className="space-y-2">
          {report.byPeriod.map((p) => (
            <Bar key={p.period} label={p.period} value={Number(p.amount)} max={maxPeriod} valueLabel={formatMoney(p.amount)} />
          ))}
          {report.byPeriod.length === 0 && <EmptyState title="Veri yok" />}
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <div>
          <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--color-text-primary)' }}>
            Ödeme yöntemine göre
          </h3>
          <div className="space-y-2">
            {report.byMethod.map((m) => (
              <Bar key={m.paymentMethod} label={METHOD_LABEL[m.paymentMethod] ?? m.paymentMethod} value={Number(m.amount)} max={maxMethod} valueLabel={formatMoney(m.amount)} />
            ))}
          </div>
        </div>
        <div>
          <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--color-text-primary)' }}>
            Pakete göre
          </h3>
          <div className="space-y-2">
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
        </div>
      </div>
    </div>
  );
}
