'use client';

import { useDashboardSession, useFormatMoney } from '@/components/session/DashboardSessionProvider';
import { useT } from '@/components/i18n/I18nProvider';
import { useBff } from '@/lib/session/use-bff';
import { LoadingState, EmptyState, ErrorState } from '@/components/common/DataState';
import { PageGuard } from '@/components/common/PageGuard';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';

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
    <div className="grid gap-6">
      <PageHeader title={t('packages.title')} description={t('packages.subtitle')} />

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
            <Card key={pkg.id} className="ui-gradient-package-card flex flex-col justify-between gap-4 p-5">
              <div className="grid gap-3">
                <h3 className="ui-heading">{pkg.name}</h3>
                <p className="ui-stat-value">{formatMoney(pkg.price)}</p>
              </div>
              <div className="grid gap-1 opacity-90">
                <div>{pkg.totalUnits ? t('packages.units', { count: pkg.totalUnits }) : t('packages.unlimited')}</div>
                <div>{t('packages.validity', { count: pkg.validityDays })}</div>
                <div>{t('packages.freezeDays', { count: pkg.freezeDaysAllowed })}</div>
              </div>
            </Card>
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
