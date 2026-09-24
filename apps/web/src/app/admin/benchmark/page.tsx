'use client';

import { useBff } from '@/lib/session/use-bff';
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
  const { data, loading, error, forbidden } = useBff<{ buckets: Bucket[] }>('admin/benchmark', null);

  if (forbidden) return <EmptyState title="Erişim yok" />;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold">Karşılaştırma (Benchmark)</h2>
        <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
          İşletme türüne göre anonimleştirilmiş ortalamalar. En az 5 işletmesi olmayan gruplar gizlenir.
        </p>
      </div>

      {loading && <LoadingState />}
      {error && <ErrorState message={error} />}
      {!loading && !error && data && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {data.buckets.map((b) => (
            <div key={b.businessTypeTemplateKey} className="p-5 border" style={{ borderRadius: 'var(--radius-card)', borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
              <h3 className="text-sm font-semibold">{b.businessTypeTemplateName}</h3>
              <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>{b.studioCount} işletme</p>
              {b.suppressed ? (
                <p className="text-xs mt-3" style={{ color: 'var(--color-text-muted)' }}>
                  Yeterli işletme sayısı yok (en az 5 gerekli) - veriler gizlendi
                </p>
              ) : (
                <ul className="text-xs mt-3 space-y-1" style={{ color: 'var(--color-text-secondary)' }}>
                  <li>Doluluk oranı: {pct(b.avgOccupancyRate)}</li>
                  <li>İptal oranı: {pct(b.avgCancellationRate)}</li>
                  <li>Üye başına gelir: {b.avgRevenuePerMember === null ? '-' : `${Math.round(b.avgRevenuePerMember).toLocaleString('tr-TR')} TL`}</li>
                  <li>Yenileme oranı: {pct(b.avgRenewalRate)}</li>
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
