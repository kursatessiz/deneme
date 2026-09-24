'use client';

import { useDashboardSession } from '@/components/session/DashboardSessionProvider';
import { useBff } from '@/lib/session/use-bff';
import { LoadingState, EmptyState, ErrorState } from '@/components/common/DataState';
import { PageGuard } from '@/components/common/PageGuard';

interface PackageDefinitionRow {
  id: string;
  name: string;
  entitlementKind: string;
  totalUnits: number | null;
  validityDays: number;
  price: string;
  freezeDaysAllowed: number;
}

function PackageList() {
  const { activeStudioId } = useDashboardSession();
  const { data: packages, loading, error } = useBff<PackageDefinitionRow[]>(`catalog/package-definitions/studio/${activeStudioId}`, activeStudioId);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--color-text-primary)' }}>
          Paket Tanımları
        </h2>
        <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
          Satışa açık seans/kredi paketleri
        </p>
      </div>

      {loading && <LoadingState />}
      {error && <ErrorState message={error} />}
      {!loading && !error && (!packages || packages.length === 0) && (
        <EmptyState title="Henüz paket tanımı yok" description="İşletme ayarlarından yeni bir paket tanımladığınızda burada görünecek." />
      )}
      {!loading && !error && packages && packages.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {packages.map((pkg) => (
            <div
              key={pkg.id}
              className="p-5 flex flex-col justify-between"
              style={{
                borderRadius: 'var(--radius-card)',
                background: 'var(--gradient-brand)',
                color: 'var(--color-on-primary)',
              }}
            >
              <div>
                <h3 className="font-bold text-lg">{pkg.name}</h3>
                <p className="text-2xl font-extrabold mt-3">{Number(pkg.price).toLocaleString('tr-TR')} ₺</p>
              </div>
              <div className="mt-4 text-xs space-y-1 opacity-90">
                <div>{pkg.totalUnits ? `${pkg.totalUnits} birim` : 'Sınırsız'}</div>
                <div>{pkg.validityDays} gün geçerli</div>
                <div>{pkg.freezeDaysAllowed} gün dondurma hakkı</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function PackagesPage() {
  return (
    <PageGuard required={['catalog.view']}>
      <PackageList />
    </PageGuard>
  );
}
