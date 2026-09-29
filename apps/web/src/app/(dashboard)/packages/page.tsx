'use client';

import { useDashboardSession, useFormatMoney } from '@/components/session/DashboardSessionProvider';
import { useT } from '@/components/i18n/I18nProvider';
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
  const t = useT();
  const formatMoney = useFormatMoney();
  const { activeStudioId } = useDashboardSession();
  const { data: packages, loading, error } = useBff<PackageDefinitionRow[]>(`catalog/package-definitions/studio/${activeStudioId}`, activeStudioId);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--color-text-primary)' }}>
          {t('packages.title')}
        </h2>
        <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
          {t('packages.subtitle')}
        </p>
      </div>

      {loading && <LoadingState />}
      {error && <ErrorState message={error} />}
      {!loading && !error && (!packages || packages.length === 0) && (
        <EmptyState
          title={t('packages.empty.title')}
          description={t('packages.empty.description')}
          action={{ labelKey: 'packages.empty.action', href: '/ayarlar/isletme', permissions: ['catalog.manage'] }}
        />
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
                <p className="text-2xl font-extrabold mt-3">{formatMoney(pkg.price)}</p>
              </div>
              <div className="mt-4 text-xs space-y-1 opacity-90">
                <div>{pkg.totalUnits ? t('packages.units', { count: pkg.totalUnits }) : t('packages.unlimited')}</div>
                <div>{t('packages.validity', { count: pkg.validityDays })}</div>
                <div>{t('packages.freezeDays', { count: pkg.freezeDaysAllowed })}</div>
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
