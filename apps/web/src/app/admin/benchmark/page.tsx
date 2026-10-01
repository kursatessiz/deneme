'use client';

import { useBff } from '@/lib/session/use-bff';
import { useLocale, useT } from '@/components/i18n/I18nProvider';
import { LoadingState, ErrorState, EmptyState } from '@/components/common/DataState';
import { Card, CardContent } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';

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
    <div className="grid gap-6">
      <PageHeader title={t('adminBenchmark.title')} description={t('adminBenchmark.subtitle')} />

      {loading && <LoadingState />}
      {error && <ErrorState message={error} />}
      {!loading && !error && data && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {data.buckets.map((b) => (
            <Card key={b.businessTypeTemplateKey}>
              <CardContent>
                <div className="grid gap-1">
                  <h3 className="ui-heading">{b.businessTypeTemplateName}</h3>
                  <p className="ui-caption">{t('adminBenchmark.studioCount', { count: b.studioCount })}</p>
                </div>
                {b.suppressed ? (
                  <p className="ui-caption">{t('adminBenchmark.suppressed')}</p>
                ) : (
                  <ul className="ui-small grid gap-1">
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
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
