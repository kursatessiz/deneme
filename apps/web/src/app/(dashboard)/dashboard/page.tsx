'use client';

import { MapPin } from 'lucide-react';
import type { BranchDTO } from '@platform/shared';
import { useDashboardSession } from '@/components/session/DashboardSessionProvider';
import { useT } from '@/components/i18n/I18nProvider';
import { useBff } from '@/lib/session/use-bff';
import { LoadingState, EmptyState, ErrorState } from '@/components/common/DataState';
import { QuickActionBar } from '@/components/dashboard/QuickActionBar';
import { DashboardStats } from '@/components/dashboard/DashboardStats';
import { TodaySchedule } from '@/components/dashboard/TodaySchedule';
import { LowStockWidget } from '@/components/retail/LowStockWidget';
import { PageHeader } from '@/components/ui/PageHeader';

export default function DashboardPage() {
  const t = useT();
  const { activeStudioId } = useDashboardSession();
  const { data: branches, loading, error } = useBff<BranchDTO[]>(`branches/studio/${activeStudioId}`, activeStudioId);

  return (
    <div className="grid gap-6">
      <PageHeader title={t('screens.dashboard.title')} description={t('screens.dashboard.subtitle')} />

      <QuickActionBar />

      <DashboardStats />

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 items-start">
        <div className="xl:col-span-2 grid gap-4">
          <TodaySchedule />
        </div>
        <div className="grid gap-4">
          <section className="pui-card" aria-labelledby="dashboard-branches-title">
            <div className="pui-card-header">
              <h3 id="dashboard-branches-title" className="ui-heading">
                {t('screens.dashboard.branches.title')}
              </h3>
            </div>
            {loading && <LoadingState />}
            {error && (
              <div className="p-4">
                <ErrorState message={error} />
              </div>
            )}
            {!loading && !error && (!branches || branches.length === 0) && (
              <div className="p-4">
                <EmptyState title={t('screens.dashboard.empty.title')} description={t('screens.dashboard.empty.description')} />
              </div>
            )}
            {!loading && !error && branches && branches.length > 0 && (
              <ul className="pui-list">
                {branches.map((branch) => (
                  <li key={branch.id} className="pui-list-item flex items-start gap-3">
                    <MapPin className="ui-icon mt-0.5 ui-text-muted" aria-hidden="true" />
                    <span className="grid">
                      <span className="ui-heading">{branch.name}</span>
                      <span className="ui-caption">{branch.address ?? t('screens.dashboard.noAddress')}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <LowStockWidget />
        </div>
      </div>
    </div>
  );
}
