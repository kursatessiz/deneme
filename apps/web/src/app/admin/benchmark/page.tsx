'use client';

import { useBff } from '@/lib/session/use-bff';
import { useLocale, useT } from '@/components/i18n/I18nProvider';
import { LoadingState, ErrorState, EmptyState } from '@/components/common/DataState';

interface Bucket {
  businessTypeTemplateKey: string;
  businessTypeTemplateName: string;
  studioCount: number;
  suppressed: boolean;
  avgOccupancyRate: number | null;
  avgCancellationRate: number | null;
  avgRevenuePerMember: number | null;
  avgRenewalRate: number | null;
}

function pct(v: number | null) {
  return v === null ? '-' : `%${Math.round(v * 100)}`;
}

export default function BenchmarkPage() {
  const locale = useLocale();
  const t = useT();
  const { data, loading, error, forbidden } = useBff<{ buckets: Bucket[] }>('admin/benchmark', null);

  if (forbidden) return <EmptyState title={t('adminBenchmark.accessDenied')} />;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold">{t('adminBenchmark.title')}</h2>
        <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
          {t('adminBenchmark.subtitle')}
        </p>
      </div>

      {loading && <LoadingState />}
      {error && <ErrorState message={error} />}
      {!loading && !error && data && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {data.buckets.map((b) => (
            <div key={b.businessTypeTemplateKey} className="p-5 border" style={{ borderRadius: 'var(--radius-card)', borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
              <h3 className="text-sm font-semibold">{b.businessTypeTemplateName}</h3>
              <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>{t('adminBenchmark.studioCount', { count: b.studioCount })}</p>
              {b.suppressed ? (
                <p className="text-xs mt-3" style={{ color: 'var(--color-text-muted)' }}>{t('adminBenchmark.suppressed')}</p>
              ) : (
                <ul className="text-xs mt-3 space-y-1" style={{ color: 'var(--color-text-secondary)' }}>
                  <li>{t('adminBenchmark.occupancy', { value: pct(b.avgOccupancyRate) })}</li>
                  <li>{t('adminBenchmark.cancellation', { value: pct(b.avgCancellationRate) })}</li>
                  <li>
                    {t('adminBenchmark.revenuePerMember', {
                      value:
                        b.avgRevenuePerMember === null
                          ? '-'
                          : t('adminBenchmark.revenuePerMemberValue', { amount: Math.round(b.avgRevenuePerMember).toLocaleString(locale) }),
                    })}
                  </li>
                  <li>{t('adminBenchmark.renewal', { value: pct(b.avgRenewalRate) })}</li>
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
